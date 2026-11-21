import net from "node:net";
import tls from "node:tls";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { SentenceDecoder, encodeSentence, wordsToStrings, type Word } from "./protocol";

export type RouterOsAuthMode = "plain" | "legacy-md5";

/**
 * `auto` probes plain login (RouterOS 6.43+) and falls back to the legacy
 * MD5 challenge only when the router actually asks for it. `force` is for
 * routers older than 6.43 that never accept plain credentials.
 */
export type LegacyAuthPolicy = "auto" | "force" | "never";

export interface RouterOsClientOptions {
  host: string;
  port?: number;
  username: string;
  password: string;
  tls?: boolean;
  tlsServername?: string;
  tlsRejectUnauthorized?: boolean;
  connectTimeoutMs?: number;
  replyTimeoutMs?: number;
  legacyAuth?: LegacyAuthPolicy;
}

export type RouterOsRecord = Record<string, string>;

export type RouterOsErrorCode =
  | "ROUTER_UNREACHABLE"
  | "ROUTER_TIMEOUT"
  | "ROUTER_CLOSED"
  | "ROUTER_TLS_FAILED"
  | "ROUTER_PROTOCOL_ERROR"
  | "ROUTER_HANDSHAKE_FAILED"
  | "ROUTER_AUTH_FAILED"
  | "ROUTER_FATAL"
  | "ROUTER_COMMAND_FAILED";

export class RouterOsError extends Error {
  readonly code: RouterOsErrorCode;
  readonly category?: string;
  readonly command?: string[];
  readonly hint?: string;

  constructor(
    message: string,
    options: { code: RouterOsErrorCode; category?: string; command?: string[]; hint?: string; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "RouterOsError";
    this.code = options.code;
    this.category = options.category;
    this.command = options.command;
    this.hint = options.hint;
  }
}

class ChallengeRequiredError extends Error {
  readonly challenge: string;
  constructor(challenge: string) {
    super("Router requires the legacy MD5 login challenge");
    this.name = "ChallengeRequiredError";
    this.challenge = challenge;
  }
}

const DEFAULT_CONNECT_TIMEOUT_MS = 8_000;
const DEFAULT_REPLY_TIMEOUT_MS = 10_000;
const TRAP_DRAIN_TIMEOUT_MS = 750;

type PendingRead = {
  resolve: (sentence: Word[]) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

interface ResolvedOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  tls: boolean;
  tlsServername?: string;
  tlsRejectUnauthorized: boolean;
  connectTimeoutMs: number;
  replyTimeoutMs: number;
  legacyAuth: LegacyAuthPolicy;
}

export class RouterOsClient {
  private readonly options: ResolvedOptions;
  private socket: net.Socket | null = null;
  private decoder = new SentenceDecoder();
  private pending: PendingRead[] = [];
  private socketError: Error | null = null;
  private authenticated = false;
  private closed = false;

  constructor(options: RouterOsClientOptions) {
    const useTls = options.tls ?? false;
    this.options = {
      host: options.host,
      port: options.port ?? (useTls ? 8729 : 8728),
      username: options.username,
      password: options.password,
      tls: useTls,
      tlsServername: options.tlsServername,
      tlsRejectUnauthorized: options.tlsRejectUnauthorized ?? false,
      connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      replyTimeoutMs: options.replyTimeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS,
      legacyAuth: options.legacyAuth ?? "auto",
    };
  }

  get isAuthenticated(): boolean {
    return this.authenticated;
  }

  async connect(): Promise<void> {
    if (this.socket) return;

    const { host, port, connectTimeoutMs, tls: useTls } = this.options;
    const connectTimeout = connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };

      const timer = setTimeout(() => {
        socket.destroy();
        finish(
          new RouterOsError(
            `Router ${host}:${port} did not accept the connection within ${connectTimeout}ms`,
            {
              code: "ROUTER_TIMEOUT",
              hint: "Check that the router WAN IP/DDNS is correct and that the API port is forwarded.",
            },
          ),
        );
      }, connectTimeout);

      const socket = useTls
        ? tls.connect({
            host,
            port,
            servername: this.options.tlsServername,
            rejectUnauthorized: this.options.tlsRejectUnauthorized ?? false,
          })
        : net.connect({ host, port });

      this.socket = socket;
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 30_000);

      socket.once(useTls ? "secureConnect" : "connect", () => finish());
      socket.on("data", (chunk) => this.handleData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      socket.on("error", (error) => {
        const mapped = mapSocketError(error, host, port, useTls);
        this.socketError = mapped;
        finish(mapped);
        this.failPending(mapped);
      });
      socket.on("close", () => {
        this.closed = true;
        const error =
          this.socketError ??
          new RouterOsError(`Router ${host}:${port} closed the connection unexpectedly`, {
            code: "ROUTER_CLOSED",
            hint: "The router may be rate limiting API sessions or the API service may be disabled.",
          });
        this.failPending(error);
      });
    });
  }

  /**
   * Authenticates against RouterOS 6.43+ (plain) or legacy builds (MD5
   * challenge). Returns which handshake the router accepted so the caller can
   * store it and skip the probe next time.
   */
  async login(): Promise<{ mode: RouterOsAuthMode }> {
    const policy = this.options.legacyAuth ?? "auto";

    if (policy === "force") {
      const challenge = await this.requestChallenge();
      await this.respondToChallenge(challenge);
      return { mode: "legacy-md5" };
    }

    try {
      await this.loginPlain();
      return { mode: "plain" };
    } catch (error) {
      if (error instanceof ChallengeRequiredError) {
        if (policy === "auto") {
          await this.respondToChallenge(error.challenge);
          return { mode: "legacy-md5" };
        }
        throw new RouterOsError("Router requires the legacy MD5 login challenge", {
          code: "ROUTER_HANDSHAKE_FAILED",
          hint: "This router is older than RouterOS 6.43. Set the handshake mode to auto (or force) for this router.",
        });
      }
      throw error;
    }
  }

  private async loginPlain(): Promise<void> {
    const { username, password } = this.options;
    const { done, trap } = await this.talkRaw(
      ["/login", `=name=${username}`, `=password=${password}`],
      this.options.replyTimeoutMs,
    );

    if (trap) {
      throw new RouterOsError(`Login rejected: ${trap.message}`, {
        code: "ROUTER_AUTH_FAILED",
        category: trap.category,
        hint: "Check the API username/password and that the user has the api policy enabled.",
      });
    }

    const challenge = done?.ret;
    if (typeof challenge === "string" && challenge.length > 0) {
      throw new ChallengeRequiredError(challenge);
    }

    this.authenticated = true;
  }

  private async requestChallenge(): Promise<string> {
    const { username } = this.options;
    const { done, trap } = await this.talkRaw(
      ["/login", `=name=${username}`],
      this.options.replyTimeoutMs,
    );

    if (trap) {
      throw new RouterOsError(`Login rejected: ${trap.message}`, {
        code: "ROUTER_AUTH_FAILED",
        category: trap.category,
      });
    }

    const challenge = done?.ret;
    if (typeof challenge !== "string" || challenge.length === 0) {
      throw new RouterOsError(
        "Router did not return a legacy login challenge",
        {
          code: "ROUTER_HANDSHAKE_FAILED",
          hint: "RouterOS 6.43+ uses plain login. Set the handshake mode to auto or plain.",
        },
      );
    }
    return challenge;
  }

  private async respondToChallenge(challenge: string): Promise<void> {
    const challengeBytes = parseChallenge(challenge);
    if (!challengeBytes) {
      throw new RouterOsError("Router returned a malformed login challenge", {
        code: "ROUTER_HANDSHAKE_FAILED",
        hint: "The legacy challenge must be an even length hex string.",
      });
    }

    // Legacy RouterOS: md5(0x00 + password + challenge bytes), hex, "00" prefix.
    const digest = createHash("md5")
      .update(Buffer.concat([Buffer.from([0]), Buffer.from(this.options.password, "utf8"), challengeBytes]))
      .digest("hex");

    const { done, trap } = await this.talkRaw(
      ["/login", `=name=${this.options.username}`, `=response=00${digest}`],
      this.options.replyTimeoutMs,
    );

    if (trap) {
      throw new RouterOsError(`Login rejected: ${trap.message}`, {
        code: "ROUTER_AUTH_FAILED",
        category: trap.category,
        hint: "Check the API username/password. A stale challenge also fails this way; retry the connection.",
      });
    }
    if (done?.ret) {
      throw new RouterOsError("Router refused the legacy challenge response", {
        code: "ROUTER_AUTH_FAILED",
        hint: "The challenge was reused or the password is wrong. Retry the connection once.",
      });
    }

    this.authenticated = true;
  }

  async command(words: Array<string | Buffer>, replyTimeoutMs?: number): Promise<RouterOsRecord[]> {
    if (!this.authenticated) {
      throw new RouterOsError("Cannot run a command before login", { code: "ROUTER_HANDSHAKE_FAILED" });
    }

    const { records, trap } = await this.talkRaw(words, replyTimeoutMs ?? this.options.replyTimeoutMs);
    if (trap) {
      throw new RouterOsError(trap.message, {
        code: "ROUTER_COMMAND_FAILED",
        category: trap.category,
        command: words.map(String),
      });
    }
    return records;
  }

  async print(path: string, properties?: string[]): Promise<RouterOsRecord[]> {
    const words: Array<string | Buffer> = [path, "print"];
    if (properties?.length) words.push("=.proplist=" + properties.join(","));
    return this.command(words);
  }

  async add(path: string, properties: Record<string, string>): Promise<RouterOsRecord> {
    const words: Array<string | Buffer> = [path, "add"];
    for (const [key, value] of Object.entries(properties)) words.push(`=${key}=${value}`);
    const records = await this.command(words);
    return records[0] ?? {};
  }

  async set(path: string, id: string, properties: Record<string, string>): Promise<void> {
    const words: Array<string | Buffer> = [path, "set", `=.id=${id}`];
    for (const [key, value] of Object.entries(properties)) words.push(`=${key}=${value}`);
    await this.command(words);
  }

  async remove(path: string, id: string): Promise<void> {
    await this.command([path, "remove", `=.id=${id}`]);
  }

  close(): void {
    this.closed = true;
    this.socket?.destroy();
    this.socket = null;
    this.failPending(
      new RouterOsError("Router connection closed by client", { code: "ROUTER_CLOSED" }),
    );
  }

  /**
   * RouterOS replies are not framed per command: a `!done` belongs to whichever
   * command was sent last on the socket. Pipelining therefore mixes replies
   * between callers, so every exchange goes through this serial queue.
   */
  private async talkRaw(
    words: Array<string | Buffer>,
    replyTimeoutMs?: number,
  ): Promise<{ records: RouterOsRecord[]; done: RouterOsRecord | null; trap: RouterOsError | null }> {
    const run = () => this.talkRawInner(words, replyTimeoutMs);
    const result = this.commandQueue.then(run, run);
    this.commandQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private commandQueue: Promise<void> = Promise.resolve();

  private async talkRawInner(
    words: Array<string | Buffer>,
    replyTimeoutMs?: number,
  ): Promise<{ records: RouterOsRecord[]; done: RouterOsRecord | null; trap: RouterOsError | null }> {
    if (this.closed) {
      throw new RouterOsError("Router connection is closed", { code: "ROUTER_CLOSED" });
    }
    if (!this.socket) {
      throw new RouterOsError("Router connection has not been opened", { code: "ROUTER_UNREACHABLE" });
    }

    this.socket.write(encodeSentence(words));

    const records: RouterOsRecord[] = [];
    let trap: RouterOsError | null = null;
    const timeout = replyTimeoutMs ?? this.options.replyTimeoutMs;

    while (true) {
      let sentence: Word[];
      try {
        sentence = await this.readSentence(trap ? Math.min(timeout, TRAP_DRAIN_TIMEOUT_MS) : timeout);
      } catch (error) {
        if (trap && error instanceof RouterOsError && error.code === "ROUTER_TIMEOUT") break;
        throw error;
      }

      const parts = wordsToStrings(sentence);
      const type = parts[0];

      if (type === "!re") {
        records.push(parseAttributes(parts));
        continue;
      }
      if (type === "!trap") {
        const attributes = parseAttributes(parts);
        trap = new RouterOsError(attributes.message ?? "Router rejected the command", {
          code: "ROUTER_COMMAND_FAILED",
          category: attributes.category,
          command: words.map(String),
        });
        continue;
      }
      if (type === "!fatal") {
        const attributes = parseAttributes(parts);
        this.closed = true;
        this.socket?.destroy();
        throw new RouterOsError(attributes.message ?? "Router closed the session with a fatal error", {
          code: "ROUTER_FATAL",
          hint: "Check RouterOS logs (/log print). Fatal errors usually mean the API session was kicked.",
        });
      }
      if (type === "!done") {
        return { records, done: parseAttributes(parts), trap };
      }

      throw new RouterOsError(`Unexpected RouterOS reply word: ${type}`, {
        code: "ROUTER_PROTOCOL_ERROR",
      });
    }

    return { records, done: null, trap };
  }

  private readSentence(timeoutMs: number): Promise<Word[]> {
    if (this.socketError) return Promise.reject(this.socketError);
    if (this.closed) {
      return Promise.reject(
        new RouterOsError("Router closed the connection", { code: "ROUTER_CLOSED" }),
      );
    }

    return new Promise<Word[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = this.pending.filter((entry) => entry.timer !== timer);
        reject(
          new RouterOsError(`Router did not reply within ${timeoutMs}ms`, {
            code: "ROUTER_TIMEOUT",
            hint: "The router may be busy, the API port may be filtered, or the network is lossy.",
          }),
        );
      }, timeoutMs);

      this.pending.push({ resolve, reject, timer });
      // A reply may already be buffered before this waiter was registered.
      this.drain();
    });
  }

  private handleData(chunk: Buffer): void {
    try {
      this.decoder.push(chunk);
    } catch (error) {
      this.failPending(
        new RouterOsError((error as Error).message, { code: "ROUTER_PROTOCOL_ERROR", cause: error }),
      );
      this.socket?.destroy();
      return;
    }
    this.drain();
  }

  private drain(): void {
    while (this.pending.length > 0) {
      let sentence: Word[] | null;
      try {
        sentence = this.decoder.read();
      } catch (error) {
        this.failPending(
          new RouterOsError((error as Error).message, { code: "ROUTER_PROTOCOL_ERROR", cause: error }),
        );
        return;
      }
      if (!sentence) return;

      const waiter = this.pending.shift()!;
      clearTimeout(waiter.timer);
      waiter.resolve(sentence);
    }
  }

  private failPending(error: Error): void {
    const waiters = this.pending;
    this.pending = [];
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}

function parseAttributes(parts: string[]): RouterOsRecord {
  const record: RouterOsRecord = {};
  for (const part of parts.slice(1)) {
    if (part.startsWith("=")) {
      const separator = part.indexOf("=", 1);
      if (separator === -1) record[part.slice(1)] = "";
      else record[part.slice(1, separator)] = part.slice(separator + 1);
    } else if (part.startsWith(".")) {
      const separator = part.indexOf("=");
      if (separator > 0) record[part.slice(0, separator)] = part.slice(separator + 1);
    }
  }
  return record;
}

export function parseChallenge(challenge: string): Buffer | null {
  const normalized = challenge.trim();
  if (normalized.length === 0 || normalized.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(normalized)) return null;
  return Buffer.from(normalized, "hex");
}

export function mapSocketError(error: NodeJS.ErrnoException, host: string, port: number, useTls = false): RouterOsError {
  const code = error.code ?? "";

  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new RouterOsError(`Router host "${host}" could not be resolved`, {
      code: "ROUTER_UNREACHABLE",
      hint: "Use the router public IP or a working DDNS name.",
      cause: error,
    });
  }
  if (code === "ECONNREFUSED") {
    return new RouterOsError(`Router refused the ${useTls ? "API-SSL" : "API"} connection on port ${port}`, {
      code: "ROUTER_UNREACHABLE",
      hint: useTls
        ? "Enable /ip service api-ssl and allow the port in /ip firewall filter."
        : "Enable /ip service api and allow the port in /ip firewall filter.",
      cause: error,
    });
  }
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") {
    return new RouterOsError(`No network route to router ${host}:${port}`, {
      code: "ROUTER_UNREACHABLE",
      hint: "The router is offline or the port forward is missing.",
      cause: error,
    });
  }
  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "EPIPE") {
    return new RouterOsError(`Connection to router ${host}:${port} timed out`, {
      code: "ROUTER_TIMEOUT",
      hint: "Check the WAN IP, port forward and firewall address list for the API service.",
      cause: error,
    });
  }
  if (code.startsWith("ERR_TLS") || code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "SELF_SIGNED_CERT_IN_CHAIN" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return new RouterOsError(`TLS handshake with router ${host}:${port} failed`, {
      code: "ROUTER_TLS_FAILED",
      hint: "MikroTik routers usually use a self-signed certificate. Disable certificate verification for this router or install a trusted certificate.",
      cause: error,
    });
  }

  return new RouterOsError(`Router connection failed: ${error.message}`, {
    code: "ROUTER_UNREACHABLE",
    cause: error,
  });
}

export async function withRouterOsClient<T>(
  options: RouterOsClientOptions,
  run: (client: RouterOsClient, auth: { mode: RouterOsAuthMode }) => Promise<T>,
): Promise<T> {
  const client = new RouterOsClient(options);
  try {
    await client.connect();
    const auth = await client.login();
    return await run(client, auth);
  } finally {
    client.close();
  }
}

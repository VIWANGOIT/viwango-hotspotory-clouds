import net from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import { SentenceDecoder, encodeSentence, wordsToStrings } from "@/lib/mikrotik/protocol";

export type FakeRouterMode = "plain" | "legacy";

export interface FakeRouterOptions {
  mode: FakeRouterMode;
  username?: string;
  password?: string;
  /** Accepts connections but never answers, to exercise reply timeouts. */
  silent?: boolean;
  /** Value for the api service address restriction, e.g. "203.0.113.0/24". */
  apiAddress?: string;
  /** Command path that should answer with !trap, e.g. "/ip/hotspot/user/add". */
  failOn?: string;
  hotspotUsers?: Array<{ name: string; password: string; profile: string }>;
}

interface FakeUser {
  name: string;
  password: string;
  profile: string;
  "limit-uptime"?: string;
}

/** Minimal RouterOS API server used to test the real client over a real socket. */
export class FakeRouter {
  private server: net.Server | null = null;
  private sockets = new Set<net.Socket>();
  private nextId = 1;
  private users = new Map<string, FakeUser>();
  private profiles = new Set<string>();
  readonly received: string[][] = [];
  port = 0;

  constructor(private readonly options: FakeRouterOptions) {
    for (const user of options.hotspotUsers ?? []) {
      this.users.set(user.name, { ...user });
    }
  }

  get createdUsers(): FakeUser[] {
    return [...this.users.values()];
  }

  async start(listenPort = 0): Promise<number> {
    this.server = net.createServer((socket) => this.handleSocket(socket));
    await new Promise<void>((resolve) => this.server!.listen(listenPort, "127.0.0.1", resolve));
    this.port = (this.server!.address() as net.AddressInfo).port;
    return this.port;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  private handleSocket(socket: net.Socket): void {
    this.sockets.add(socket);
    const decoder = new SentenceDecoder();
    let authenticated = false;
    let challenge: Buffer | null = null;
    const username = this.options.username ?? "admin";
    const password = this.options.password ?? "secret";

    socket.on("data", (chunk: Buffer) => {
      decoder.push(chunk);
      let sentence = decoder.read();
      while (sentence) {
        const words = wordsToStrings(sentence);
        this.received.push(words);
        if (!this.options.silent) {
          const response = this.respond(words, {
            authenticated,
            challenge,
            username,
            password,
            setAuthenticated: (value) => (authenticated = value),
            setChallenge: (value) => (challenge = value),
          });
          if (response) {
            for (const sentence of splitSentences(response)) socket.write(encodeSentence(sentence));
          }
        }
        sentence = decoder.read();
      }
    });

    socket.on("error", () => undefined);
    socket.on("close", () => this.sockets.delete(socket));
  }

  private respond(
    words: string[],
    state: {
      authenticated: boolean;
      challenge: Buffer | null;
      username: string;
      password: string;
      setAuthenticated: (value: boolean) => void;
      setChallenge: (value: Buffer | null) => void;
    },
  ): string[] | null {
    const { command, attributeWords } = normalizeCommand(words);
    const attributes = parseAttributes(attributeWords);

    if (command === "/login") {
      if (attributes.response) {
        const expected = this.options.mode === "legacy" && state.challenge
          ? `00${createHash("md5")
              .update(Buffer.concat([Buffer.from([0]), Buffer.from(state.password), state.challenge]))
              .digest("hex")}`
          : "";
        if (expected && attributes.response === expected) {
          state.setAuthenticated(true);
          state.setChallenge(null);
          return ["!done"];
        }
        return ["!trap", "=message=invalid user name or password"];
      }

      if (this.options.mode === "legacy") {
        const next = randomBytes(16);
        state.setChallenge(next);
        return ["!done", `=ret=${next.toString("hex")}`];
      }

      if (attributes.name === state.username && attributes.password === state.password) {
        state.setAuthenticated(true);
        return ["!done"];
      }
      return ["!trap", "=message=invalid user name or password"];
    }

    if (!state.authenticated) {
      return ["!trap", "=message=not logged in"];
    }

    if (this.options.failOn && command.startsWith(this.options.failOn)) {
      return ["!trap", "=message=failure for testing", "=category=0"];
    }

    if (command === "/system/identity/print") {
      return ["!re", "=name=VIWANGO-Test", "!done"];
    }
    if (command === "/system/resource/print") {
      return [
        "!re",
        "=board-name=RB750Gr3",
        "=version=6.49.7 (stable)",
        "=architecture-name=mipsbe",
        "=uptime=1w2d3h",
        "=cpu-load=3",
        "!done",
      ];
    }
    if (command === "/system/license/print") {
      return ["!re", "=nlevel=4", "!done"];
    }
    if (command === "/system/clock/print") {
      const now = new Date();
      const date = now.toISOString().slice(0, 10).replace(/-/g, ".");
      const time = now.toISOString().slice(11, 19);
      return ["!re", `=date=${date}`, `=time=${time}`, "!done"];
    }
    if (command === "/ip/service/print") {
      return [
        "!re",
        "=name=api",
        "=port=8728",
        "=disabled=false",
        `=address=${this.options.apiAddress ?? ""}`,
        "!re",
        "=name=api-ssl",
        "=port=8729",
        "=disabled=true",
        "=address=",
        "!done",
      ];
    }
    if (command === "/ip/hotspot/print") {
      return ["!re", "=name=hotspot1", "=interface=bridge-hotspot", "=profile=hsprof1", "!done"];
    }
    if (command === "/ip/hotspot/server/print") {
      return ["!re", "=name=hotspot1", "=disabled=false", "!done"];
    }
    if (command === "/ip/hotspot/user/profile/print") {
      const name = attributes.name;
      if (name && this.profiles.has(name)) {
        return ["!re", `=.id=*p${this.nextId++}`, `=name=${name}`, "!done"];
      }
      return ["!done"];
    }
    if (command === "/ip/hotspot/user/profile/add") {
      if (attributes.name) this.profiles.add(attributes.name);
      return ["!done", `=ret=*p${this.nextId++}`];
    }
    if (command === "/ip/hotspot/user/print") {
      const name = attributes.name;
      const user = name ? this.users.get(name) : undefined;
      if (!user) return ["!done"];
      return ["!re", `=.id=*u${this.nextId++}`, `=name=${user.name}`, `=profile=${user.profile}`, "!done"];
    }
    if (command === "/ip/hotspot/user/add") {
      if (!attributes.name) return ["!trap", "=message=name required"];
      this.users.set(attributes.name, {
        name: attributes.name,
        password: attributes.password ?? "",
        profile: attributes.profile ?? "default",
        "limit-uptime": attributes["limit-uptime"],
      });
      return ["!done", `=ret=*u${this.nextId++}`];
    }
    if (command === "/ip/hotspot/user/set") {
      const id = attributes[".id"];
      if (!id) return ["!trap", "=message=missing id"];
      return ["!done"];
    }
    if (command === "/ip/hotspot/user/remove") {
      return ["!done"];
    }
    if (command === "/ip/hotspot/active/print") {
      return ["!done"];
    }
    if (command === "/ip/hotspot/active/remove") {
      return ["!done"];
    }

    return ["!trap", `=message=no such command ${command}`];
  }
}

const COMMANDS = new Set(["print", "add", "set", "remove", "get", "enable", "disable", "export", "monitor", "find", "edit"]);

function normalizeCommand(words: string[]): { command: string; attributeWords: string[] } {
  const path = words[0] ?? "";
  const second = words[1] ?? "";
  if (COMMANDS.has(second)) return { command: `${path}/${second}`, attributeWords: words.slice(2) };
  return { command: path, attributeWords: words.slice(1) };
}

function parseAttributes(words: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const word of words) {
    if (!word.startsWith("=") && !word.startsWith("?")) continue;
    const body = word.slice(1);
    const separator = body.indexOf("=");
    if (separator === -1) record[body] = "";
    else record[body.slice(0, separator)] = body.slice(separator + 1);
  }
  return record;
}

function splitSentences(words: string[]): string[][] {
  const sentences: string[][] = [];
  let current: string[] = [];
  for (const word of words) {
    if (word.startsWith("!") && current.length > 0) {
      sentences.push(current);
      current = [];
    }
    current.push(word);
  }
  if (current.length > 0) sentences.push(current);
  return sentences;
}

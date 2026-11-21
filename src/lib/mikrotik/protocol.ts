import { Buffer } from "node:buffer";

/**
 * RouterOS API wire format.
 *
 * Every word is a length prefix followed by the raw bytes. A sentence is a
 * list of words terminated by a zero length word. Getting the length prefix
 * wrong is the most common cause of "handshake" failures, because the router
 * silently waits for bytes that never arrive.
 */

export const MAX_WORD_LENGTH = 0x7fffffff;
export const MAX_SENTENCE_BYTES = 8 * 1024 * 1024;

export type Word = Buffer;

export function encodeLength(length: number): Buffer {
  if (!Number.isInteger(length) || length < 0 || length > MAX_WORD_LENGTH) {
    throw new RangeError(`Invalid RouterOS word length: ${length}`);
  }

  if (length < 0x80) {
    return Buffer.from([length]);
  }
  if (length < 0x4000) {
    return Buffer.from([0x80 | (length >> 8), length & 0xff]);
  }
  if (length < 0x200000) {
    return Buffer.from([0xc0 | (length >> 16), (length >> 8) & 0xff, length & 0xff]);
  }
  if (length < 0x10000000) {
    return Buffer.from([
      0xe0 | (length >> 24),
      (length >> 16) & 0xff,
      (length >> 8) & 0xff,
      length & 0xff,
    ]);
  }

  const buffer = Buffer.alloc(5);
  buffer[0] = 0xf0;
  buffer.writeUInt32BE(length, 1);
  return buffer;
}

export function decodeLength(buffer: Buffer, offset = 0): { length: number; bytes: number } {
  if (offset >= buffer.length) {
    throw new RangeError("RouterOS length prefix is truncated");
  }

  const first = buffer[offset];
  if ((first & 0x80) === 0) {
    return { length: first, bytes: 1 };
  }
  if ((first & 0xc0) === 0x80) {
    ensureAvailable(buffer, offset, 2);
    return { length: ((first & 0x3f) << 8) | buffer[offset + 1], bytes: 2 };
  }
  if ((first & 0xe0) === 0xc0) {
    ensureAvailable(buffer, offset, 3);
    return {
      length: ((first & 0x1f) << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2],
      bytes: 3,
    };
  }
  if ((first & 0xf0) === 0xe0) {
    ensureAvailable(buffer, offset, 4);
    return {
      length:
        ((first & 0x0f) << 24) |
        (buffer[offset + 1] << 16) |
        (buffer[offset + 2] << 8) |
        buffer[offset + 3],
      bytes: 4,
    };
  }
  if ((first & 0xf8) === 0xf0) {
    ensureAvailable(buffer, offset, 5);
    return { length: buffer.readUInt32BE(offset + 1), bytes: 5 };
  }

  throw new RangeError(`Invalid RouterOS length prefix: 0x${first.toString(16)}`);
}

function ensureAvailable(buffer: Buffer, offset: number, needed: number): void {
  if (offset + needed > buffer.length) {
    throw new RangeError("RouterOS length prefix is truncated");
  }
}

export function encodeWord(value: string | Buffer): Buffer {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  if (data.length > MAX_WORD_LENGTH) {
    throw new RangeError(`RouterOS word is too long: ${data.length}`);
  }
  return Buffer.concat([encodeLength(data.length), data]);
}

export function encodeSentence(words: Array<string | Buffer>): Buffer {
  const parts: Buffer[] = [];
  for (const word of words) {
    parts.push(encodeWord(word));
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

/**
 * Incremental sentence decoder. Feed it socket chunks, pull complete
 * sentences out. Returns `null` when more bytes are required.
 */
export class SentenceDecoder {
  private pending: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): void {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    if (this.pending.length > MAX_SENTENCE_BYTES) {
      throw new RangeError("RouterOS reply exceeds the maximum sentence size");
    }
  }

  get bufferedBytes(): number {
    return this.pending.length;
  }

  read(): Word[] | null {
    const words: Word[] = [];
    let offset = 0;

    while (true) {
      if (offset >= this.pending.length) return null;

      let length: number;
      let prefixBytes: number;
      try {
        ({ length, bytes: prefixBytes } = decodeLength(this.pending, offset));
      } catch {
        return null;
      }

      const start = offset + prefixBytes;
      if (start + length > this.pending.length) return null;

      if (length === 0) {
        this.pending = this.pending.subarray(start);
        return words;
      }

      if (length > MAX_SENTENCE_BYTES) {
        throw new RangeError("RouterOS word exceeds the maximum sentence size");
      }

      words.push(this.pending.subarray(start, start + length));
      offset = start + length;
    }
  }
}

export function wordsToStrings(words: Word[]): string[] {
  return words.map((word) => word.toString("utf8"));
}

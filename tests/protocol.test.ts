import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import {
  SentenceDecoder,
  decodeLength,
  encodeLength,
  encodeSentence,
  encodeWord,
  wordsToStrings,
} from "@/lib/mikrotik/protocol";

describe("RouterOS length encoding", () => {
  const cases: Array<[number, number[]]> = [
    [0, [0x00]],
    [1, [0x01]],
    [0x7f, [0x7f]],
    [0x80, [0x80, 0x80]],
    [0x3fff, [0xbf, 0xff]],
    [0x4000, [0xc0, 0x40, 0x00]],
    [0x1fffff, [0xdf, 0xff, 0xff]],
    [0x200000, [0xe0, 0x20, 0x00, 0x00]],
    [0x0fffffff, [0xef, 0xff, 0xff, 0xff]],
    [0x10000000, [0xf0, 0x10, 0x00, 0x00, 0x00]],
  ];

  it.each(cases)("encodes %i exactly as RouterOS expects", (length, expected) => {
    expect([...encodeLength(length)]).toEqual(expected);
    expect(decodeLength(Buffer.from(expected))).toEqual({ length, bytes: expected.length });
  });

  it("rejects invalid lengths", () => {
    expect(() => encodeLength(-1)).toThrow(RangeError);
    expect(() => encodeLength(1.5)).toThrow(RangeError);
    expect(() => encodeLength(0x80000000)).toThrow(RangeError);
  });

  it("rejects a reserved length prefix", () => {
    expect(() => decodeLength(Buffer.from([0xf8, 0, 0, 0, 0]))).toThrow(RangeError);
  });
});

describe("RouterOS sentence encoding", () => {
  it("terminates every sentence with a zero length word", () => {
    const encoded = encodeSentence(["/login", "=name=admin", "=password=secret"]);
    expect(encoded[encoded.length - 1]).toBe(0);
    expect(encoded[0]).toBe("/login".length);
    expect(encoded.subarray(1, 7).toString()).toBe("/login");
  });

  it("round trips UTF-8 words split across chunks", () => {
    const decoder = new SentenceDecoder();
    const encoded = encodeWord("Kariakoo · hotspot");

    expect(decoder.read()).toBeNull();
    decoder.push(encoded.subarray(0, 3));
    expect(decoder.read()).toBeNull();
    decoder.push(encoded.subarray(3));
    decoder.push(Buffer.from([0]));

    const sentence = decoder.read();
    expect(sentence).not.toBeNull();
    expect(wordsToStrings(sentence!)).toEqual(["Kariakoo · hotspot"]);
  });

  it("reads two sentences from a single chunk", () => {
    const decoder = new SentenceDecoder();
    decoder.push(Buffer.concat([encodeSentence(["!done"]), encodeSentence(["!done"])]));
    expect(wordsToStrings(decoder.read()!)).toEqual(["!done"]);
    expect(wordsToStrings(decoder.read()!)).toEqual(["!done"]);
    expect(decoder.read()).toBeNull();
  });

  it("keeps partial sentences buffered", () => {
    const decoder = new SentenceDecoder();
    const encoded = encodeSentence(["!re", "=name=router"]);
    decoder.push(encoded.subarray(0, encoded.length - 2));
    expect(decoder.read()).toBeNull();
    decoder.push(encoded.subarray(encoded.length - 2));
    expect(wordsToStrings(decoder.read()!)).toEqual(["!re", "=name=router"]);
  });
});

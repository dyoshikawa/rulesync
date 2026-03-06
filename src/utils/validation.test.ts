import { describe, expect, it } from "vitest";

import { findControlCharacter, hasControlCharacters } from "./validation.js";

describe("findControlCharacter", () => {
  it("returns null for clean strings", () => {
    expect(findControlCharacter("hello world")).toBeNull();
    expect(findControlCharacter("path/to/file.ts")).toBeNull();
    expect(findControlCharacter("")).toBeNull();
  });

  it("detects null byte (0x00)", () => {
    const result = findControlCharacter("abc\x00def");
    expect(result).toEqual({ position: 3, hex: "0x00" });
  });

  it("detects newline (0x0a)", () => {
    const result = findControlCharacter("line\nbreak");
    expect(result).toEqual({ position: 4, hex: "0x0a" });
  });

  it("detects tab (0x09)", () => {
    const result = findControlCharacter("\tfoo");
    expect(result).toEqual({ position: 0, hex: "0x09" });
  });

  it("detects DEL (0x7f)", () => {
    const result = findControlCharacter("foo\x7fbar");
    expect(result).toEqual({ position: 3, hex: "0x7f" });
  });

  it("detects boundary value 0x1f", () => {
    const result = findControlCharacter("x\x1fy");
    expect(result).toEqual({ position: 1, hex: "0x1f" });
  });

  it("returns the first control character when multiple exist", () => {
    const result = findControlCharacter("a\x01b\x02c");
    expect(result).toEqual({ position: 1, hex: "0x01" });
  });

  it("does not flag printable characters like space (0x20) or tilde (0x7e)", () => {
    expect(findControlCharacter(" ")).toBeNull();
    expect(findControlCharacter("~")).toBeNull();
  });
});

describe("hasControlCharacters", () => {
  it("returns false for clean strings", () => {
    expect(hasControlCharacters("hello")).toBe(false);
    expect(hasControlCharacters("")).toBe(false);
  });

  it("returns true when control characters are present", () => {
    expect(hasControlCharacters("abc\x00")).toBe(true);
    expect(hasControlCharacters("\x7f")).toBe(true);
  });
});

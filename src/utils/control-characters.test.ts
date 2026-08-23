import { describe, expect, it } from "vitest";

import { stripControlCharacters } from "./control-characters.js";

describe("stripControlCharacters", () => {
  it("should leave printable text untouched", () => {
    expect(stripControlCharacters("statusLine")).toBe("statusLine");
  });

  it("should remove a newline that would forge a log line", () => {
    expect(stripControlCharacters("key\n[warn] forged")).toBe("key[warn] forged");
  });

  it("should remove C0 controls, DEL and the C1 range", () => {
    expect(stripControlCharacters("a\u0000b\u001bc\u007fd\u009be")).toBe("abcde");
  });

  it("should remove bidirectional overrides and line separators", () => {
    expect(stripControlCharacters("a\u202eb\u2028c")).toBe("abc");
  });

  it("should keep the plain right-to-left marks, which carry meaning in a name", () => {
    expect(stripControlCharacters("a\u200fb")).toBe("a\u200fb");
  });
});

import { describe, expect, it } from "vitest";

import {
  buildHooksOwnershipLockFile,
  HOOKS_OWNERSHIP_LOCK_FILE_NAME,
  HOOKS_OWNERSHIP_LOCK_VERSION,
  ownedHookKey,
  parseHooksOwnershipLock,
  serializeHooksOwnershipLock,
} from "./hooks-ownership-lock.js";

describe("ownedHookKey", () => {
  it("should treat an absent matcher and an empty matcher as different places", () => {
    expect(ownedHookKey({ event: "SessionStart", identity: "command:a" })).not.toBe(
      ownedHookKey({ event: "SessionStart", matcher: "", identity: "command:a" }),
    );
  });

  it("should not let a separator inside a field collide with another entry", () => {
    expect(
      ownedHookKey({ event: "PreToolUse", matcher: 'Bash","x', identity: "command:a" }),
    ).not.toBe(ownedHookKey({ event: "PreToolUse", matcher: "Bash", identity: 'x","command:a' }));
  });
});

describe("parseHooksOwnershipLock", () => {
  it("should return an empty set when there is no lock", () => {
    expect(parseHooksOwnershipLock(null).size).toBe(0);
    expect(parseHooksOwnershipLock("").size).toBe(0);
    expect(parseHooksOwnershipLock("   \n").size).toBe(0);
  });

  it("should return an empty set for malformed JSON", () => {
    expect(parseHooksOwnershipLock("{not json").size).toBe(0);
  });

  it("should return an empty set when the shape does not match", () => {
    expect(parseHooksOwnershipLock(JSON.stringify({ lockfileVersion: 1 })).size).toBe(0);
    expect(
      parseHooksOwnershipLock(JSON.stringify({ lockfileVersion: 1, owned: [{ event: 1 }] })).size,
    ).toBe(0);
  });

  it("should ignore a lock written by a different version", () => {
    const content = JSON.stringify({
      lockfileVersion: HOOKS_OWNERSHIP_LOCK_VERSION + 1,
      owned: [{ event: "SessionStart", identity: "command:a" }],
    });
    expect(parseHooksOwnershipLock(content).size).toBe(0);
  });

  it("should round-trip the owned entries it serialized", () => {
    const owned = [
      { event: "SessionStart", matcher: "", identity: "command:a" },
      { event: "PreToolUse", matcher: "Bash", identity: "command:b" },
      { event: "Stop", identity: "http://example.test/hook" },
    ];

    const parsed = parseHooksOwnershipLock(serializeHooksOwnershipLock(owned));

    expect(parsed.size).toBe(3);
    for (const ref of owned) {
      expect(parsed.has(ownedHookKey(ref))).toBe(true);
    }
  });
});

describe("serializeHooksOwnershipLock", () => {
  it("should emit the same bytes regardless of input order", () => {
    const a = { event: "SessionStart", matcher: "", identity: "command:a" };
    const b = { event: "PreToolUse", matcher: "Bash", identity: "command:b" };

    expect(serializeHooksOwnershipLock([a, b])).toBe(serializeHooksOwnershipLock([b, a]));
  });

  it("should end with a trailing newline", () => {
    expect(serializeHooksOwnershipLock([])).toMatch(/\n$/);
  });

  it("should record the current lock version", () => {
    expect(JSON.parse(serializeHooksOwnershipLock([])).lockfileVersion).toBe(
      HOOKS_OWNERSHIP_LOCK_VERSION,
    );
  });
});

describe("buildHooksOwnershipLockFile", () => {
  it("should place a deletable lock next to the hooks destination", () => {
    const file = buildHooksOwnershipLockFile({
      outputRoot: "/tmp/project",
      relativeDirPath: ".claude",
      owned: [{ event: "SessionStart", matcher: "", identity: "command:a" }],
    });

    expect(file.getRelativeDirPath()).toBe(".claude");
    expect(file.getRelativeFilePath()).toBe(HOOKS_OWNERSHIP_LOCK_FILE_NAME);
    expect(file.isDeletable()).toBe(true);
    expect(file.validate()).toEqual({ success: true, error: null });
    expect(JSON.parse(file.getFileContent()).owned).toEqual([
      { event: "SessionStart", matcher: "", identity: "command:a" },
    ]);
  });
});

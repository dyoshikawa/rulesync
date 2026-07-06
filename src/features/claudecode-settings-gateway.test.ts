import { describe, expect, it } from "vitest";

import { createMockLogger } from "../test-utils/mock-logger.js";
import type { ClaudeSettingsJson } from "../types/claude-settings.js";
import {
  applyIgnoreReadDenies,
  applyPermissions,
  buildReadDenyEntry,
  isReadDenyEntry,
} from "./claudecode-settings-gateway.js";

// The permissions feature parses "Bash(npm *)" into its tool name; the gateway
// is agnostic to the format and takes this extractor as a parameter.
const toolNameOf = (entry: string): string => {
  const parenIndex = entry.indexOf("(");
  return parenIndex === -1 ? entry : entry.slice(0, parenIndex);
};

describe("isReadDenyEntry", () => {
  it("recognizes Read(...) entries", () => {
    expect(isReadDenyEntry("Read(.env)")).toBe(true);
    expect(isReadDenyEntry("Read(*.log)")).toBe(true);
  });

  it("rejects non-Read and malformed entries", () => {
    expect(isReadDenyEntry("Write(secret.txt)")).toBe(false);
    expect(isReadDenyEntry("Read(unterminated")).toBe(false);
    expect(isReadDenyEntry("Bash")).toBe(false);
  });
});

describe("buildReadDenyEntry", () => {
  it("wraps a pattern into a Read deny entry", () => {
    expect(buildReadDenyEntry("*.log")).toBe("Read(*.log)");
  });
});

describe("applyIgnoreReadDenies", () => {
  it("preserves non-Read deny entries while replacing the Read set", () => {
    const settings: ClaudeSettingsJson = {
      permissions: { deny: ["Write(secret.txt)", "Read(old.log)"] },
    };

    const result = applyIgnoreReadDenies({
      settings,
      readDenies: ["Read(*.log)", "Read(node_modules/**)"],
    });

    expect(result.permissions?.deny).toEqual([
      "Read(*.log)",
      "Read(node_modules/**)",
      "Write(secret.txt)",
    ]);
  });

  it("leaves allow/ask untouched and other top-level keys intact", () => {
    const settings: ClaudeSettingsJson = {
      permissions: { allow: ["Bash(ls)"], ask: ["Bash(rm *)"], deny: ["Read(a)"] },
      hooks: { PreToolUse: [] },
    };

    const result = applyIgnoreReadDenies({ settings, readDenies: ["Read(b)"] });

    expect(result.permissions?.allow).toEqual(["Bash(ls)"]);
    expect(result.permissions?.ask).toEqual(["Bash(rm *)"]);
    expect(result.permissions?.deny).toEqual(["Read(b)"]);
    expect(result.hooks).toEqual({ PreToolUse: [] });
  });

  it("deduplicates and sorts", () => {
    const result = applyIgnoreReadDenies({
      settings: { permissions: { deny: ["Read(z)"] } },
      readDenies: ["Read(b)", "Read(a)", "Read(b)"],
    });

    expect(result.permissions?.deny).toEqual(["Read(a)", "Read(b)"]);
  });
});

describe("applyPermissions", () => {
  it("keeps entries for unmanaged tools and replaces managed ones", () => {
    const settings: ClaudeSettingsJson = {
      permissions: { deny: ["Read(.env)", "Bash(dangerous *)"] },
    };

    const result = applyPermissions({
      settings,
      managedToolNames: new Set(["Bash"]),
      toolNameOf,
      allow: [],
      ask: [],
      deny: ["Bash(rm *)"],
    });

    // Read (unmanaged) preserved; old Bash replaced by the new Bash rule.
    expect(result.permissions?.deny).toEqual(["Bash(rm *)", "Read(.env)"]);
  });

  it("overwrites ignore-derived Read denies when Read is managed and warns", () => {
    const logger = createMockLogger();
    const settings: ClaudeSettingsJson = {
      permissions: { deny: ["Read(.env)", "Read(*.secret)"] },
    };

    const result = applyPermissions({
      settings,
      managedToolNames: new Set(["Read"]),
      toolNameOf,
      allow: ["Read(src/**)"],
      ask: [],
      deny: [],
      logger,
    });

    expect(result.permissions?.deny).toBeUndefined();
    expect(result.permissions?.allow).toEqual(["Read(src/**)"]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("manages 'Read' tool"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("2 existing Read deny"));
    // The warning no longer speculates about the ignore feature by name.
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("ignore"));
  });

  it("does not warn when Read is not managed", () => {
    const logger = createMockLogger();

    applyPermissions({
      settings: { permissions: { deny: ["Read(.env)"] } },
      managedToolNames: new Set(["Bash"]),
      toolNameOf,
      allow: [],
      ask: [],
      deny: ["Bash(rm *)"],
      logger,
    });

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

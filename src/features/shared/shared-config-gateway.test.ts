import { describe, expect, it } from "vitest";

import { deriveSharedFileWriters } from "../../lib/shared-file-derive.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import type { ClaudeSettingsJson } from "../../types/claude-settings.js";
import * as sharedConfigGateway from "./shared-config-gateway.js";
import {
  applyIgnoreReadDenies,
  applyPermissions,
  applySharedConfigPatch,
  buildReadDenyEntry,
  HERMES_CONFIG_SHARED_FILE_KEY,
  isReadDenyEntry,
  mergeSharedConfigDeep,
  mergeSharedConfigShallow,
  parseSharedConfig,
  SHARED_CONFIG_OWNERSHIP,
  stringifySharedConfig,
  TAKT_CONFIG_SHARED_FILE_KEY,
} from "./shared-config-gateway.js";

describe("parseSharedConfig", () => {
  it("treats an empty file as an empty document in every format", () => {
    expect(parseSharedConfig({ format: "yaml", fileContent: "  \n" })).toEqual({});
    expect(parseSharedConfig({ format: "json", fileContent: "" })).toEqual({});
    expect(parseSharedConfig({ format: "jsonc", fileContent: "" })).toEqual({});
  });

  it("parses each format into a plain document", () => {
    expect(parseSharedConfig({ format: "yaml", fileContent: "model: hermes-3" })).toEqual({
      model: "hermes-3",
    });
    expect(parseSharedConfig({ format: "json", fileContent: '{"a": 1}' })).toEqual({ a: 1 });
    expect(
      parseSharedConfig({ format: "jsonc", fileContent: '{\n  // comment\n  "a": 1,\n}' }),
    ).toEqual({ a: 1 });
  });

  it("coerces a non-mapping root to an empty document by default", () => {
    expect(parseSharedConfig({ format: "yaml", fileContent: "- item" })).toEqual({});
    expect(parseSharedConfig({ format: "jsonc", fileContent: "[1, 2]" })).toEqual({});
  });

  it("throws with the file path on a non-mapping root when declared strict", () => {
    expect(() =>
      parseSharedConfig({
        format: "yaml",
        fileContent: "- item",
        filePath: ".takt/config.yaml",
        invalidRootPolicy: "error",
      }),
    ).toThrow(/Failed to parse shared config at \.takt\/config\.yaml/);
  });

  it("throws with the file path on invalid syntax", () => {
    expect(() =>
      parseSharedConfig({
        format: "yaml",
        fileContent: "foo: [unclosed",
        filePath: ".takt/config.yaml",
      }),
    ).toThrow(/Failed to parse shared config at \.takt\/config\.yaml/);
    expect(() =>
      parseSharedConfig({
        format: "json",
        fileContent: "{ not json",
        filePath: ".claude/settings.json",
      }),
    ).toThrow(/Failed to parse shared config at \.claude\/settings\.json/);
  });

  it("drops prototype-pollution keys recursively", () => {
    const config = parseSharedConfig({
      format: "yaml",
      fileContent: `
model: hermes-3
__proto__:
  polluted: true
mcp_servers:
  docs:
    url: https://example.com/mcp
    constructor:
      polluted: true
plugins:
  enabled:
    - rulesync-subagents
  prototype:
    polluted: true
`,
    });

    expect(config).toEqual({
      model: "hermes-3",
      mcp_servers: {
        docs: {
          url: "https://example.com/mcp",
        },
      },
      plugins: {
        enabled: ["rulesync-subagents"],
      },
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("stringifySharedConfig", () => {
  it("emits YAML with exactly one trailing newline", () => {
    expect(stringifySharedConfig({ format: "yaml", document: { a: 1 } })).toBe("a: 1\n");
  });

  it("emits 2-space JSON without a trailing newline", () => {
    expect(stringifySharedConfig({ format: "json", document: { a: 1 } })).toBe('{\n  "a": 1\n}');
  });
});

describe("mergeSharedConfigShallow", () => {
  it("replaces patch keys wholesale and preserves the rest", () => {
    const merged = mergeSharedConfigShallow({
      base: { hooks: { old: true }, model: "hermes-3" },
      patch: { hooks: { new: true } },
    });
    expect(merged).toEqual({ hooks: { new: true }, model: "hermes-3" });
  });
});

describe("mergeSharedConfigDeep", () => {
  it("merges nested plain objects key-by-key (patch wins)", () => {
    const merged = mergeSharedConfigDeep({
      base: { approvals: { deny: ["rm -rf *"] } },
      patch: { approvals: { mode: "smart" } },
    });
    expect(merged).toEqual({ approvals: { deny: ["rm -rf *"], mode: "smart" } });
  });

  it("replaces arrays and scalars wholesale", () => {
    const merged = mergeSharedConfigDeep({
      base: { list: [1, 2], flag: true },
      patch: { list: [3], flag: false },
    });
    expect(merged).toEqual({ list: [3], flag: false });
  });

  it("drops prototype-pollution keys from the patch", () => {
    const merged = mergeSharedConfigDeep({
      base: {},
      patch: JSON.parse('{"__proto__":{"polluted":true},"ok":1}'),
    });
    expect(merged).toEqual({ ok: 1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("SHARED_CONFIG_OWNERSHIP", () => {
  it("declares exactly the writer features the processor registry derives per file", () => {
    // minWriters: 1 so declarations for gateway-managed files with a single
    // writer (e.g. the global kilo config) are validated against the registry
    // too, not just the cross-feature shared ones.
    const derived = new Map(
      deriveSharedFileWriters({ minWriters: 1 }).map((w) => [w.key, [...w.features]]),
    );
    for (const [fileKey, declaration] of Object.entries(SHARED_CONFIG_OWNERSHIP)) {
      expect(
        Object.keys(declaration.features).toSorted(),
        `ownership declaration for '${fileKey}' out of sync with the registry-derived writers`,
      ).toEqual(derived.get(fileKey) ?? []);
    }
  });

  it("accounts for every registry-derived shared file with an ownership declaration", () => {
    const unaccounted = deriveSharedFileWriters()
      .map((writer) => writer.key)
      .filter((key) => SHARED_CONFIG_OWNERSHIP[key] === undefined);
    expect(
      unaccounted,
      "a shared file appeared without an ownership decision; declare it in SHARED_CONFIG_OWNERSHIP",
    ).toEqual([]);
  });

  it("resolves every custom policyFunction name to an exported function", () => {
    // The `custom` policy references its implementation by string name; a rename
    // that misses the declaration would otherwise stale silently. Pin the names
    // so they must resolve to a real exported function of this module.
    const exports = sharedConfigGateway as Record<string, unknown>;
    for (const [fileKey, declaration] of Object.entries(SHARED_CONFIG_OWNERSHIP)) {
      for (const [feature, policy] of Object.entries(declaration.features)) {
        if (policy?.kind !== "custom") continue;
        expect(
          typeof exports[policy.policyFunction],
          `policyFunction '${policy.policyFunction}' declared for feature '${feature}' on ` +
            `'${fileKey}' does not resolve to an exported function in shared-config-gateway.ts`,
        ).toBe("function");
      }
    }
  });
});

describe("applySharedConfigPatch", () => {
  it("executes replace-owned-keys: owned key replaced, user keys preserved", () => {
    const result = applySharedConfigPatch({
      fileKey: HERMES_CONFIG_SHARED_FILE_KEY,
      feature: "hooks",
      existingContent: "model: hermes-large\nhooks:\n  stale: true\n",
      patch: { hooks: { pre_tool_call: [] } },
    });
    expect(parseSharedConfig({ format: "yaml", fileContent: result })).toEqual({
      model: "hermes-large",
      hooks: { pre_tool_call: [] },
    });
  });

  it("rejects a patch that strays outside the feature's owned keys", () => {
    expect(() =>
      applySharedConfigPatch({
        fileKey: HERMES_CONFIG_SHARED_FILE_KEY,
        feature: "hooks",
        existingContent: "",
        patch: { hooks: {}, model: "hijacked" },
      }),
    ).toThrow(/undeclared keys \[model\]/);
  });

  it("executes deep-merge with replaceKeys snapshots", () => {
    const result = applySharedConfigPatch({
      fileKey: HERMES_CONFIG_SHARED_FILE_KEY,
      feature: "permissions",
      existingContent: [
        "approvals:",
        "  mode: smart",
        "permissions:",
        "  rulesync:",
        "    stale: true",
      ].join("\n"),
      patch: {
        approvals: { deny: ["rm -rf *"] },
        permissions: { rulesync: { fresh: true } },
      },
    });
    expect(parseSharedConfig({ format: "yaml", fileContent: result })).toEqual({
      // Deep merge: the user's approvals.mode coexists with the generated deny.
      approvals: { mode: "smart", deny: ["rm -rf *"] },
      // Snapshot key: replaced wholesale, the stale entry is not resurrected.
      permissions: { rulesync: { fresh: true } },
    });
  });

  it("preserves nested sibling keys under deep-merge (the takt provider_options regression)", () => {
    const result = applySharedConfigPatch({
      fileKey: TAKT_CONFIG_SHARED_FILE_KEY,
      feature: "permissions",
      existingContent: [
        "provider: codex",
        "provider_options:",
        "  codex:",
        "    base_url: http://127.0.0.1:8080",
      ].join("\n"),
      patch: { provider_options: { codex: { network_access: true } } },
    });
    expect(parseSharedConfig({ format: "yaml", fileContent: result })).toEqual({
      provider: "codex",
      provider_options: {
        codex: { base_url: "http://127.0.0.1:8080", network_access: true },
      },
    });
  });

  it("rejects writes to undeclared files and undeclared writer features", () => {
    expect(() =>
      applySharedConfigPatch({
        fileKey: "unknown.json",
        feature: "mcp",
        existingContent: "",
        patch: {},
      }),
    ).toThrow(/no SHARED_CONFIG_OWNERSHIP declaration/);
    expect(() =>
      applySharedConfigPatch({
        fileKey: TAKT_CONFIG_SHARED_FILE_KEY,
        feature: "rules",
        existingContent: "",
        patch: {},
      }),
    ).toThrow(/declares no ownership/);
  });

  it("directs custom-policy features to their policy function", () => {
    expect(() =>
      applySharedConfigPatch({
        fileKey: ".claude/settings.json",
        feature: "ignore",
        existingContent: "",
        patch: {},
      }),
    ).toThrow(/applyIgnoreReadDenies/);
  });
});

// ---------------------------------------------------------------------------
// `.claude/settings.json` custom policy
// ---------------------------------------------------------------------------

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

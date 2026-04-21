import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { GeminicliPermissions } from "./geminicli-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

type ParsedRule = {
  toolName?: string;
  decision?: string;
  commandPrefix?: string;
  argsPattern?: string;
  priority?: number;
};

function parseRules(content: string): ParsedRule[] {
  const parsed = smolToml.parse(content) as { rule?: ParsedRule[] };
  return parsed.rule ?? [];
}

describe("GeminicliPermissions", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("should emit a Gemini CLI policy TOML at .gemini/policies/rulesync.toml", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      baseDir: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: { "git *": "allow", "rm *": "deny", "*": "ask" },
          read: { "src/**": "allow" },
        },
      }),
    });

    const geminiPermissions = await GeminicliPermissions.fromRulesyncPermissions({
      baseDir: testDir,
      rulesyncPermissions,
    });

    expect(geminiPermissions.getRelativeDirPath()).toBe(join(".gemini", "policies"));
    expect(geminiPermissions.getRelativeFilePath()).toBe("rulesync.toml");
    const rules = parseRules(geminiPermissions.getFileContent());
    expect(rules).toContainEqual(
      expect.objectContaining({
        toolName: "run_shell_command",
        decision: "allow",
        commandPrefix: "git",
      }),
    );
    expect(rules).toContainEqual(
      expect.objectContaining({ toolName: "run_shell_command", decision: "deny" }),
    );
    expect(rules).toContainEqual(
      expect.objectContaining({ toolName: "run_shell_command", decision: "ask_user" }),
    );
    // Non-bash argsPattern must be anchored at both ends of the JSON string value to
    // prevent cross-field matching.
    expect(rules).toContainEqual(
      expect.objectContaining({
        toolName: "read_file",
        decision: "allow",
        argsPattern: '"src/[^\\"]*\\"',
      }),
    );
  });

  it("should assign higher priority to deny rules than ask or allow rules", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      baseDir: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: { "git *": "allow", "git push --force *": "deny", "*": "ask" },
        },
      }),
    });

    const geminiPermissions = await GeminicliPermissions.fromRulesyncPermissions({
      baseDir: testDir,
      rulesyncPermissions,
    });

    const content = geminiPermissions.getFileContent();
    const denyIndex = content.indexOf('decision = "deny"');
    const askIndex = content.indexOf('decision = "ask_user"');
    const allowIndex = content.indexOf('decision = "allow"');
    expect(denyIndex).toBeGreaterThanOrEqual(0);
    expect(askIndex).toBeGreaterThanOrEqual(0);
    expect(allowIndex).toBeGreaterThanOrEqual(0);
    // Deny must appear before allow so that first-match wins goes to deny.
    expect(denyIndex).toBeLessThan(allowIndex);
    expect(askIndex).toBeLessThan(allowIndex);
    // Wide priority spread so a hand-authored sibling rule won't accidentally outrank deny.
    const priorities = parseRules(content).map((rule) => rule.priority);
    expect(priorities).toContain(1_000_000);
    expect(priorities).toContain(1_000);
    expect(priorities).toContain(1);
  });

  it("should emit argsPattern for bash patterns with interior glob metacharacters", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      baseDir: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: { "rm -rf /tmp/*": "deny" },
        },
      }),
    });

    const geminiPermissions = await GeminicliPermissions.fromRulesyncPermissions({
      baseDir: testDir,
      rulesyncPermissions,
    });

    const rules = parseRules(geminiPermissions.getFileContent());
    const rule = rules.find((entry) => entry.toolName === "run_shell_command");
    expect(rule?.argsPattern).toBe('"command":"rm -rf /tmp/[^/\\"]*');
    expect(rule?.commandPrefix).toBeUndefined();
  });

  it("should convert Gemini CLI policy TOML back to rulesync format", () => {
    const geminiPermissions = new GeminicliPermissions({
      baseDir: testDir,
      relativeDirPath: join(".gemini", "policies"),
      relativeFilePath: "rulesync.toml",
      fileContent: [
        "[[rule]]",
        'toolName = "run_shell_command"',
        'decision = "allow"',
        'commandPrefix = "git"',
        "priority = 100",
        "",
        "[[rule]]",
        'toolName = "run_shell_command"',
        'decision = "deny"',
        'commandPrefix = "rm"',
        "priority = 300",
        "",
        "[[rule]]",
        'toolName = "read_file"',
        'decision = "allow"',
        'argsPattern = "\\"src/.*"',
        "priority = 100",
        "",
      ].join("\n"),
    });

    const rulesyncPermissions = geminiPermissions.toRulesyncPermissions();
    const json = rulesyncPermissions.getJson();

    expect(json.permission.bash?.["git *"]).toBe("allow");
    expect(json.permission.bash?.["rm *"]).toBe("deny");
    expect(json.permission.read?.["src/**"]).toBe("allow");
  });

  it("should accept legacy unanchored argsPattern encoding for backward compatibility", () => {
    const geminiPermissions = new GeminicliPermissions({
      baseDir: testDir,
      relativeDirPath: join(".gemini", "policies"),
      relativeFilePath: "rulesync.toml",
      fileContent: [
        "[[rule]]",
        'toolName = "read_file"',
        'decision = "allow"',
        'argsPattern = "src/.*"',
        "priority = 100",
        "",
      ].join("\n"),
    });

    const json = geminiPermissions.toRulesyncPermissions().getJson();
    expect(json.permission.read?.["src/**"]).toBe("allow");
  });

  it("should load existing .gemini/policies/rulesync.toml", async () => {
    const policyDir = join(testDir, ".gemini", "policies");
    await ensureDir(policyDir);
    await writeFileContent(
      join(policyDir, "rulesync.toml"),
      '[[rule]]\ntoolName = "run_shell_command"\ndecision = "allow"\ncommandPrefix = "git"\npriority = 100\n',
    );

    const loaded = await GeminicliPermissions.fromFile({ baseDir: testDir });
    expect(loaded).toBeInstanceOf(GeminicliPermissions);
    expect(loaded.getFileContent()).toContain('commandPrefix = "git"');
  });

  it("should return empty permissions when TOML file is missing", async () => {
    const loaded = await GeminicliPermissions.fromFile({ baseDir: testDir });
    const json = loaded.toRulesyncPermissions().getJson();
    expect(json.permission).toEqual({});
  });

  it("should throw a descriptive error on malformed TOML", () => {
    const geminiPermissions = new GeminicliPermissions({
      baseDir: testDir,
      relativeDirPath: join(".gemini", "policies"),
      relativeFilePath: "rulesync.toml",
      fileContent: "[[rule]]\ninvalid !!! :: broken",
    });

    expect(() => geminiPermissions.toRulesyncPermissions()).toThrow(
      /Failed to parse Gemini CLI policy TOML/,
    );
  });

  it("should translate ? as a single-char wildcard that respects path segments", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      baseDir: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: { read: { "file?.ts": "allow" } },
      }),
    });

    const geminiPermissions = await GeminicliPermissions.fromRulesyncPermissions({
      baseDir: testDir,
      rulesyncPermissions,
    });

    const rule = parseRules(geminiPermissions.getFileContent()).find(
      (entry) => entry.toolName === "read_file",
    );
    expect(rule?.argsPattern).toBe('"file[^/\\"]\\.ts\\"');
  });

  it("should round-trip ** patterns back to rulesync", async () => {
    const source = new RulesyncPermissions({
      baseDir: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: { read: { "src/**": "allow" } },
      }),
    });
    const emitted = await GeminicliPermissions.fromRulesyncPermissions({
      baseDir: testDir,
      rulesyncPermissions: source,
    });
    const reloaded = new GeminicliPermissions({
      baseDir: testDir,
      relativeDirPath: join(".gemini", "policies"),
      relativeFilePath: "rulesync.toml",
      fileContent: emitted.getFileContent(),
    });

    const json = reloaded.toRulesyncPermissions().getJson();
    expect(json.permission.read?.["src/**"]).toBe("allow");
  });

  it("should skip patterns containing a quote to avoid regex-anchor hijack", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      baseDir: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: { bash: { '"x":"*"': "allow", "git *": "allow" } },
      }),
    });

    const geminiPermissions = await GeminicliPermissions.fromRulesyncPermissions({
      baseDir: testDir,
      rulesyncPermissions,
    });

    const rules = parseRules(geminiPermissions.getFileContent());
    expect(rules).toHaveLength(1);
    expect(rules[0]?.commandPrefix).toBe("git");
  });

  it("should not allow a malicious pattern to inject a second [[rule]] block", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      baseDir: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          // Newline-based injection attempt: no " or \ so it passes hasUnsafeAnchorChar,
          // but smol-toml must escape the newline and prevent spawning a second rule.
          read: { "safe\n[[rule]]\ndecision = ask_user\npriority = 9999": "deny" },
        },
      }),
    });

    const geminiPermissions = await GeminicliPermissions.fromRulesyncPermissions({
      baseDir: testDir,
      rulesyncPermissions,
    });

    const rules = parseRules(geminiPermissions.getFileContent());
    expect(rules).toHaveLength(1);
    expect(rules[0]?.decision).toBe("deny");
    expect(rules.find((rule) => rule.decision === "ask_user")).toBeUndefined();
  });

  it("should not pollute Object.prototype when importing a rule with toolName __proto__", () => {
    const geminiPermissions = new GeminicliPermissions({
      baseDir: testDir,
      relativeDirPath: join(".gemini", "policies"),
      relativeFilePath: "rulesync.toml",
      fileContent: [
        "[[rule]]",
        'toolName = "__proto__"',
        'decision = "allow"',
        'argsPattern = "pwned"',
        "priority = 999999",
        "",
        "[[rule]]",
        'toolName = "constructor"',
        'decision = "allow"',
        'argsPattern = "pwned2"',
        "priority = 999999",
        "",
      ].join("\n"),
    });

    const json = geminiPermissions.toRulesyncPermissions().getJson();

    expect(json.permission).not.toHaveProperty("__proto__");
    expect(json.permission).not.toHaveProperty("constructor");
    // Smoke-check: a freshly-created object must not inherit a polluted "pwned" / "pwned2" key.
    const probe: Record<string, unknown> = {};
    expect(probe.pwned).toBeUndefined();
    expect(probe.pwned2).toBeUndefined();
  });

  it("should treat glob character classes as regex literals to prevent JSON-boundary bypass", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      baseDir: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          // Negated class `[^a]` would match `"` (34) and could cross JSON-field boundaries.
          // After the fix, `[` and `]` are treated as literals and the `^` is also literal,
          // so the resulting regex does not span fields.
          read: { "[^a]*.ts": "allow" },
        },
      }),
    });

    const geminiPermissions = await GeminicliPermissions.fromRulesyncPermissions({
      baseDir: testDir,
      rulesyncPermissions,
    });

    const rule = parseRules(geminiPermissions.getFileContent()).find(
      (entry) => entry.toolName === "read_file",
    );
    expect(rule?.argsPattern).toBe('"\\[\\^a\\][^/\\"]*\\.ts\\"');
    // The emitted regex must still match literal "[^a]..." only, not exploit field hops.
    const regex = new RegExp(rule?.argsPattern ?? "");
    expect(regex.test('{"path":"[^a]foo.ts"}')).toBe(true);
    expect(regex.test('{"path":"other","hop":"x"}')).toBe(false);
  });

  it("should skip bash match-all patterns with allow or deny decisions", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      baseDir: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: {
            "": "allow",
            "*": "allow",
            "**": "deny",
            "git *": "allow",
          },
        },
      }),
    });

    const geminiPermissions = await GeminicliPermissions.fromRulesyncPermissions({
      baseDir: testDir,
      rulesyncPermissions,
    });

    const rules = parseRules(geminiPermissions.getFileContent());
    expect(rules).toHaveLength(1);
    expect(rules[0]?.commandPrefix).toBe("git");
  });

  it("should still allow bash catch-all with ask decision", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      baseDir: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: { bash: { "*": "ask" } },
      }),
    });

    const geminiPermissions = await GeminicliPermissions.fromRulesyncPermissions({
      baseDir: testDir,
      rulesyncPermissions,
    });

    const rules = parseRules(geminiPermissions.getFileContent());
    expect(rules).toHaveLength(1);
    expect(rules[0]?.decision).toBe("ask_user");
    expect(rules[0]?.commandPrefix).toBeUndefined();
    expect(rules[0]?.argsPattern).toBeUndefined();
  });

  it("should skip empty pattern for non-bash tools", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      baseDir: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: { read: { "": "deny", "src/**": "allow" } },
      }),
    });

    const geminiPermissions = await GeminicliPermissions.fromRulesyncPermissions({
      baseDir: testDir,
      rulesyncPermissions,
    });

    const rules = parseRules(geminiPermissions.getFileContent());
    expect(rules).toHaveLength(1);
    expect(rules[0]?.decision).toBe("allow");
  });

  it("should be deletable because rulesync.toml is exclusively owned by rulesync", async () => {
    const geminiPermissions = GeminicliPermissions.forDeletion({
      baseDir: testDir,
      relativeDirPath: join(".gemini", "policies"),
      relativeFilePath: "rulesync.toml",
    });

    expect(geminiPermissions.isDeletable()).toBe(true);
  });
});

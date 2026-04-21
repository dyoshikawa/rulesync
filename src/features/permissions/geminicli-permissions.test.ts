import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { GeminicliPermissions } from "./geminicli-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

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
    const content = geminiPermissions.getFileContent();
    expect(content).toContain('toolName = "run_shell_command"');
    expect(content).toContain('commandPrefix = "git"');
    expect(content).toContain('decision = "allow"');
    expect(content).toContain('decision = "deny"');
    expect(content).toContain('decision = "ask_user"');
    expect(content).toContain('toolName = "read_file"');
    expect(content).toContain('argsPattern = "\\"src/.*"');
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
    expect(content).toContain("priority = 300");
    expect(content).toContain("priority = 200");
    expect(content).toContain("priority = 100");
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

    const content = geminiPermissions.getFileContent();
    expect(content).toContain('toolName = "run_shell_command"');
    expect(content).toContain('argsPattern = "\\"command\\":\\"rm -rf /tmp/');
    expect(content).not.toContain('commandPrefix = "rm -rf /tmp/*"');
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

  it("should be deletable because rulesync.toml is exclusively owned by rulesync", async () => {
    const geminiPermissions = GeminicliPermissions.forDeletion({
      baseDir: testDir,
      relativeDirPath: join(".gemini", "policies"),
      relativeFilePath: "rulesync.toml",
    });

    expect(geminiPermissions.isDeletable()).toBe(true);
  });
});

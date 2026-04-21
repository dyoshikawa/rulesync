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
    expect(content).toContain('argsPattern = "src/.*"');
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
        "priority = 100",
        "",
        "[[rule]]",
        'toolName = "read_file"',
        'decision = "allow"',
        'argsPattern = "src/.*"',
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
});

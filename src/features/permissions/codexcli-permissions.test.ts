import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CodexcliPermissions } from "./codexcli-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

describe("CodexcliPermissions", () => {
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

  describe("getSettablePaths", () => {
    it("should return .codex and config.toml", () => {
      const paths = CodexcliPermissions.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
      });
    });
  });

  describe("isDeletable", () => {
    it("should return false", () => {
      const instance = new CodexcliPermissions({
        baseDir: testDir,
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: "",
        validate: false,
      });
      expect(instance.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("should convert canonical bash entries to Codex prefix_rules format", async () => {
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(join(testDir, ".codex", "config.toml"), "");

      const config = {
        permissions: [
          { tool: "bash", pattern: ["rm", "-rf", "*"], action: "deny" },
          { tool: "bash", pattern: ["npm", "*"], action: "allow" },
          { tool: "bash", pattern: ["git", "push"], action: "ask" },
        ],
      };

      const rulesyncPermissions = new RulesyncPermissions({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const result = await CodexcliPermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const content = result.getFileContent();
      // Verify TOML output contains prefix_rules
      expect(content).toContain("prefix_rules");

      // Parse to verify structure
      const smolToml = await import("smol-toml");
      const parsed = smolToml.parse(content);
      const rules = parsed.rules as {
        prefix_rules: Array<{ pattern: Array<{ token: string }>; decision: string }>;
      };
      expect(rules.prefix_rules).toHaveLength(3);

      // Check that trailing "*" is omitted (prefix matching)
      const rmRule = rules.prefix_rules.find((r) => r.decision === "forbidden");
      expect(rmRule).toBeDefined();
      expect(rmRule!.pattern).toEqual([{ token: "rm" }, { token: "-rf" }]);

      const npmRule = rules.prefix_rules.find((r) => r.pattern[0]?.token === "npm");
      expect(npmRule).toBeDefined();
      expect(npmRule!.decision).toBe("allow");
      expect(npmRule!.pattern).toEqual([{ token: "npm" }]);

      // ask → prompt
      const gitRule = rules.prefix_rules.find((r) => r.pattern[0]?.token === "git");
      expect(gitRule).toBeDefined();
      expect(gitRule!.decision).toBe("prompt");
    });

    it("should skip non-bash entries and warn", async () => {
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(join(testDir, ".codex", "config.toml"), "");

      const config = {
        permissions: [
          { tool: "bash", pattern: ["npm", "*"], action: "allow" },
          { tool: "read", pattern: ["src", "**"], action: "allow" },
          { tool: "edit", pattern: ["src", "**"], action: "allow" },
        ],
      };

      const rulesyncPermissions = new RulesyncPermissions({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const result = await CodexcliPermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const smolToml = await import("smol-toml");
      const parsed = smolToml.parse(result.getFileContent());
      const rules = parsed.rules as {
        prefix_rules: Array<{ pattern: Array<{ token: string }>; decision: string }>;
      };
      // Only bash entry should be present
      expect(rules.prefix_rules).toHaveLength(1);
    });

    it("should preserve existing TOML keys", async () => {
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(
        join(testDir, ".codex", "config.toml"),
        '[mcp_servers.myserver]\ncommand = "npx"\nargs = ["-y", "my-mcp"]\n',
      );

      const config = {
        permissions: [{ tool: "bash", pattern: ["npm", "*"], action: "allow" }],
      };

      const rulesyncPermissions = new RulesyncPermissions({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const result = await CodexcliPermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const smolToml = await import("smol-toml");
      const parsed = smolToml.parse(result.getFileContent());
      expect(parsed.mcp_servers).toBeDefined();
      expect(parsed.rules).toBeDefined();
    });
  });

  describe("toRulesyncPermissions", () => {
    it("should convert Codex prefix_rules back to canonical", async () => {
      const smolToml = await import("smol-toml");
      const toml = smolToml.stringify({
        rules: {
          prefix_rules: [
            { pattern: [{ token: "rm" }, { token: "-rf" }], decision: "forbidden" },
            { pattern: [{ token: "npm" }], decision: "allow" },
            { pattern: [{ token: "git" }, { token: "push" }], decision: "prompt" },
          ],
        },
      });

      const instance = new CodexcliPermissions({
        baseDir: testDir,
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: toml,
        validate: false,
      });

      const rulesync = instance.toRulesyncPermissions();
      const json = rulesync.getJson();

      expect(json.permissions).toEqual(
        expect.arrayContaining([
          { tool: "bash", pattern: ["rm", "-rf", "*"], action: "deny" },
          { tool: "bash", pattern: ["npm", "*"], action: "allow" },
          { tool: "bash", pattern: ["git", "push", "*"], action: "ask" },
        ]),
      );
    });
  });

  describe("fromFile", () => {
    it("should load from existing config.toml", async () => {
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(
        join(testDir, ".codex", "config.toml"),
        '[[rules.prefix_rules]]\ndecision = "allow"\n\n[[rules.prefix_rules.pattern]]\ntoken = "npm"\n',
      );

      const instance = await CodexcliPermissions.fromFile({ baseDir: testDir });
      expect(instance.getFileContent()).toContain("prefix_rules");
    });

    it("should create empty config if file does not exist", async () => {
      const instance = await CodexcliPermissions.fromFile({ baseDir: testDir });
      // Should not throw
      expect(instance).toBeDefined();
    });
  });
});

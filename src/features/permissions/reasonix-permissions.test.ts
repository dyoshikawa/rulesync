import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { ReasonixPermissions } from "./reasonix-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

describe("ReasonixPermissions", () => {
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
    it("should return the project reasonix.toml path", () => {
      const paths = ReasonixPermissions.getSettablePaths();
      expect(paths).toEqual({ relativeDirPath: ".", relativeFilePath: "reasonix.toml" });
    });

    it("should return the global ~/.reasonix/config.toml path", () => {
      const paths = ReasonixPermissions.getSettablePaths({ global: true });
      expect(paths).toEqual({ relativeDirPath: ".reasonix", relativeFilePath: "config.toml" });
    });
  });

  describe("isDeletable", () => {
    it("should return false because the config file is shared with MCP/other settings", () => {
      const instance = ReasonixPermissions.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "reasonix.toml",
      });

      expect(instance.isDeletable()).toBe(false);
    });
  });

  describe("fromFile", () => {
    it("should load existing reasonix.toml content", async () => {
      await writeFileContent(
        join(testDir, "reasonix.toml"),
        ["[permissions]", 'allow = ["Bash(git *)"]'].join("\n"),
      );

      const instance = await ReasonixPermissions.fromFile({ outputRoot: testDir });
      expect(instance).toBeInstanceOf(ReasonixPermissions);
    });

    it("should use empty default content when the file does not exist", async () => {
      const instance = await ReasonixPermissions.fromFile({ outputRoot: testDir });
      expect(instance).toBeInstanceOf(ReasonixPermissions);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("should convert basic rulesync permissions to Reasonix Tool(specifier) syntax", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            bash: { "git *": "allow", "rm -rf *": "deny", "*": "ask" },
          },
        }),
      });

      const instance = await ReasonixPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const parsed = smolToml.parse(instance.getFileContent()) as any;
      expect(parsed.permissions.allow).toContain("Bash(git *)");
      expect(parsed.permissions.ask).toContain("Bash");
      expect(parsed.permissions.deny).toContain("Bash(rm -rf *)");
    });

    it("should map canonical tool categories to Claude Code-style PascalCase families", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            edit: { "docs/**": "allow" },
            webfetch: { "domain:github.com": "allow" },
            notebookedit: { "*": "deny" },
          },
        }),
      });

      const instance = await ReasonixPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const parsed = smolToml.parse(instance.getFileContent()) as any;
      expect(parsed.permissions.allow).toContain("Edit(docs/**)");
      expect(parsed.permissions.allow).toContain("WebFetch(domain:github.com)");
      expect(parsed.permissions.deny).toContain("NotebookEdit");
    });

    it("should preserve the [[plugins]] MCP table and other top-level keys on round-trip", async () => {
      await writeFileContent(
        join(testDir, "reasonix.toml"),
        [
          'default_model = "deepseek"',
          "",
          "[ui]",
          'theme = "dark"',
          "",
          "[[plugins]]",
          'name = "filesystem"',
          'command = "npx"',
        ].join("\n"),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: { bash: { "npm *": "allow" } },
        }),
      });

      const instance = await ReasonixPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const parsed = smolToml.parse(instance.getFileContent()) as any;
      expect(parsed.default_model).toBe("deepseek");
      expect(parsed.ui.theme).toBe("dark");
      expect(parsed.plugins).toMatchObject([{ name: "filesystem", command: "npx" }]);
      expect(parsed.permissions.allow).toContain("Bash(npm *)");
    });

    it("should preserve an existing mode value untouched (no canonical equivalent)", async () => {
      await writeFileContent(
        join(testDir, "reasonix.toml"),
        ["[permissions]", 'mode = "allow"'].join("\n"),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: { bash: { "npm *": "allow" } },
        }),
      });

      const instance = await ReasonixPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const parsed = smolToml.parse(instance.getFileContent()) as any;
      expect(parsed.permissions.mode).toBe("allow");
    });

    it("should preserve permission entries from tool categories not managed by rulesync", async () => {
      await writeFileContent(
        join(testDir, "reasonix.toml"),
        ["[permissions]", 'deny = ["Read(.env)", "Bash(dangerous *)"]'].join("\n"),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: { bash: { "rm *": "deny" } },
        }),
      });

      const instance = await ReasonixPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const parsed = smolToml.parse(instance.getFileContent()) as any;
      expect(parsed.permissions.deny).toContain("Read(.env)");
      expect(parsed.permissions.deny).toContain("Bash(rm *)");
      expect(parsed.permissions.deny).not.toContain("Bash(dangerous *)");
    });

    it("should warn when permissions overwrites existing Read deny entries from ignore feature", async () => {
      await writeFileContent(
        join(testDir, "reasonix.toml"),
        ["[permissions]", 'deny = ["Read(.env)", "Read(*.secret)"]'].join("\n"),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: { read: { "src/**": "allow" } },
        }),
      });

      const mockLogger = createMockLogger();
      const instance = await ReasonixPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger: mockLogger,
      });

      const parsed = smolToml.parse(instance.getFileContent()) as any;
      expect(parsed.permissions.deny).toBeUndefined();
      expect(parsed.permissions.allow).toContain("Read(src/**)");
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Permissions feature manages 'Read' tool"),
      );
    });

    it("should remove empty arrays from output", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: { bash: { "npm *": "allow" } },
        }),
      });

      const instance = await ReasonixPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const parsed = smolToml.parse(instance.getFileContent()) as any;
      expect(parsed.permissions.allow).toEqual(["Bash(npm *)"]);
      expect(parsed.permissions.ask).toBeUndefined();
      expect(parsed.permissions.deny).toBeUndefined();
    });

    it("should write to the global config path when global is true", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: { bash: { "npm *": "allow" } },
        }),
      });

      const instance = await ReasonixPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        global: true,
      });

      expect(instance.getRelativeDirPath()).toBe(".reasonix");
      expect(instance.getRelativeFilePath()).toBe("config.toml");
    });
  });

  describe("toRulesyncPermissions", () => {
    it("should convert Reasonix Tool(specifier) entries to rulesync canonical format", () => {
      const instance = new ReasonixPermissions({
        relativeDirPath: ".",
        relativeFilePath: "reasonix.toml",
        fileContent: [
          "[permissions]",
          'allow = ["Bash(npm run *)", "Edit(docs/**)"]',
          'ask = ["Bash(git push *)"]',
          'deny = ["Bash(rm -rf *)"]',
        ].join("\n"),
      });

      const rulesyncPermissions = instance.toRulesyncPermissions();
      const config = rulesyncPermissions.getJson();

      expect(config.permission.bash).toEqual({
        "npm run *": "allow",
        "git push *": "ask",
        "rm -rf *": "deny",
      });
      expect(config.permission.edit).toEqual({ "docs/**": "allow" });
    });

    it("should handle bare tool entries without parentheses as a wildcard", () => {
      const instance = new ReasonixPermissions({
        relativeDirPath: ".",
        relativeFilePath: "reasonix.toml",
        fileContent: ["[permissions]", 'allow = ["Bash"]', 'deny = ["WebFetch"]'].join("\n"),
      });

      const rulesyncPermissions = instance.toRulesyncPermissions();
      const config = rulesyncPermissions.getJson();

      expect(config.permission.bash).toEqual({ "*": "allow" });
      expect(config.permission.webfetch).toEqual({ "*": "deny" });
    });

    it("should not import mode (no canonical equivalent)", () => {
      const instance = new ReasonixPermissions({
        relativeDirPath: ".",
        relativeFilePath: "reasonix.toml",
        fileContent: ["[permissions]", 'mode = "deny"', 'allow = ["Bash(git *)"]'].join("\n"),
      });

      const rulesyncPermissions = instance.toRulesyncPermissions();
      const config = rulesyncPermissions.getJson();

      expect(config.permission.bash).toEqual({ "git *": "allow" });
      expect((config as Record<string, unknown>).mode).toBeUndefined();
    });

    it("should handle a missing permissions table", () => {
      const instance = new ReasonixPermissions({
        relativeDirPath: ".",
        relativeFilePath: "reasonix.toml",
        fileContent: 'default_model = "deepseek"',
      });

      const rulesyncPermissions = instance.toRulesyncPermissions();
      const config = rulesyncPermissions.getJson();

      expect(config.permission).toEqual({});
    });

    it("should throw when constructed with invalid TOML content (mirrors reasonix-mcp.ts)", () => {
      // The constructor eagerly parses the TOML content (same pattern as
      // ReasonixMcp), so malformed content throws immediately rather than
      // waiting for an explicit toRulesyncPermissions()/validate() call.
      expect(
        () =>
          new ReasonixPermissions({
            relativeDirPath: ".",
            relativeFilePath: "reasonix.toml",
            fileContent: "not [ valid toml",
          }),
      ).toThrow();
    });
  });

  describe("validate", () => {
    it("should succeed for valid TOML content", () => {
      const instance = new ReasonixPermissions({
        relativeDirPath: ".",
        relativeFilePath: "reasonix.toml",
        fileContent: "[permissions]",
      });

      const result = instance.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("forDeletion", () => {
    it("should create a minimal instance for deletion", () => {
      const instance = ReasonixPermissions.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "reasonix.toml",
      });

      expect(instance).toBeInstanceOf(ReasonixPermissions);
      expect(instance.isDeletable()).toBe(false);
    });
  });
});

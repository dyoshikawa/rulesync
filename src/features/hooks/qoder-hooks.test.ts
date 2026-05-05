import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { QoderHooks } from "./qoder-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

const logger = createMockLogger();

describe("QoderHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return .qoder and settings.json for project mode", () => {
      const paths = QoderHooks.getSettablePaths({ global: false });
      expect(paths).toEqual({ relativeDirPath: ".qoder", relativeFilePath: "settings.json" });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should filter shared hooks to Qoder-supported events and convert to PascalCase", async () => {
      await ensureDir(join(testDir, ".qoder"));
      await writeFileContent(join(testDir, ".qoder", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: ".rulesync/hooks/pre-tool.sh" }],
          stop: [{ command: ".rulesync/hooks/audit.sh" }],
          afterFileEdit: [{ command: "format.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const qoderHooks = await QoderHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = qoderHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.PreToolUse).toBeDefined();
      expect(parsed.hooks.Stop).toBeDefined();
      expect(parsed.hooks.afterFileEdit).toBeUndefined();
    });

    it("should only prefix dot-relative commands with $QODER_PROJECT_DIR", async () => {
      await ensureDir(join(testDir, ".qoder"));
      await writeFileContent(join(testDir, ".qoder", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          preToolUse: [
            { type: "command", command: ".rulesync/hooks/pre-tool.sh" },
            { type: "command", command: "npx prettier --write ." },
          ],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const qoderHooks = await QoderHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(qoderHooks.getFileContent());
      const matcherEntries = parsed.hooks.PreToolUse;
      const hookDefs = matcherEntries[0].hooks;
      expect(hookDefs[0].command).toContain("$QODER_PROJECT_DIR");
      expect(hookDefs[1].command).toBe("npx prettier --write .");
    });

    it("should merge hooks into existing settings.json", async () => {
      await ensureDir(join(testDir, ".qoder"));
      await writeFileContent(
        join(testDir, ".qoder", "settings.json"),
        JSON.stringify({ existingKey: "existingValue" }),
      );

      const config = {
        version: 1,
        hooks: {
          stop: [{ command: ".rulesync/hooks/audit.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const qoderHooks = await QoderHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(qoderHooks.getFileContent());
      expect(parsed.existingKey).toBe("existingValue");
      expect(parsed.hooks.Stop).toBeDefined();
    });

    it("should apply qoder-specific overrides from config", async () => {
      await ensureDir(join(testDir, ".qoder"));
      await writeFileContent(join(testDir, ".qoder", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ command: "shared-cmd.sh" }],
        },
        qoder: {
          hooks: {
            preToolUse: [{ command: "qoder-specific-cmd.sh" }],
          },
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const qoderHooks = await QoderHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        logger,
      });

      const parsed = JSON.parse(qoderHooks.getFileContent());
      expect(parsed.hooks.PreToolUse).toBeDefined();
      const allCommands: string[] = [];
      for (const entry of parsed.hooks.PreToolUse) {
        for (const h of entry.hooks) {
          if (h.command) allCommands.push(h.command);
        }
      }
      expect(allCommands.some((c: string) => c.includes("qoder-specific-cmd.sh"))).toBe(true);
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert Qoder hooks to canonical format", () => {
      const qoderHooks = new QoderHooks({
        outputRoot: testDir,
        relativeDirPath: ".qoder",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            PreToolUse: [{ hooks: [{ type: "command", command: "lint.sh" }] }],
            Stop: [{ hooks: [{ type: "command", command: "cleanup.sh" }] }],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = qoderHooks.toRulesyncHooks();
      const parsed = JSON.parse(rulesyncHooks.getFileContent());

      expect(parsed.hooks.preToolUse).toBeDefined();
      expect(parsed.hooks.stop).toBeDefined();
      expect(parsed.hooks.PreToolUse).toBeUndefined();
    });

    it("should handle empty hooks object", () => {
      const qoderHooks = new QoderHooks({
        outputRoot: testDir,
        relativeDirPath: ".qoder",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ hooks: {} }),
        validate: false,
      });

      const rulesyncHooks = qoderHooks.toRulesyncHooks();
      const parsed = JSON.parse(rulesyncHooks.getFileContent());

      expect(parsed.hooks).toEqual({});
    });
  });

  describe("fromFile", () => {
    it("should load hooks from settings.json", async () => {
      await ensureDir(join(testDir, ".qoder"));
      await writeFileContent(
        join(testDir, ".qoder", "settings.json"),
        JSON.stringify({
          hooks: {
            PreToolUse: [{ hooks: [{ type: "command", command: "lint.sh" }] }],
          },
        }),
      );

      const qoderHooks = await QoderHooks.fromFile({
        outputRoot: testDir,
      });

      expect(qoderHooks).toBeInstanceOf(QoderHooks);
      const parsed = JSON.parse(qoderHooks.getFileContent());
      expect(parsed.hooks.PreToolUse).toBeDefined();
    });

    it("should return default when file does not exist", async () => {
      const qoderHooks = await QoderHooks.fromFile({
        outputRoot: testDir,
      });

      expect(qoderHooks).toBeInstanceOf(QoderHooks);
      const parsed = JSON.parse(qoderHooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });
  });

  describe("validate", () => {
    it("should always return successful validation", () => {
      const qoderHooks = new QoderHooks({
        outputRoot: testDir,
        relativeDirPath: ".qoder",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ hooks: {} }),
        validate: false,
      });

      const result = qoderHooks.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("isDeletable", () => {
    it("should return false (settings.json is shared)", () => {
      const qoderHooks = new QoderHooks({
        outputRoot: testDir,
        relativeDirPath: ".qoder",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ hooks: {} }),
        validate: false,
      });

      expect(qoderHooks.isDeletable()).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create an instance for deletion with empty hooks", () => {
      const qoderHooks = QoderHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".qoder",
        relativeFilePath: "settings.json",
      });

      expect(qoderHooks).toBeInstanceOf(QoderHooks);
      const parsed = JSON.parse(qoderHooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });
  });
});

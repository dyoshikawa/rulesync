import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { JunieHooks } from "./junie-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("JunieHooks", () => {
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
    it("should return .junie and config.json for project mode", () => {
      const paths = JunieHooks.getSettablePaths({ global: false });
      expect(paths).toEqual({ relativeDirPath: ".junie", relativeFilePath: "config.json" });
    });

    it("should return .junie and config.json for global mode", () => {
      const paths = JunieHooks.getSettablePaths({ global: true });
      expect(paths).toEqual({ relativeDirPath: ".junie", relativeFilePath: "config.json" });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should emit hooks.SessionStart from a canonical sessionStart hook and drop unsupported events", async () => {
      await ensureDir(join(testDir, ".junie"));
      await writeFileContent(join(testDir, ".junie", "config.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
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

      const junieHooks = await JunieHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(junieHooks.getFileContent());
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(JSON.stringify(parsed.hooks.SessionStart)).toContain(
        ".rulesync/hooks/session-start.sh",
      );
      // Junie supports only sessionStart, so `stop` is dropped.
      expect(parsed.hooks.Stop).toBeUndefined();
    });

    it("should preserve a pre-existing unrelated key in config.json", async () => {
      await ensureDir(join(testDir, ".junie"));
      await writeFileContent(
        join(testDir, ".junie", "config.json"),
        JSON.stringify({ otherKey: "preserved" }),
      );

      const config = {
        version: 1,
        hooks: { sessionStart: [{ command: "echo" }] },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const junieHooks = await JunieHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(junieHooks.getFileContent());
      expect(parsed.otherKey).toBe("preserved");
      expect(parsed.hooks.SessionStart).toBeDefined();
    });

    it("should throw error with descriptive message when existing config.json contains invalid JSON", async () => {
      await ensureDir(join(testDir, ".junie"));
      await writeFileContent(join(testDir, ".junie", "config.json"), "invalid json {");

      const config = { version: 1, hooks: {} };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      await expect(
        JunieHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks,
          validate: false,
        }),
      ).rejects.toThrow(/Failed to parse existing Junie config/);
    });
  });

  describe("fromFile", () => {
    it("should load from .junie/config.json when it exists", async () => {
      await ensureDir(join(testDir, ".junie"));
      await writeFileContent(
        join(testDir, ".junie", "config.json"),
        JSON.stringify({ hooks: { SessionStart: [] } }),
      );

      const junieHooks = await JunieHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(junieHooks).toBeInstanceOf(JunieHooks);
      const parsed = JSON.parse(junieHooks.getFileContent());
      expect(parsed.hooks.SessionStart).toEqual([]);
    });

    it("should initialize empty hooks when .junie/config.json does not exist", async () => {
      const junieHooks = await JunieHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(junieHooks).toBeInstanceOf(JunieHooks);
      const parsed = JSON.parse(junieHooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert Junie PascalCase hooks to canonical camelCase (round-trip)", () => {
      const junieHooks = new JunieHooks({
        outputRoot: testDir,
        relativeDirPath: ".junie",
        relativeFilePath: "config.json",
        fileContent: JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: "session-start.sh" }] }],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = junieHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart).toHaveLength(1);
      expect(json.hooks.sessionStart?.[0]?.command).toContain("session-start.sh");
    });

    it("should throw error with descriptive message when content contains invalid JSON", () => {
      const junieHooks = new JunieHooks({
        outputRoot: testDir,
        relativeDirPath: ".junie",
        relativeFilePath: "config.json",
        fileContent: "invalid json {",
        validate: false,
      });

      expect(() => junieHooks.toRulesyncHooks()).toThrow(/Failed to parse Junie hooks content/);
    });
  });

  describe("isDeletable", () => {
    it("should return false", () => {
      const hooks = new JunieHooks({
        outputRoot: testDir,
        relativeDirPath: ".junie",
        relativeFilePath: "config.json",
        fileContent: "{}",
        validate: false,
      });
      expect(hooks.isDeletable()).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should return JunieHooks instance with empty hooks for deletion path", () => {
      const hooks = JunieHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".junie",
        relativeFilePath: "config.json",
      });
      expect(hooks).toBeInstanceOf(JunieHooks);
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });
  });
});

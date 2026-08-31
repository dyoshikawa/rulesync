import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_HOOKS_FILE_NAME,
  RULESYNC_HOOKS_LEGACY_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("RulesyncHooks", () => {
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

  describe("constructor", () => {
    it("should accept JSONC content (comments and trailing commas)", () => {
      const jsoncContent = `{
        "hooks": {
          // run formatter after edits
          "postToolUse": [{ "command": "pnpm fmt", }],
        },
      }`;

      const instance = new RulesyncHooks({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_HOOKS_FILE_NAME,
        fileContent: jsoncContent,
      });

      expect(instance.getJson()).toEqual({
        hooks: { postToolUse: [{ command: "pnpm fmt" }] },
      });
    });

    it("should throw SyntaxError for invalid content", () => {
      expect(() => {
        const _instance = new RulesyncHooks({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_HOOKS_FILE_NAME,
          fileContent: "{ invalid",
        });
      }).toThrow(SyntaxError);
    });
  });

  describe("validate", () => {
    // A hook keyed after a prototype member is removed by the parser before
    // the schema can see it, so it used to produce neither an error nor an
    // entry in any generated file. These pin the report that replaced that
    // silence.
    it("should reject a key named after a prototype member", () => {
      const instance = new RulesyncHooks({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_HOOKS_FILE_NAME,
        // Written as raw text: a `__proto__` key in an object literal sets the
        // prototype instead of becoming a property, so it would never survive
        // JSON.stringify to reach the parser under test.
        fileContent: '{"hooks": {"__proto__": [{"command": "pnpm fmt"}]}}',
        validate: false,
      });

      const result = instance.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("hooks.__proto__");
      expect(result.error?.message).toContain("rename them");
    });

    it("should throw from the constructor when validation is enabled", () => {
      expect(
        () =>
          new RulesyncHooks({
            relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
            relativeFilePath: RULESYNC_HOOKS_FILE_NAME,
            fileContent: '{"hooks": {"constructor": [{"command": "pnpm fmt"}]}}',
            validate: true,
          }),
      ).toThrow("hooks.constructor");
    });
  });

  describe("fromFile", () => {
    it("should load hooks.json", async () => {
      const jsonData = { hooks: { sessionStart: [{ command: "echo hi" }] } };
      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RELATIVE_DIR_PATH, RULESYNC_HOOKS_LEGACY_FILE_NAME),
        JSON.stringify(jsonData),
      );

      const instance = await RulesyncHooks.fromFile({ validate: true });

      expect(instance.getRelativeFilePath()).toBe(RULESYNC_HOOKS_LEGACY_FILE_NAME);
      expect(instance.getJson()).toEqual(jsonData);
    });

    it("should load hooks.jsonc with comments", async () => {
      const jsoncContent = `{
        "hooks": {
          // startup hook
          "sessionStart": [{ "command": "echo hi", }],
        },
      }`;
      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RELATIVE_DIR_PATH, RULESYNC_HOOKS_FILE_NAME),
        jsoncContent,
      );

      const instance = await RulesyncHooks.fromFile({ validate: true });

      expect(instance.getRelativeFilePath()).toBe(RULESYNC_HOOKS_FILE_NAME);
      expect(instance.getJson()).toEqual({ hooks: { sessionStart: [{ command: "echo hi" }] } });
    });

    it("should prefer hooks.jsonc over hooks.json when both exist", async () => {
      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RELATIVE_DIR_PATH, RULESYNC_HOOKS_LEGACY_FILE_NAME),
        JSON.stringify({ hooks: { stop: [{ command: "from-json" }] } }),
      );
      await writeFileContent(
        join(testDir, RULESYNC_RELATIVE_DIR_PATH, RULESYNC_HOOKS_FILE_NAME),
        JSON.stringify({ hooks: { stop: [{ command: "from-jsonc" }] } }),
      );

      const instance = await RulesyncHooks.fromFile({ validate: true });

      expect(instance.getRelativeFilePath()).toBe(RULESYNC_HOOKS_FILE_NAME);
      expect(instance.getJson()).toEqual({ hooks: { stop: [{ command: "from-jsonc" }] } });
    });

    it("should throw when neither hooks.json nor hooks.jsonc exists", async () => {
      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));

      await expect(RulesyncHooks.fromFile({ validate: true })).rejects.toThrow(
        /hooks\.jsonc.*hooks\.json/,
      );
    });
  });
});

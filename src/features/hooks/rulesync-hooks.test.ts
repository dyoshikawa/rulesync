import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
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

  describe("fromFile", () => {
    it("reads hooks.json", async () => {
      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RELATIVE_DIR_PATH, "hooks.json"),
        JSON.stringify({ hooks: { sessionStart: [{ command: "echo start" }] } }),
      );

      const hooks = await RulesyncHooks.fromFile({ validate: true });
      expect(hooks.getJson().hooks.sessionStart).toEqual([{ command: "echo start" }]);
    });

    it("prefers hooks.jsonc over hooks.json when both exist", async () => {
      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RELATIVE_DIR_PATH, "hooks.json"),
        JSON.stringify({ hooks: { stop: [{ command: "echo from-json" }] } }),
      );
      await writeFileContent(
        join(testDir, RULESYNC_RELATIVE_DIR_PATH, "hooks.jsonc"),
        [
          "{",
          "  // JSONC comment",
          '  "hooks": { "stop": [{ "command": "echo from-jsonc", }], },',
          "}",
        ].join("\n"),
      );

      const hooks = await RulesyncHooks.fromFile({ validate: true });
      expect(hooks.getRelativeFilePath()).toBe("hooks.jsonc");
      expect(hooks.getJson().hooks.stop).toEqual([{ command: "echo from-jsonc" }]);
    });

    it("throws when neither hooks.json nor hooks.jsonc exists", async () => {
      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await expect(RulesyncHooks.fromFile({ validate: true })).rejects.toThrow(/No .*hooks\.json/);
    });
  });
});

import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { hooksTools } from "./hooks.js";

describe("Hooks Tools", () => {
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

  describe("getHooksFile", () => {
    it("should get the hooks configuration file", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      const hooksConfig = {
        hooks: {
          preToolUse: [
            {
              command: "echo pre",
              type: "command",
            },
          ],
        },
      };

      await writeFileContent(join(rulesyncDir, "hooks.json"), JSON.stringify(hooksConfig, null, 2));

      const result = await hooksTools.getHooksFile.execute();
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(RULESYNC_HOOKS_RELATIVE_FILE_PATH);
      const contentParsed = JSON.parse(parsed.content);
      expect(contentParsed.hooks.preToolUse[0].command).toBe("echo pre");
    });

    it("should throw error for non-existent hooks file", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      await expect(hooksTools.getHooksFile.execute()).rejects.toThrow();
    });
  });

  describe("putHooksFile", () => {
    it("should create a new hooks file", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      const hooksConfig = {
        hooks: {
          sessionStart: [
            {
              command: "echo start",
              type: "command",
            },
          ],
        },
      };

      const result = await hooksTools.putHooksFile.execute({
        content: JSON.stringify(hooksConfig, null, 2),
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(RULESYNC_HOOKS_RELATIVE_FILE_PATH);
      const contentParsed = JSON.parse(parsed.content);
      expect(contentParsed.hooks.sessionStart[0].command).toBe("echo start");

      // Verify round-trip via get
      const getResult = await hooksTools.getHooksFile.execute();
      const getParsed = JSON.parse(getResult);
      const getContentParsed = JSON.parse(getParsed.content);
      expect(getContentParsed.hooks.sessionStart[0].command).toBe("echo start");
    });

    it("should reject invalid JSON content", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      await expect(
        hooksTools.putHooksFile.execute({
          content: "not valid json {{{",
        }),
      ).rejects.toThrow(/Invalid JSON format/i);
    });

    it("should reject oversized hooks files", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      const largeValue = "a".repeat(1024 * 1024 + 1);
      const largeContent = JSON.stringify({
        hooks: {
          sessionStart: [
            {
              command: largeValue,
              type: "command",
            },
          ],
        },
      });

      await expect(
        hooksTools.putHooksFile.execute({
          content: largeContent,
        }),
      ).rejects.toThrow(/exceeds maximum/i);
    });
  });

  describe("deleteHooksFile", () => {
    it("should delete an existing hooks file", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      const hooksConfig = {
        hooks: {
          sessionStart: [
            {
              command: "echo start",
              type: "command",
            },
          ],
        },
      };

      await writeFileContent(join(rulesyncDir, "hooks.json"), JSON.stringify(hooksConfig, null, 2));

      // Verify it exists
      await expect(hooksTools.getHooksFile.execute()).resolves.toBeDefined();

      // Delete it
      const result = await hooksTools.deleteHooksFile.execute();
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(RULESYNC_HOOKS_RELATIVE_FILE_PATH);

      // Verify it's deleted
      await expect(hooksTools.getHooksFile.execute()).rejects.toThrow();
    });

    it("should succeed when deleting non-existent hooks file (idempotent)", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      const result = await hooksTools.deleteHooksFile.execute();
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(RULESYNC_HOOKS_RELATIVE_FILE_PATH);
    });
  });
});

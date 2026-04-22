import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { permissionsTools } from "./permissions.js";

describe("Permissions Tools", () => {
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

  describe("getPermissionsFile", () => {
    it("should get the permissions configuration file", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      const permissionsConfig = {
        permission: {
          bash: {
            "*": "ask",
            "git *": "allow",
            "rm *": "deny",
          },
        },
      };

      await writeFileContent(
        join(rulesyncDir, "permissions.json"),
        JSON.stringify(permissionsConfig, null, 2),
      );

      const result = await permissionsTools.getPermissionsFile.execute();
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH);
      const contentParsed = JSON.parse(parsed.content);
      expect(contentParsed.permission.bash["git *"]).toBe("allow");
    });

    it("should throw error for non-existent permissions file", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      await expect(permissionsTools.getPermissionsFile.execute()).rejects.toThrow();
    });
  });

  describe("putPermissionsFile", () => {
    it("should create a new permissions file", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      const permissionsConfig = {
        permission: {
          bash: {
            "*": "ask",
          },
        },
      };

      const result = await permissionsTools.putPermissionsFile.execute({
        content: JSON.stringify(permissionsConfig, null, 2),
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH);
      const contentParsed = JSON.parse(parsed.content);
      expect(contentParsed.permission.bash["*"]).toBe("ask");

      // Verify round-trip via get
      const getResult = await permissionsTools.getPermissionsFile.execute();
      const getParsed = JSON.parse(getResult);
      const getContentParsed = JSON.parse(getParsed.content);
      expect(getContentParsed.permission.bash["*"]).toBe("ask");
    });

    it("should reject invalid JSON content", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      await expect(
        permissionsTools.putPermissionsFile.execute({
          content: "not valid json {{{",
        }),
      ).rejects.toThrow(/Invalid JSON format/i);
    });

    it("should reject oversized permissions files", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      const largeValue = "a".repeat(1024 * 1024 + 1);
      const largeContent = JSON.stringify({
        permission: {
          bash: {
            [largeValue]: "allow",
          },
        },
      });

      await expect(
        permissionsTools.putPermissionsFile.execute({
          content: largeContent,
        }),
      ).rejects.toThrow(/exceeds maximum/i);
    });
  });

  describe("deletePermissionsFile", () => {
    it("should delete an existing permissions file", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      const permissionsConfig = {
        permission: {
          bash: {
            "*": "ask",
          },
        },
      };

      await writeFileContent(
        join(rulesyncDir, "permissions.json"),
        JSON.stringify(permissionsConfig, null, 2),
      );

      // Verify it exists
      await expect(permissionsTools.getPermissionsFile.execute()).resolves.toBeDefined();

      // Delete it
      const result = await permissionsTools.deletePermissionsFile.execute();
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH);

      // Verify it's deleted
      await expect(permissionsTools.getPermissionsFile.execute()).rejects.toThrow();
    });

    it("should succeed when deleting non-existent permissions file (idempotent)", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      const result = await permissionsTools.deletePermissionsFile.execute();
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH);
    });
  });
});

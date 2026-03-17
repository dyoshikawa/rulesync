import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { PermissionsProcessor } from "./permissions-processor.js";

describe("PermissionsProcessor", () => {
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
    it("should accept valid tool targets", () => {
      expect(
        () => new PermissionsProcessor({ baseDir: testDir, toolTarget: "claudecode" }),
      ).not.toThrow();
      expect(
        () => new PermissionsProcessor({ baseDir: testDir, toolTarget: "opencode" }),
      ).not.toThrow();
      expect(
        () => new PermissionsProcessor({ baseDir: testDir, toolTarget: "codexcli" }),
      ).not.toThrow();
    });

    it("should reject invalid tool targets", () => {
      expect(() => new PermissionsProcessor({ baseDir: testDir, toolTarget: "cursor" })).toThrow(
        "Invalid tool target for PermissionsProcessor",
      );
    });
  });

  describe("getToolTargets", () => {
    it("should return supported targets for project mode", () => {
      const targets = PermissionsProcessor.getToolTargets();
      expect(targets).toEqual(expect.arrayContaining(["claudecode", "opencode", "codexcli"]));
    });

    it("should return empty for global mode", () => {
      const targets = PermissionsProcessor.getToolTargets({ global: true });
      expect(targets).toEqual([]);
    });

    it("should return importable targets when importOnly is true", () => {
      const targets = PermissionsProcessor.getToolTargets({ importOnly: true });
      expect(targets).toContain("claudecode");
      expect(targets).toContain("opencode");
      expect(targets).not.toContain("codexcli");
    });
  });

  describe("loadRulesyncFiles", () => {
    it("should load permissions.json from .rulesync", async () => {
      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RELATIVE_DIR_PATH, "permissions.json"),
        JSON.stringify({
          permissions: [{ tool: "bash", pattern: ["npm", "*"], action: "allow" }],
        }),
      );

      const processor = new PermissionsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const files = await processor.loadRulesyncFiles();
      expect(files).toHaveLength(1);
    });

    it("should return empty array if permissions.json does not exist", async () => {
      const processor = new PermissionsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const files = await processor.loadRulesyncFiles();
      expect(files).toHaveLength(0);
    });
  });

  describe("convertRulesyncFilesToToolFiles", () => {
    it("should convert for claudecode target", async () => {
      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RELATIVE_DIR_PATH, "permissions.json"),
        JSON.stringify({
          permissions: [{ tool: "bash", pattern: ["npm", "*"], action: "allow" }],
        }),
      );

      const processor = new PermissionsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      expect(toolFiles).toHaveLength(1);

      const content = JSON.parse(toolFiles[0]!.getFileContent());
      expect(content.permissions.allow).toEqual(["Bash(npm *)"]);
    });

    it("should convert for opencode target", async () => {
      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RELATIVE_DIR_PATH, "permissions.json"),
        JSON.stringify({
          permissions: [{ tool: "bash", pattern: ["npm", "*"], action: "allow" }],
        }),
      );

      const processor = new PermissionsProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      expect(toolFiles).toHaveLength(1);

      const content = JSON.parse(toolFiles[0]!.getFileContent());
      expect(content.permission.bash).toEqual({ "npm *": "allow" });
    });

    it("should convert for codexcli target (bash only)", async () => {
      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RELATIVE_DIR_PATH, "permissions.json"),
        JSON.stringify({
          permissions: [
            { tool: "bash", pattern: ["npm", "*"], action: "allow" },
            { tool: "read", pattern: ["src", "**"], action: "allow" },
          ],
        }),
      );

      const processor = new PermissionsProcessor({
        baseDir: testDir,
        toolTarget: "codexcli",
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      expect(toolFiles).toHaveLength(1);
    });
  });
});

import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_AIIGNORE_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { WARP_IGNORE_FILE_NAME } from "../../constants/warp-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { WarpIgnore } from "./warp-ignore.js";

describe("WarpIgnore", () => {
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
    it("should emit .warpindexingignore at the repository root", () => {
      const paths = WarpIgnore.getSettablePaths();

      expect(paths.relativeDirPath).toBe(".");
      expect(paths.relativeFilePath).toBe(WARP_IGNORE_FILE_NAME);
      expect(paths.relativeFilePath).toBe(".warpindexingignore");
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create WarpIgnore from RulesyncIgnore with default outputRoot", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const warpIgnore = WarpIgnore.fromRulesyncIgnore({ rulesyncIgnore });

      expect(warpIgnore).toBeInstanceOf(WarpIgnore);
      expect(warpIgnore.getOutputRoot()).toBe(testDir);
      expect(warpIgnore.getRelativeDirPath()).toBe(".");
      expect(warpIgnore.getRelativeFilePath()).toBe(".warpindexingignore");
      expect(warpIgnore.getFileContent()).toBe(fileContent);
    });

    it("should create WarpIgnore from RulesyncIgnore with custom outputRoot", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: "*.tmp\nbuild/",
      });

      const warpIgnore = WarpIgnore.fromRulesyncIgnore({
        outputRoot: "/custom/base",
        rulesyncIgnore,
      });

      expect(warpIgnore.getFilePath()).toBe("/custom/base/.warpindexingignore");
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with same content", () => {
      const fileContent = "# Generated files\n*.log\n\n# Dependencies\nnode_modules/";
      const warpIgnore = new WarpIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".warpindexingignore",
        fileContent,
      });

      const rulesyncIgnore = warpIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_RELATIVE_FILE_PATH);
    });
  });

  describe("fromFile", () => {
    it("should read .warpindexingignore file from outputRoot", async () => {
      const fileContent = "*.log\nnode_modules/\ndist/";
      await writeFileContent(join(testDir, ".warpindexingignore"), fileContent);

      const warpIgnore = await WarpIgnore.fromFile({ outputRoot: testDir });

      expect(warpIgnore).toBeInstanceOf(WarpIgnore);
      expect(warpIgnore.getRelativeFilePath()).toBe(".warpindexingignore");
      expect(warpIgnore.getFileContent()).toBe(fileContent);
    });

    it("should throw when .warpindexingignore file does not exist", async () => {
      await expect(WarpIgnore.fromFile({ outputRoot: testDir })).rejects.toThrow();
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain content integrity in round-trip conversion", () => {
      const originalContent = "# Warp ignore patterns\n*.log\nnode_modules/\n!.env.example";

      const warpIgnore = new WarpIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".warpindexingignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = warpIgnore.toRulesyncIgnore();
      const roundTrip = WarpIgnore.fromRulesyncIgnore({ outputRoot: testDir, rulesyncIgnore });

      expect(roundTrip.getFileContent()).toBe(originalContent);
      expect(roundTrip.getRelativeFilePath()).toBe(".warpindexingignore");
    });
  });

  describe("inheritance from ToolIgnore", () => {
    it("should inherit getPatterns method (gitignore syntax, comments filtered)", () => {
      const warpIgnore = new WarpIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".warpindexingignore",
        fileContent: "# comment\n*.log\nnode_modules/\n!.env.example",
      });

      expect(warpIgnore.getPatterns()).toEqual(["*.log", "node_modules/", "!.env.example"]);
    });
  });
});

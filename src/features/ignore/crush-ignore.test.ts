import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_AIIGNORE_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CrushIgnore } from "./crush-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("CrushIgnore", () => {
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
    it("should emit .crushignore at the repository root", () => {
      const paths = CrushIgnore.getSettablePaths();

      expect(paths.relativeDirPath).toBe(".");
      expect(paths.relativeFilePath).toBe(".crushignore");
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create CrushIgnore from RulesyncIgnore with default outputRoot", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const crushIgnore = CrushIgnore.fromRulesyncIgnore({ rulesyncIgnore });

      expect(crushIgnore).toBeInstanceOf(CrushIgnore);
      expect(crushIgnore.getOutputRoot()).toBe(testDir);
      expect(crushIgnore.getRelativeDirPath()).toBe(".");
      expect(crushIgnore.getRelativeFilePath()).toBe(".crushignore");
      expect(crushIgnore.getFileContent()).toBe(fileContent);
    });

    it("should create CrushIgnore from RulesyncIgnore with custom outputRoot", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: "*.tmp\nbuild/",
      });

      const crushIgnore = CrushIgnore.fromRulesyncIgnore({
        outputRoot: "/custom/base",
        rulesyncIgnore,
      });

      expect(crushIgnore.getFilePath()).toBe("/custom/base/.crushignore");
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with same content", () => {
      const fileContent = "# Generated files\n*.log\n\n# Dependencies\nnode_modules/";
      const crushIgnore = new CrushIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".crushignore",
        fileContent,
      });

      const rulesyncIgnore = crushIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_RELATIVE_FILE_PATH);
    });
  });

  describe("fromFile", () => {
    it("should read .crushignore file from outputRoot", async () => {
      const fileContent = "*.log\nnode_modules/\ndist/";
      await writeFileContent(join(testDir, ".crushignore"), fileContent);

      const crushIgnore = await CrushIgnore.fromFile({ outputRoot: testDir });

      expect(crushIgnore).toBeInstanceOf(CrushIgnore);
      expect(crushIgnore.getRelativeFilePath()).toBe(".crushignore");
      expect(crushIgnore.getFileContent()).toBe(fileContent);
    });

    it("should throw when .crushignore file does not exist", async () => {
      await expect(CrushIgnore.fromFile({ outputRoot: testDir })).rejects.toThrow();
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain content integrity in round-trip conversion", () => {
      const originalContent = "# Crush ignore patterns\n*.log\nnode_modules/\n!.env.example";

      const crushIgnore = new CrushIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".crushignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = crushIgnore.toRulesyncIgnore();
      const roundTrip = CrushIgnore.fromRulesyncIgnore({ outputRoot: testDir, rulesyncIgnore });

      expect(roundTrip.getFileContent()).toBe(originalContent);
      expect(roundTrip.getRelativeFilePath()).toBe(".crushignore");
    });
  });

  describe("inheritance from ToolIgnore", () => {
    it("should inherit getPatterns method (gitignore syntax, comments filtered)", () => {
      const crushIgnore = new CrushIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".crushignore",
        fileContent: "# comment\n*.log\nnode_modules/\n!.env.example",
      });

      expect(crushIgnore.getPatterns()).toEqual(["*.log", "node_modules/", "!.env.example"]);
    });
  });
});

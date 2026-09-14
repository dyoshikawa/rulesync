import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { TabnineIgnore } from "./tabnine-ignore.js";

describe("TabnineIgnore", () => {
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
    it("should point at .tabnineignore in the project root", () => {
      const paths = TabnineIgnore.getSettablePaths();

      expect(paths.relativeDirPath).toBe(".");
      expect(paths.relativeFilePath).toBe(".tabnineignore");
    });
  });

  describe("constructor", () => {
    it("should create instance with default parameters", () => {
      const tabnineIgnore = new TabnineIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".tabnineignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(tabnineIgnore).toBeInstanceOf(TabnineIgnore);
      expect(tabnineIgnore.getRelativeDirPath()).toBe(".");
      expect(tabnineIgnore.getRelativeFilePath()).toBe(".tabnineignore");
      expect(tabnineIgnore.getFileContent()).toBe("*.log\nnode_modules/");
      expect(tabnineIgnore.getPatterns()).toEqual(["*.log", "node_modules/"]);
    });

    it("should create instance with custom outputRoot", () => {
      const tabnineIgnore = new TabnineIgnore({
        outputRoot: "/custom/path",
        relativeDirPath: ".",
        relativeFilePath: ".tabnineignore",
        fileContent: "*.tmp",
      });

      expect(tabnineIgnore.getFilePath()).toBe(join("/custom/path", ".tabnineignore"));
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with the same content", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const tabnineIgnore = new TabnineIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".tabnineignore",
        fileContent,
      });

      const rulesyncIgnore = tabnineIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_FILE_NAME);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create TabnineIgnore from RulesyncIgnore with default outputRoot", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_FILE_NAME,
        fileContent,
      });

      const tabnineIgnore = TabnineIgnore.fromRulesyncIgnore({ rulesyncIgnore });

      expect(tabnineIgnore).toBeInstanceOf(TabnineIgnore);
      expect(tabnineIgnore.getOutputRoot()).toBe(testDir);
      expect(tabnineIgnore.getRelativeDirPath()).toBe(".");
      expect(tabnineIgnore.getRelativeFilePath()).toBe(".tabnineignore");
      expect(tabnineIgnore.getFileContent()).toBe(fileContent);
    });

    it("should create TabnineIgnore from RulesyncIgnore with custom outputRoot", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_FILE_NAME,
        fileContent: "*.tmp\nbuild/",
      });

      const tabnineIgnore = TabnineIgnore.fromRulesyncIgnore({
        outputRoot: "/custom/base",
        rulesyncIgnore,
      });

      expect(tabnineIgnore.getFilePath()).toBe(join("/custom/base", ".tabnineignore"));
      expect(tabnineIgnore.getFileContent()).toBe("*.tmp\nbuild/");
    });
  });

  describe("fromFile", () => {
    it("should read the .tabnineignore file from outputRoot", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      await writeFileContent(join(testDir, ".tabnineignore"), fileContent);

      const tabnineIgnore = await TabnineIgnore.fromFile({ outputRoot: testDir });

      expect(tabnineIgnore).toBeInstanceOf(TabnineIgnore);
      expect(tabnineIgnore.getRelativeDirPath()).toBe(".");
      expect(tabnineIgnore.getRelativeFilePath()).toBe(".tabnineignore");
      expect(tabnineIgnore.getFileContent()).toBe(fileContent);
    });

    it("should default outputRoot to process.cwd()", async () => {
      await writeFileContent(join(testDir, ".tabnineignore"), "dist/");

      const tabnineIgnore = await TabnineIgnore.fromFile({});

      expect(tabnineIgnore.getOutputRoot()).toBe(testDir);
      expect(tabnineIgnore.getFileContent()).toBe("dist/");
    });

    it("should throw when the .tabnineignore file does not exist", async () => {
      await expect(TabnineIgnore.fromFile({ outputRoot: testDir })).rejects.toThrow();
    });
  });

  describe("forDeletion", () => {
    it("should create an empty instance without validation", () => {
      const tabnineIgnore = TabnineIgnore.forDeletion({
        relativeDirPath: ".",
        relativeFilePath: ".tabnineignore",
      });

      expect(tabnineIgnore.getFileContent()).toBe("");
      expect(tabnineIgnore.getRelativeFilePath()).toBe(".tabnineignore");
    });
  });

  describe("round-trip conversion", () => {
    it("should keep the content intact", () => {
      const fileContent = "# comment\n*.log\n!important.log\nsecrets/\n";
      const original = new TabnineIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".tabnineignore",
        fileContent,
      });

      const restored = TabnineIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: original.toRulesyncIgnore(),
      });

      expect(restored.getFileContent()).toBe(fileContent);
      expect(restored.getPatterns()).toEqual(original.getPatterns());
    });
  });
});

import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { BobIgnore } from "./bob-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("BobIgnore", () => {
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
    it("should point at .bobignore in the project root", () => {
      const paths = BobIgnore.getSettablePaths();

      expect(paths.relativeDirPath).toBe(".");
      expect(paths.relativeFilePath).toBe(".bobignore");
    });
  });

  describe("constructor", () => {
    it("should create instance with default parameters", () => {
      const bobIgnore = new BobIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".bobignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(bobIgnore).toBeInstanceOf(BobIgnore);
      expect(bobIgnore.getRelativeDirPath()).toBe(".");
      expect(bobIgnore.getRelativeFilePath()).toBe(".bobignore");
      expect(bobIgnore.getFileContent()).toBe("*.log\nnode_modules/");
      expect(bobIgnore.getPatterns()).toEqual(["*.log", "node_modules/"]);
    });

    it("should create instance with custom outputRoot", () => {
      const bobIgnore = new BobIgnore({
        outputRoot: "/custom/path",
        relativeDirPath: ".",
        relativeFilePath: ".bobignore",
        fileContent: "*.tmp",
      });

      expect(bobIgnore.getFilePath()).toBe(join("/custom/path", ".bobignore"));
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with the same content", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const bobIgnore = new BobIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".bobignore",
        fileContent,
      });

      const rulesyncIgnore = bobIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_FILE_NAME);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create BobIgnore from RulesyncIgnore with default outputRoot", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_FILE_NAME,
        fileContent,
      });

      const bobIgnore = BobIgnore.fromRulesyncIgnore({ rulesyncIgnore });

      expect(bobIgnore).toBeInstanceOf(BobIgnore);
      expect(bobIgnore.getOutputRoot()).toBe(testDir);
      expect(bobIgnore.getRelativeDirPath()).toBe(".");
      expect(bobIgnore.getRelativeFilePath()).toBe(".bobignore");
      expect(bobIgnore.getFileContent()).toBe(fileContent);
    });

    it("should create BobIgnore from RulesyncIgnore with custom outputRoot", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_FILE_NAME,
        fileContent: "*.tmp\nbuild/",
      });

      const bobIgnore = BobIgnore.fromRulesyncIgnore({
        outputRoot: "/custom/base",
        rulesyncIgnore,
      });

      expect(bobIgnore.getFilePath()).toBe(join("/custom/base", ".bobignore"));
      expect(bobIgnore.getFileContent()).toBe("*.tmp\nbuild/");
    });
  });

  describe("fromFile", () => {
    it("should read the .bobignore file from outputRoot", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      await writeFileContent(join(testDir, ".bobignore"), fileContent);

      const bobIgnore = await BobIgnore.fromFile({ outputRoot: testDir });

      expect(bobIgnore).toBeInstanceOf(BobIgnore);
      expect(bobIgnore.getRelativeDirPath()).toBe(".");
      expect(bobIgnore.getRelativeFilePath()).toBe(".bobignore");
      expect(bobIgnore.getFileContent()).toBe(fileContent);
    });

    it("should default outputRoot to process.cwd()", async () => {
      await writeFileContent(join(testDir, ".bobignore"), "dist/");

      const bobIgnore = await BobIgnore.fromFile({});

      expect(bobIgnore.getOutputRoot()).toBe(testDir);
      expect(bobIgnore.getFileContent()).toBe("dist/");
    });

    it("should throw when the .bobignore file does not exist", async () => {
      await expect(BobIgnore.fromFile({ outputRoot: testDir })).rejects.toThrow();
    });
  });

  describe("forDeletion", () => {
    it("should create an empty instance without validation", () => {
      const bobIgnore = BobIgnore.forDeletion({
        relativeDirPath: ".",
        relativeFilePath: ".bobignore",
      });

      expect(bobIgnore.getFileContent()).toBe("");
      expect(bobIgnore.getRelativeFilePath()).toBe(".bobignore");
    });
  });

  describe("round-trip conversion", () => {
    it("should keep the content intact", () => {
      const fileContent = "# comment\n*.log\n!important.log\nsecrets/\n";
      const original = new BobIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".bobignore",
        fileContent,
      });

      const restored = BobIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: original.toRulesyncIgnore(),
      });

      expect(restored.getFileContent()).toBe(fileContent);
      expect(restored.getPatterns()).toEqual(original.getPatterns());
    });
  });
});

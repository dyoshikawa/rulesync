import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ContinueIgnore } from "./continue-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

const makeRulesyncIgnore = (fileContent: string): RulesyncIgnore =>
  new RulesyncIgnore({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
    fileContent,
  });

describe("ContinueIgnore", () => {
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
    it("targets the workspace-root .continueignore in project mode", () => {
      expect(ContinueIgnore.getSettablePaths()).toEqual({
        relativeDirPath: ".",
        relativeFilePath: ".continueignore",
      });
    });

    it("targets ~/.continue/.continueignore in global mode", () => {
      expect(ContinueIgnore.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: ".continue",
        relativeFilePath: ".continueignore",
      });
    });
  });

  describe("constructor", () => {
    it("creates an instance holding the given content", () => {
      const ignore = new ContinueIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".continueignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(ignore.getRelativeDirPath()).toBe(".");
      expect(ignore.getRelativeFilePath()).toBe(".continueignore");
      expect(ignore.getFileContent()).toBe("*.log\nnode_modules/");
    });
  });

  describe("toRulesyncIgnore", () => {
    it("converts to a RulesyncIgnore with the same content", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const ignore = new ContinueIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".continueignore",
        fileContent,
      });

      const rulesyncIgnore = ignore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_FILE_NAME);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("writes .continueignore at the workspace root in project mode", () => {
      const ignore = ContinueIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: makeRulesyncIgnore("dist/\n*.log"),
      });

      expect(ignore.getRelativeDirPath()).toBe(".");
      expect(ignore.getRelativeFilePath()).toBe(".continueignore");
      expect(ignore.getFileContent()).toBe("dist/\n*.log");
      expect(ignore.getFilePath()).toBe(join(testDir, ".continueignore"));
    });

    it("writes ~/.continue/.continueignore in global mode", () => {
      const ignore = ContinueIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: makeRulesyncIgnore("secrets/"),
        global: true,
      });

      expect(ignore.getRelativeDirPath()).toBe(".continue");
      expect(ignore.getFilePath()).toBe(join(testDir, ".continue", ".continueignore"));
    });
  });

  describe("fromFile", () => {
    it("reads the workspace-root .continueignore", async () => {
      await writeFileContent(join(testDir, ".continueignore"), "build/\n*.tmp");

      const ignore = await ContinueIgnore.fromFile({ outputRoot: testDir });

      expect(ignore.getRelativeDirPath()).toBe(".");
      expect(ignore.getFileContent()).toBe("build/\n*.tmp");
    });

    it("reads ~/.continue/.continueignore in global mode", async () => {
      await ensureDir(join(testDir, ".continue"));
      await writeFileContent(join(testDir, ".continue", ".continueignore"), "*.pem");

      const ignore = await ContinueIgnore.fromFile({ outputRoot: testDir, global: true });

      expect(ignore.getRelativeDirPath()).toBe(".continue");
      expect(ignore.getFileContent()).toBe("*.pem");
    });

    it("throws when the file does not exist", async () => {
      await expect(ContinueIgnore.fromFile({ outputRoot: testDir })).rejects.toThrow();
    });
  });

  describe("forDeletion", () => {
    it("creates an empty instance at the given path", () => {
      const ignore = ContinueIgnore.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".continueignore",
      });

      expect(ignore.getFileContent()).toBe("");
      expect(ignore.getRelativeFilePath()).toBe(".continueignore");
    });
  });
});

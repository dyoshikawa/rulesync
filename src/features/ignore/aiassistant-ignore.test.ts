import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AiassistantIgnore } from "./aiassistant-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("AiassistantIgnore", () => {
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
    it("targets the project-root .aiignore", () => {
      const paths = AiassistantIgnore.getSettablePaths();
      expect(paths.relativeDirPath).toBe(".");
      expect(paths.relativeFilePath).toBe(".aiignore");
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("writes the ignore content to .aiignore", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: "tmp/\n*.log",
      });

      const ignore = AiassistantIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore,
      });

      expect(ignore.getRelativeDirPath()).toBe(".");
      expect(ignore.getRelativeFilePath()).toBe(".aiignore");
      expect(ignore.getFileContent()).toBe("tmp/\n*.log");
    });
  });

  describe("fromFile", () => {
    it("reads the project-root .aiignore", async () => {
      await ensureDir(testDir);
      await writeFileContent(join(testDir, ".aiignore"), "secrets/\n.env");

      const ignore = await AiassistantIgnore.fromFile({ outputRoot: testDir });

      expect(ignore.getRelativeFilePath()).toBe(".aiignore");
      expect(ignore.getFileContent()).toBe("secrets/\n.env");
    });
  });

  describe("toRulesyncIgnore round-trip", () => {
    it("preserves the content", () => {
      const ignore = new AiassistantIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: "build/\ndist/",
      });

      expect(ignore.toRulesyncIgnore().getFileContent()).toBe("build/\ndist/");
    });
  });

  describe("forDeletion", () => {
    it("returns an instance with empty content", () => {
      const ignore = AiassistantIgnore.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
      });
      expect(ignore).toBeInstanceOf(AiassistantIgnore);
      expect(ignore.getFileContent()).toBe("");
    });
  });
});

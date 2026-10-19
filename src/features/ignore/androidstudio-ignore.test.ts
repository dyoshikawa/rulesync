import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AndroidstudioIgnore } from "./androidstudio-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("AndroidstudioIgnore", () => {
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
    it("targets the project-root .aiexclude", () => {
      const paths = AndroidstudioIgnore.getSettablePaths();
      expect(paths.relativeDirPath).toBe(".");
      expect(paths.relativeFilePath).toBe(".aiexclude");
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("writes the ignore content to .aiexclude", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: "tmp/\n*.log",
      });

      const ignore = AndroidstudioIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore,
      });

      expect(ignore.getRelativeDirPath()).toBe(".");
      expect(ignore.getRelativeFilePath()).toBe(".aiexclude");
      expect(ignore.getFileContent()).toBe("tmp/\n*.log");
    });
  });

  describe("fromFile", () => {
    it("reads the project-root .aiexclude", async () => {
      await ensureDir(testDir);
      await writeFileContent(join(testDir, ".aiexclude"), "secrets/\n.env");

      const ignore = await AndroidstudioIgnore.fromFile({ outputRoot: testDir });

      expect(ignore.getRelativeFilePath()).toBe(".aiexclude");
      expect(ignore.getFileContent()).toBe("secrets/\n.env");
    });
  });

  describe("toRulesyncIgnore round-trip", () => {
    it("preserves the content", () => {
      const ignore = new AndroidstudioIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        fileContent: "build/\ndist/",
      });

      expect(ignore.toRulesyncIgnore().getFileContent()).toBe("build/\ndist/");
    });
  });

  describe("forDeletion", () => {
    it("returns an instance with empty content", () => {
      const ignore = AndroidstudioIgnore.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
      });
      expect(ignore).toBeInstanceOf(AndroidstudioIgnore);
      expect(ignore.getFileContent()).toBe("");
    });
  });
});

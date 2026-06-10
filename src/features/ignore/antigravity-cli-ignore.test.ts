import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AntigravityCliIgnore } from "./antigravity-cli-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("AntigravityCliIgnore", () => {
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
    it("should create instance with default parameters", () => {
      const antigravityCliIgnore = new AntigravityCliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(antigravityCliIgnore).toBeInstanceOf(AntigravityCliIgnore);
      expect(antigravityCliIgnore.getRelativeDirPath()).toBe(".");
      expect(antigravityCliIgnore.getRelativeFilePath()).toBe(".geminiignore");
      expect(antigravityCliIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });

    it("should create instance with custom outputRoot", () => {
      const antigravityCliIgnore = new AntigravityCliIgnore({
        outputRoot: "/custom/path",
        relativeDirPath: "subdir",
        relativeFilePath: ".geminiignore",
        fileContent: "*.tmp",
      });

      expect(antigravityCliIgnore.getFilePath()).toBe("/custom/path/subdir/.geminiignore");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new AntigravityCliIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".geminiignore",
          fileContent: "", // empty content should be valid
        });
      }).not.toThrow();
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _instance = new AntigravityCliIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".geminiignore",
          fileContent: "any content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("getSettablePaths", () => {
    it("should return the project-root .geminiignore path", () => {
      const paths = AntigravityCliIgnore.getSettablePaths();

      expect(paths.relativeDirPath).toBe(".");
      expect(paths.relativeFilePath).toBe(".geminiignore");
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with same content", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const antigravityCliIgnore = new AntigravityCliIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent,
      });

      const rulesyncIgnore = antigravityCliIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_FILE_NAME);
    });

    it("should handle empty content", () => {
      const antigravityCliIgnore = new AntigravityCliIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent: "",
      });

      const rulesyncIgnore = antigravityCliIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("");
    });

    it("should preserve patterns and formatting", () => {
      const fileContent = "# Generated files\n*.log\n*.tmp\n\n# Dependencies\nnode_modules/\n.env*";
      const antigravityCliIgnore = new AntigravityCliIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent,
      });

      const rulesyncIgnore = antigravityCliIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create AntigravityCliIgnore from RulesyncIgnore with default outputRoot", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const antigravityCliIgnore = AntigravityCliIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(antigravityCliIgnore).toBeInstanceOf(AntigravityCliIgnore);
      expect(antigravityCliIgnore.getOutputRoot()).toBe(testDir);
      expect(antigravityCliIgnore.getRelativeDirPath()).toBe(".");
      expect(antigravityCliIgnore.getRelativeFilePath()).toBe(".geminiignore");
      expect(antigravityCliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should create AntigravityCliIgnore from RulesyncIgnore with custom outputRoot", () => {
      const fileContent = "*.tmp\nbuild/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const antigravityCliIgnore = AntigravityCliIgnore.fromRulesyncIgnore({
        outputRoot: "/custom/base",
        rulesyncIgnore,
      });

      expect(antigravityCliIgnore.getOutputRoot()).toBe("/custom/base");
      expect(antigravityCliIgnore.getFilePath()).toBe("/custom/base/.geminiignore");
      expect(antigravityCliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty content", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: "",
      });

      const antigravityCliIgnore = AntigravityCliIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(antigravityCliIgnore.getFileContent()).toBe("");
    });

    it("should preserve complex patterns", () => {
      const fileContent = "# Comments\n*.log\n**/*.tmp\n!important.tmp\nnode_modules/\n.env*";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const antigravityCliIgnore = AntigravityCliIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(antigravityCliIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFile", () => {
    it("should read .geminiignore file from outputRoot with default outputRoot", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const ignorePath = join(testDir, ".geminiignore");
      await writeFileContent(ignorePath, fileContent);

      const antigravityCliIgnore = await AntigravityCliIgnore.fromFile({
        outputRoot: testDir,
      });

      expect(antigravityCliIgnore).toBeInstanceOf(AntigravityCliIgnore);
      expect(antigravityCliIgnore.getOutputRoot()).toBe(testDir);
      expect(antigravityCliIgnore.getRelativeDirPath()).toBe(".");
      expect(antigravityCliIgnore.getRelativeFilePath()).toBe(".geminiignore");
      expect(antigravityCliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .geminiignore file with validation disabled", async () => {
      const fileContent = "*.log\nnode_modules/";
      const ignorePath = join(testDir, ".geminiignore");
      await writeFileContent(ignorePath, fileContent);

      const antigravityCliIgnore = await AntigravityCliIgnore.fromFile({
        outputRoot: testDir,
        validate: false,
      });

      expect(antigravityCliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty .geminiignore file", async () => {
      const ignorePath = join(testDir, ".geminiignore");
      await writeFileContent(ignorePath, "");

      const antigravityCliIgnore = await AntigravityCliIgnore.fromFile({
        outputRoot: testDir,
      });

      expect(antigravityCliIgnore.getFileContent()).toBe("");
    });

    it("should default outputRoot to process.cwd() when not provided", async () => {
      // process.cwd() is already mocked to return testDir in beforeEach
      const fileContent = "*.log\nnode_modules/";
      const ignorePath = join(testDir, ".geminiignore");
      await writeFileContent(ignorePath, fileContent);

      const antigravityCliIgnore = await AntigravityCliIgnore.fromFile({});

      expect(antigravityCliIgnore.getOutputRoot()).toBe(testDir);
      expect(antigravityCliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should throw error when .geminiignore file does not exist", async () => {
      await expect(
        AntigravityCliIgnore.fromFile({
          outputRoot: testDir,
        }),
      ).rejects.toThrow();
    });
  });

  describe("forDeletion", () => {
    it("should create an instance with empty content for deletion", () => {
      const antigravityCliIgnore = AntigravityCliIgnore.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
      });

      expect(antigravityCliIgnore).toBeInstanceOf(AntigravityCliIgnore);
      expect(antigravityCliIgnore.getFileContent()).toBe("");
      expect(antigravityCliIgnore.getFilePath()).toBe(join(testDir, ".geminiignore"));
    });
  });

  describe("inheritance from ToolIgnore", () => {
    it("should inherit getPatterns method", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const antigravityCliIgnore = new AntigravityCliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent,
      });

      const patterns = antigravityCliIgnore.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain content integrity in round-trip conversion", () => {
      const originalContent = `# Antigravity CLI ignore patterns
*.log
node_modules/
.env*
build/
dist/
*.tmp`;

      // AntigravityCliIgnore -> RulesyncIgnore -> AntigravityCliIgnore
      const originalAntigravityCliIgnore = new AntigravityCliIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalAntigravityCliIgnore.toRulesyncIgnore();
      const roundTripAntigravityCliIgnore = AntigravityCliIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore,
      });

      expect(roundTripAntigravityCliIgnore.getFileContent()).toBe(originalContent);
      expect(roundTripAntigravityCliIgnore.getRelativeFilePath()).toBe(".geminiignore");
    });
  });

  describe("file integration", () => {
    it("should write and read file correctly", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const antigravityCliIgnore = new AntigravityCliIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent,
      });

      await writeFileContent(
        antigravityCliIgnore.getFilePath(),
        antigravityCliIgnore.getFileContent(),
      );

      const readAntigravityCliIgnore = await AntigravityCliIgnore.fromFile({
        outputRoot: testDir,
      });

      expect(readAntigravityCliIgnore.getFileContent()).toBe(fileContent);
      expect(readAntigravityCliIgnore.getPatterns()).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should handle subdirectory placement", async () => {
      const subDir = join(testDir, "project", "config");
      await ensureDir(subDir);

      const fileContent = "*.log\nbuild/";
      const antigravityCliIgnore = new AntigravityCliIgnore({
        outputRoot: testDir,
        relativeDirPath: "project/config",
        relativeFilePath: ".geminiignore",
        fileContent,
      });

      await writeFileContent(
        antigravityCliIgnore.getFilePath(),
        antigravityCliIgnore.getFileContent(),
      );

      const readAntigravityCliIgnore = await AntigravityCliIgnore.fromFile({
        outputRoot: join(testDir, "project/config"),
      });

      expect(readAntigravityCliIgnore.getFileContent()).toBe(fileContent);
    });
  });
});

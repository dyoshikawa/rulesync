import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_IGNORE_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("RulesyncIgnore", () => {
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
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.log\nnode_modules/",
      });

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_RELATIVE_FILE_PATH);
      expect(rulesyncIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });

    it("should create instance with custom baseDir", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: "/custom/path",
        relativeDirPath: "subdir",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.tmp",
      });

      expect(rulesyncIgnore.getFilePath()).toBe(
        `/custom/path/subdir/${RULESYNC_AIIGNORE_RELATIVE_FILE_PATH}`,
      );
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new RulesyncIgnore({
          relativeDirPath: ".",
          relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
          fileContent: "", // empty content should be valid
        });
      }).not.toThrow();
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _instance = new RulesyncIgnore({
          relativeDirPath: ".",
          relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
          fileContent: "any content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("validate", () => {
    it("should always return success=true", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.log\nnode_modules/",
      });

      const result = rulesyncIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should validate empty content", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "",
      });

      const result = rulesyncIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should validate complex content", () => {
      const complexContent = `# Build outputs
build/
dist/
*.map

# Dependencies
node_modules/
.pnpm-store/

# Environment files
.env*
!.env.example

# IDE files
.vscode/
.idea/

# Logs
*.log
logs/

# Cache
.cache/
*.tmp
*.temp

# OS generated files
.DS_Store
Thumbs.db`;

      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: complexContent,
      });

      const result = rulesyncIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should validate content with special characters", () => {
      const specialContent = "*.log\n節点模块/\n環境.env\n🏗️build/\n**/*.cache";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: specialContent,
      });

      const result = rulesyncIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });
  });

  describe("fromFile", () => {
    it("should read .rulesync/.aiignore file from current directory", async () => {
      // process.cwd() is already mocked to return testDir in beforeEach
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnorePath = join(testDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH);
      await writeFileContent(rulesyncIgnorePath, fileContent);

      const rulesyncIgnore = await RulesyncIgnore.fromFile();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getBaseDir()).toBe(testDir);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_FILE_NAME);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty .rulesync/.aiignore file", async () => {
      // process.cwd() is already mocked to return testDir in beforeEach
      const rulesyncIgnorePath = join(testDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH);
      await writeFileContent(rulesyncIgnorePath, "");

      const rulesyncIgnore = await RulesyncIgnore.fromFile();

      expect(rulesyncIgnore.getFileContent()).toBe("");
    });

    it("should handle .rulesync/.aiignore file with complex patterns", async () => {
      // process.cwd() is already mocked to return testDir in beforeEach
      const fileContent = `# Build outputs
build/
dist/
*.map

# Dependencies
node_modules/
.pnpm-store/

# Environment files
.env*
!.env.example

# IDE files
.vscode/
.idea/

# Logs
*.log
logs/

# Cache
.cache/
*.tmp
*.temp

# OS generated files
.DS_Store
Thumbs.db`;

      const rulesyncIgnorePath = join(testDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH);
      await writeFileContent(rulesyncIgnorePath, fileContent);

      const rulesyncIgnore = await RulesyncIgnore.fromFile();

      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });

    it("should throw error when .rulesync/.aiignore file does not exist", async () => {
      // process.cwd() is already mocked to return testDir in beforeEach
      await expect(RulesyncIgnore.fromFile()).rejects.toThrow();
    });

    it("should handle file with Windows line endings", async () => {
      // process.cwd() is already mocked to return testDir in beforeEach
      const fileContent = "*.log\r\nnode_modules/\r\n.env";
      const rulesyncIgnorePath = join(testDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH);
      await writeFileContent(rulesyncIgnorePath, fileContent);

      const rulesyncIgnore = await RulesyncIgnore.fromFile();

      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle file with mixed line endings", async () => {
      // process.cwd() is already mocked to return testDir in beforeEach
      const fileContent = "*.log\r\nnode_modules/\n.env\r\nbuild/";
      const rulesyncIgnorePath = join(testDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH);
      await writeFileContent(rulesyncIgnorePath, fileContent);

      const rulesyncIgnore = await RulesyncIgnore.fromFile();

      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("inheritance from RulesyncFile", () => {
    it("should inherit file path methods from AiFile", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: "/test/base",
        relativeDirPath: "subdir",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.log",
      });

      expect(rulesyncIgnore.getBaseDir()).toBe("/test/base");
      expect(rulesyncIgnore.getRelativeDirPath()).toBe("subdir");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_RELATIVE_FILE_PATH);
      expect(rulesyncIgnore.getFilePath()).toBe(
        `/test/base/subdir/${RULESYNC_AIIGNORE_RELATIVE_FILE_PATH}`,
      );
      expect(rulesyncIgnore.getFileContent()).toBe("*.log");
      expect(rulesyncIgnore.getRelativePathFromCwd()).toBe(
        `subdir/${RULESYNC_AIIGNORE_RELATIVE_FILE_PATH}`,
      );
    });

    it("should support setFileContent method", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.log",
      });

      const newContent = "*.tmp\nnode_modules/";
      rulesyncIgnore.setFileContent(newContent);

      expect(rulesyncIgnore.getFileContent()).toBe(newContent);
    });
  });

  describe("edge cases", () => {
    it("should handle file content with only whitespace", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "   \n\t\n   ",
      });

      expect(rulesyncIgnore.getFileContent()).toBe("   \n\t\n   ");
    });

    it("should handle very long content", () => {
      const longPattern = "a".repeat(1000);
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: longPattern,
      });

      expect(rulesyncIgnore.getFileContent()).toBe(longPattern);
    });

    it("should handle unicode characters in content", () => {
      const unicodeContent = "*.log\n節点模块/\n環境.env\n🏗️build/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: unicodeContent,
      });

      expect(rulesyncIgnore.getFileContent()).toBe(unicodeContent);
    });

    it("should handle content with null bytes", () => {
      const contentWithNull = "*.log\0node_modules/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: contentWithNull,
        validate: false, // Skip validation for edge case content
      });

      expect(rulesyncIgnore.getFileContent()).toBe(contentWithNull);
    });
  });

  describe("file integration", () => {
    it("should write and read file correctly", async () => {
      // process.cwd() is already mocked to return testDir in beforeEach
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(rulesyncIgnore.getFilePath(), rulesyncIgnore.getFileContent());

      // Read file back from the testDir context
      const readRulesyncIgnore = await RulesyncIgnore.fromFile();

      expect(readRulesyncIgnore.getFileContent()).toBe(fileContent);
    });

    it("should preserve exact file content", async () => {
      // process.cwd() is already mocked to return testDir in beforeEach
      const originalContent = `# RulesyncIgnore patterns
*.log
node_modules/
.env*
build/
dist/
*.tmp`;

      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: originalContent,
      });

      await writeFileContent(rulesyncIgnore.getFilePath(), rulesyncIgnore.getFileContent());

      const readRulesyncIgnore = await RulesyncIgnore.fromFile();

      expect(readRulesyncIgnore.getFileContent()).toBe(originalContent);
    });
  });

  describe("RulesyncIgnore-specific behavior", () => {
    it("should use .rulesync/.aiignore as the filename", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.log",
      });

      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_RELATIVE_FILE_PATH);
    });

    it("should work as a central ignore file", () => {
      const fileContent = `# Central rulesync ignore patterns
# These patterns will be used by all AI tools

# Build outputs
build/
dist/
*.map
out/

# Dependencies
node_modules/
.pnpm-store/
.yarn/

# Environment files
.env*
!.env.example

# IDE and editor files
.vscode/
.idea/
*.swp
*.swo

# Logs
*.log
logs/

# Cache and temporary files
.cache/
*.tmp
*.temp
.turbo/

# OS generated files
.DS_Store
Thumbs.db
desktop.ini`;

      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent,
      });

      // Should preserve all content as-is since RulesyncIgnore is the source of truth
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });

    it("should work in project root context", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: "/project/root",
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.log\nnode_modules/",
      });

      // RulesyncIgnore typically lives in project root
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_RELATIVE_FILE_PATH);
      expect(rulesyncIgnore.getFilePath()).toBe(
        `/project/root/${RULESYNC_AIIGNORE_RELATIVE_FILE_PATH}`,
      );
    });

    it("should maintain content integrity for distribution to other tools", () => {
      const sourceContent = `# Comments should be preserved
*.log

# Empty lines and spacing should be maintained

node_modules/
.env*

# More comments
build/`;

      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: sourceContent,
      });

      // Content should be preserved exactly for distribution to other AI tools
      expect(rulesyncIgnore.getFileContent()).toBe(sourceContent);
    });
  });

  describe("static method behavior", () => {
    it("should use fixed parameters in fromFile method", async () => {
      // process.cwd() is already mocked to return testDir in beforeEach
      const fileContent = "*.log\nnode_modules/";
      const rulesyncIgnorePath = join(testDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH);
      await writeFileContent(rulesyncIgnorePath, fileContent);

      const rulesyncIgnore = await RulesyncIgnore.fromFile();

      // fromFile always uses these fixed parameters
      expect(rulesyncIgnore.getBaseDir()).toBe(testDir);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_FILE_NAME);
    });

    it("should create instance with validation enabled by default", async () => {
      // process.cwd() is already mocked to return testDir in beforeEach
      const fileContent = "*.log\nnode_modules/";
      const rulesyncIgnorePath = join(testDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH);
      await writeFileContent(rulesyncIgnorePath, fileContent);

      const rulesyncIgnore = await RulesyncIgnore.fromFile();

      // Should have been validated during construction
      expect(rulesyncIgnore.validate().success).toBe(true);
    });
  });

  describe("dual source resolution (getSettablePaths)", () => {
    it("should return recommended and legacy paths (aiignore recommended)", async () => {
      const paths = RulesyncIgnore.getSettablePaths();

      expect(paths.recommended.relativeDirPath).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(paths.recommended.relativeFilePath).toBe(RULESYNC_AIIGNORE_FILE_NAME);
      expect(paths.legacy.relativeDirPath).toBe(".");
      expect(paths.legacy.relativeFilePath).toBe(RULESYNC_IGNORE_RELATIVE_FILE_PATH);
    });
  });

  describe("dual source resolution (fromFile)", () => {
    it("should read from .rulesync/.aiignore when present", async () => {
      const content = "# prefer aiignore\ncoverage/\n.out/\n";
      const aiignorePath = join(testDir, RULESYNC_RELATIVE_DIR_PATH, ".aiignore");
      await writeFileContent(aiignorePath, content);

      const rulesyncIgnore = await RulesyncIgnore.fromFile();

      expect(rulesyncIgnore.getBaseDir()).toBe(testDir);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_FILE_NAME);
      expect(rulesyncIgnore.getFileContent()).toBe(content);
    });

    it("should read from .rulesync/.aiignore when both sources exist (recommended takes precedence)", async () => {
      const aiignorePath = join(testDir, RULESYNC_RELATIVE_DIR_PATH, ".aiignore");
      const legacyPath = join(testDir, RULESYNC_IGNORE_RELATIVE_FILE_PATH);
      await writeFileContent(aiignorePath, "ai/\n# from recommended\n");
      await writeFileContent(legacyPath, "legacy/\n");

      const rulesyncIgnore = await RulesyncIgnore.fromFile();
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_FILE_NAME);
      expect(rulesyncIgnore.getFileContent()).toContain("from recommended");
    });
  });
});

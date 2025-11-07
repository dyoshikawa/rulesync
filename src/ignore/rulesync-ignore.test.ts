import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("RulesyncIgnore", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with default parameters", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
      expect(rulesyncIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });

    it("should create instance with custom baseDir", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: "/custom/path",
        relativeDirPath: "subdir",
        relativeFilePath: ".rulesyncignore",
        fileContent: "*.tmp",
      });

      expect(rulesyncIgnore.getFilePath()).toBe("/custom/path/subdir/.rulesyncignore");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new RulesyncIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".rulesyncignore",
          fileContent: "", // empty content should be valid
        });
      }).not.toThrow();
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _instance = new RulesyncIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".rulesyncignore",
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
        relativeFilePath: ".rulesyncignore",
        fileContent: "*.log\nnode_modules/",
      });

      const result = rulesyncIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should validate empty content", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
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
        relativeFilePath: ".rulesyncignore",
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
        relativeFilePath: ".rulesyncignore",
        fileContent: specialContent,
      });

      const result = rulesyncIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });
  });

  describe("fromFile", () => {
    it("should read .rulesyncignore file from current directory", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnorePath = join(testDir, ".rulesyncignore");
      await writeFileContent(rulesyncIgnorePath, fileContent);

      // Change to test directory to simulate reading from current directory
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);

        const rulesyncIgnore = await RulesyncIgnore.fromFile();

        expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
        expect(rulesyncIgnore.getBaseDir()).toBe(testDir);
        expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
        expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
        expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should handle empty .rulesyncignore file", async () => {
      const rulesyncIgnorePath = join(testDir, ".rulesyncignore");
      await writeFileContent(rulesyncIgnorePath, "");

      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);

        const rulesyncIgnore = await RulesyncIgnore.fromFile();

        expect(rulesyncIgnore.getFileContent()).toBe("");
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should handle .rulesyncignore file with complex patterns", async () => {
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

      const rulesyncIgnorePath = join(testDir, ".rulesyncignore");
      await writeFileContent(rulesyncIgnorePath, fileContent);

      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);

        const rulesyncIgnore = await RulesyncIgnore.fromFile();

        expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should throw error when .rulesyncignore file does not exist", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);

        await expect(RulesyncIgnore.fromFile()).rejects.toThrow();
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should handle file with Windows line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/\r\n.env";
      const rulesyncIgnorePath = join(testDir, ".rulesyncignore");
      await writeFileContent(rulesyncIgnorePath, fileContent);

      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);

        const rulesyncIgnore = await RulesyncIgnore.fromFile();

        expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should handle file with mixed line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/\n.env\r\nbuild/";
      const rulesyncIgnorePath = join(testDir, ".rulesyncignore");
      await writeFileContent(rulesyncIgnorePath, fileContent);

      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);

        const rulesyncIgnore = await RulesyncIgnore.fromFile();

        expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe("inheritance from RulesyncFile", () => {
    it("should inherit file path methods from AiFile", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: "/test/base",
        relativeDirPath: "subdir",
        relativeFilePath: ".rulesyncignore",
        fileContent: "*.log",
      });

      expect(rulesyncIgnore.getBaseDir()).toBe("/test/base");
      expect(rulesyncIgnore.getRelativeDirPath()).toBe("subdir");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
      expect(rulesyncIgnore.getFilePath()).toBe("/test/base/subdir/.rulesyncignore");
      expect(rulesyncIgnore.getFileContent()).toBe("*.log");
      expect(rulesyncIgnore.getRelativePathFromCwd()).toBe("subdir/.rulesyncignore");
    });

    it("should support setFileContent method", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
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
        relativeFilePath: ".rulesyncignore",
        fileContent: "   \n\t\n   ",
      });

      expect(rulesyncIgnore.getFileContent()).toBe("   \n\t\n   ");
    });

    it("should handle very long content", () => {
      const longPattern = "a".repeat(1000);
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: longPattern,
      });

      expect(rulesyncIgnore.getFileContent()).toBe(longPattern);
    });

    it("should handle unicode characters in content", () => {
      const unicodeContent = "*.log\n節点模块/\n環境.env\n🏗️build/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: unicodeContent,
      });

      expect(rulesyncIgnore.getFileContent()).toBe(unicodeContent);
    });

    it("should handle content with null bytes", () => {
      const contentWithNull = "*.log\0node_modules/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: contentWithNull,
        validate: false, // Skip validation for edge case content
      });

      expect(rulesyncIgnore.getFileContent()).toBe(contentWithNull);
    });
  });

  describe("file integration", () => {
    it("should write and read file correctly", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(rulesyncIgnore.getFilePath(), rulesyncIgnore.getFileContent());

      // Read file back from the testDir context
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);

        const readRulesyncIgnore = await RulesyncIgnore.fromFile();

        expect(readRulesyncIgnore.getFileContent()).toBe(fileContent);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should preserve exact file content", async () => {
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
        relativeFilePath: ".rulesyncignore",
        fileContent: originalContent,
      });

      await writeFileContent(rulesyncIgnore.getFilePath(), rulesyncIgnore.getFileContent());

      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);

        const readRulesyncIgnore = await RulesyncIgnore.fromFile();

        expect(readRulesyncIgnore.getFileContent()).toBe(originalContent);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe("RulesyncIgnore-specific behavior", () => {
    it("should use .rulesyncignore as the filename", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: "*.log",
      });

      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
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
        relativeFilePath: ".rulesyncignore",
        fileContent,
      });

      // Should preserve all content as-is since RulesyncIgnore is the source of truth
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });

    it("should work in project root context", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: "/project/root",
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: "*.log\nnode_modules/",
      });

      // RulesyncIgnore typically lives in project root
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
      expect(rulesyncIgnore.getFilePath()).toBe("/project/root/.rulesyncignore");
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
        relativeFilePath: ".rulesyncignore",
        fileContent: sourceContent,
      });

      // Content should be preserved exactly for distribution to other AI tools
      expect(rulesyncIgnore.getFileContent()).toBe(sourceContent);
    });
  });

  describe("static method behavior", () => {
    it("should use fixed parameters in fromFile method", async () => {
      const fileContent = "*.log\nnode_modules/";
      const rulesyncIgnorePath = join(testDir, ".rulesyncignore");
      await writeFileContent(rulesyncIgnorePath, fileContent);

      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);

        const rulesyncIgnore = await RulesyncIgnore.fromFile();

        // fromFile always uses these fixed parameters
        expect(rulesyncIgnore.getBaseDir()).toBe(testDir);
        expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
        expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should create instance with validation enabled by default", async () => {
      const fileContent = "*.log\nnode_modules/";
      const rulesyncIgnorePath = join(testDir, ".rulesyncignore");
      await writeFileContent(rulesyncIgnorePath, fileContent);

      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);

        const rulesyncIgnore = await RulesyncIgnore.fromFile();

        // Should have been validated during construction
        expect(rulesyncIgnore.validate().success).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});

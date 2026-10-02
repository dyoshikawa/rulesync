import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { QoderIgnore } from "./qoder-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("QoderIgnore", () => {
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
      const qoderIgnore = new QoderIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".qoderignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(qoderIgnore).toBeInstanceOf(QoderIgnore);
      expect(qoderIgnore.getRelativeDirPath()).toBe(".");
      expect(qoderIgnore.getRelativeFilePath()).toBe(".qoderignore");
      expect(qoderIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });

    it("should create instance with custom outputRoot", () => {
      const qoderIgnore = new QoderIgnore({
        outputRoot: "/custom/path",
        relativeDirPath: "subdir",
        relativeFilePath: ".qoderignore",
        fileContent: "*.tmp",
      });

      expect(qoderIgnore.getFilePath()).toBe("/custom/path/subdir/.qoderignore");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new QoderIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".qoderignore",
          fileContent: "", // empty content should be valid
        });
      }).not.toThrow();
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _instance = new QoderIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".qoderignore",
          fileContent: "any content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with same content", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const qoderIgnore = new QoderIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".qoderignore",
        fileContent,
      });

      const rulesyncIgnore = qoderIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_FILE_NAME);
    });

    it("should handle empty content", () => {
      const qoderIgnore = new QoderIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".qoderignore",
        fileContent: "",
      });

      const rulesyncIgnore = qoderIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("");
    });

    it("should preserve patterns and formatting", () => {
      const fileContent = "# Generated files\n*.log\n*.tmp\n\n# Dependencies\nnode_modules/\n.env*";
      const qoderIgnore = new QoderIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".qoderignore",
        fileContent,
      });

      const rulesyncIgnore = qoderIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create QoderIgnore from RulesyncIgnore with default outputRoot", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const qoderIgnore = QoderIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(qoderIgnore).toBeInstanceOf(QoderIgnore);
      expect(qoderIgnore.getOutputRoot()).toBe(testDir);
      expect(qoderIgnore.getRelativeDirPath()).toBe(".");
      expect(qoderIgnore.getRelativeFilePath()).toBe(".qoderignore");
      expect(qoderIgnore.getFileContent()).toBe(fileContent);
    });

    it("should create QoderIgnore from RulesyncIgnore with custom outputRoot", () => {
      const fileContent = "*.tmp\nbuild/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const qoderIgnore = QoderIgnore.fromRulesyncIgnore({
        outputRoot: "/custom/base",
        rulesyncIgnore,
      });

      expect(qoderIgnore.getOutputRoot()).toBe("/custom/base");
      expect(qoderIgnore.getFilePath()).toBe("/custom/base/.qoderignore");
      expect(qoderIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty content", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: "",
      });

      const qoderIgnore = QoderIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(qoderIgnore.getFileContent()).toBe("");
    });

    it("should preserve complex patterns", () => {
      const fileContent = "# Comments\n*.log\n**/*.tmp\n!important.tmp\nnode_modules/\n.env*";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const qoderIgnore = QoderIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(qoderIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFile", () => {
    it("should read .qoderignore file from outputRoot with default outputRoot", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const qoderignorePath = join(testDir, ".qoderignore");
      await writeFileContent(qoderignorePath, fileContent);

      const qoderIgnore = await QoderIgnore.fromFile({
        outputRoot: testDir,
      });

      expect(qoderIgnore).toBeInstanceOf(QoderIgnore);
      expect(qoderIgnore.getOutputRoot()).toBe(testDir);
      expect(qoderIgnore.getRelativeDirPath()).toBe(".");
      expect(qoderIgnore.getRelativeFilePath()).toBe(".qoderignore");
      expect(qoderIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .qoderignore file with validation enabled by default", async () => {
      const fileContent = "*.log\nnode_modules/";
      const qoderignorePath = join(testDir, ".qoderignore");
      await writeFileContent(qoderignorePath, fileContent);

      const qoderIgnore = await QoderIgnore.fromFile({
        outputRoot: testDir,
      });

      expect(qoderIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .qoderignore file with validation disabled", async () => {
      const fileContent = "*.log\nnode_modules/";
      const qoderignorePath = join(testDir, ".qoderignore");
      await writeFileContent(qoderignorePath, fileContent);

      const qoderIgnore = await QoderIgnore.fromFile({
        outputRoot: testDir,
        validate: false,
      });

      expect(qoderIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty .qoderignore file", async () => {
      const qoderignorePath = join(testDir, ".qoderignore");
      await writeFileContent(qoderignorePath, "");

      const qoderIgnore = await QoderIgnore.fromFile({
        outputRoot: testDir,
      });

      expect(qoderIgnore.getFileContent()).toBe("");
    });

    it("should handle .qoderignore file with complex patterns", async () => {
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

      const qoderignorePath = join(testDir, ".qoderignore");
      await writeFileContent(qoderignorePath, fileContent);

      const qoderIgnore = await QoderIgnore.fromFile({
        outputRoot: testDir,
      });

      expect(qoderIgnore.getFileContent()).toBe(fileContent);
    });

    it("should default outputRoot to process.cwd() when not provided", async () => {
      // process.cwd() is already mocked to return testDir in beforeEach
      const fileContent = "*.log\nnode_modules/";
      const qoderignorePath = join(testDir, ".qoderignore");
      await writeFileContent(qoderignorePath, fileContent);

      const qoderIgnore = await QoderIgnore.fromFile({});

      expect(qoderIgnore.getOutputRoot()).toBe(testDir);
      expect(qoderIgnore.getFileContent()).toBe(fileContent);
    });

    it("should throw error when .qoderignore file does not exist", async () => {
      await expect(
        QoderIgnore.fromFile({
          outputRoot: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should handle file with Windows line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/\r\n.env";
      const qoderignorePath = join(testDir, ".qoderignore");
      await writeFileContent(qoderignorePath, fileContent);

      const qoderIgnore = await QoderIgnore.fromFile({
        outputRoot: testDir,
      });

      expect(qoderIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("inheritance from ToolIgnore", () => {
    it("should inherit getPatterns method", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const qoderIgnore = new QoderIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".qoderignore",
        fileContent,
      });

      const patterns = qoderIgnore.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should inherit validation method", () => {
      const qoderIgnore = new QoderIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".qoderignore",
        fileContent: "*.log\nnode_modules/",
      });

      const result = qoderIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should inherit file path methods from ToolFile", () => {
      const qoderIgnore = new QoderIgnore({
        outputRoot: "/test/base",
        relativeDirPath: "subdir",
        relativeFilePath: ".qoderignore",
        fileContent: "*.log",
      });

      expect(qoderIgnore.getOutputRoot()).toBe("/test/base");
      expect(qoderIgnore.getRelativeDirPath()).toBe("subdir");
      expect(qoderIgnore.getRelativeFilePath()).toBe(".qoderignore");
      expect(qoderIgnore.getFilePath()).toBe("/test/base/subdir/.qoderignore");
      expect(qoderIgnore.getFileContent()).toBe("*.log");
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain content integrity in round-trip conversion", () => {
      const originalContent = `# Qoder ignore patterns
*.log
node_modules/
.env*
build/
dist/
*.tmp`;

      // QoderIgnore -> RulesyncIgnore -> QoderIgnore
      const originalQoderIgnore = new QoderIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".qoderignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalQoderIgnore.toRulesyncIgnore();
      const roundTripQoderIgnore = QoderIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore,
      });

      expect(roundTripQoderIgnore.getFileContent()).toBe(originalContent);
      expect(roundTripQoderIgnore.getOutputRoot()).toBe(testDir);
      expect(roundTripQoderIgnore.getRelativeDirPath()).toBe(".");
      expect(roundTripQoderIgnore.getRelativeFilePath()).toBe(".qoderignore");
    });

    it("should maintain patterns in round-trip conversion", () => {
      const patterns = ["*.log", "node_modules/", ".env", "build/", "*.tmp"];
      const originalContent = patterns.join("\n");

      const originalQoderIgnore = new QoderIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".qoderignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalQoderIgnore.toRulesyncIgnore();
      const roundTripQoderIgnore = QoderIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(roundTripQoderIgnore.getPatterns()).toEqual(patterns);
    });
  });

  describe("edge cases", () => {
    it("should handle file content with only whitespace", () => {
      const qoderIgnore = new QoderIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".qoderignore",
        fileContent: "   \n\t\n   ",
      });

      expect(qoderIgnore.getFileContent()).toBe("   \n\t\n   ");
      // Patterns are trimmed and empty lines are filtered out
      expect(qoderIgnore.getPatterns()).toEqual([]);
    });

    it("should handle file content with mixed line endings", () => {
      const fileContent = "*.log\r\nnode_modules/\n.env\r\nbuild/";
      const qoderIgnore = new QoderIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".qoderignore",
        fileContent,
      });

      expect(qoderIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle very long patterns", () => {
      const longPattern = "a".repeat(1000);
      const qoderIgnore = new QoderIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".qoderignore",
        fileContent: longPattern,
      });

      expect(qoderIgnore.getFileContent()).toBe(longPattern);
      expect(qoderIgnore.getPatterns()).toEqual([longPattern]);
    });

    it("should handle unicode characters in patterns", () => {
      const unicodeContent = "*.log\n節点模块/\n環境.env\n🏗️build/";
      const qoderIgnore = new QoderIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".qoderignore",
        fileContent: unicodeContent,
      });

      expect(qoderIgnore.getFileContent()).toBe(unicodeContent);
      expect(qoderIgnore.getPatterns()).toEqual(["*.log", "節点模块/", "環境.env", "🏗️build/"]);
    });
  });

  describe("file integration", () => {
    it("should write and read file correctly", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const qoderIgnore = new QoderIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".qoderignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(qoderIgnore.getFilePath(), qoderIgnore.getFileContent());

      // Read file back
      const readQoderIgnore = await QoderIgnore.fromFile({
        outputRoot: testDir,
      });

      expect(readQoderIgnore.getFileContent()).toBe(fileContent);
      expect(readQoderIgnore.getPatterns()).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should handle subdirectory placement", async () => {
      const subDir = join(testDir, "project", "config");
      await ensureDir(subDir);

      const fileContent = "*.log\nbuild/";
      const qoderIgnore = new QoderIgnore({
        outputRoot: testDir,
        relativeDirPath: "project/config",
        relativeFilePath: ".qoderignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(qoderIgnore.getFilePath(), qoderIgnore.getFileContent());

      const readQoderIgnore = await QoderIgnore.fromFile({
        outputRoot: join(testDir, "project/config"),
      });

      expect(readQoderIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("pattern parsing", () => {
    it("should filter out comment lines and empty lines", () => {
      const fileContent = `# This is a comment
*.log
# Another comment

node_modules/
# Final comment
.env`;

      const qoderIgnore = new QoderIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".qoderignore",
        fileContent,
      });

      const patterns = qoderIgnore.getPatterns();
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should handle patterns with leading/trailing whitespace", () => {
      const fileContent = "  *.log  \n\tnode_modules/\t\n  .env  ";

      const qoderIgnore = new QoderIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".qoderignore",
        fileContent,
      });

      const patterns = qoderIgnore.getPatterns();
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should preserve special gitignore patterns", () => {
      const fileContent = "!important.log\n**/*.tmp\n/root-only\ndir/\n*.{js,ts}";

      const qoderIgnore = new QoderIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".qoderignore",
        fileContent,
      });

      const patterns = qoderIgnore.getPatterns();
      expect(patterns).toEqual(["!important.log", "**/*.tmp", "/root-only", "dir/", "*.{js,ts}"]);
    });
  });
});

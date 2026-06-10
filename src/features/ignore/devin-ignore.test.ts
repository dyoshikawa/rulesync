import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { DevinIgnore } from "./devin-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("DevinIgnore", () => {
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
      const devinIgnore = new DevinIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(devinIgnore).toBeInstanceOf(DevinIgnore);
      expect(devinIgnore.getRelativeDirPath()).toBe(".");
      expect(devinIgnore.getRelativeFilePath()).toBe(".codeiumignore");
      expect(devinIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });

    it("should create instance with custom outputRoot", () => {
      const devinIgnore = new DevinIgnore({
        outputRoot: "/custom/path",
        relativeDirPath: "subdir",
        relativeFilePath: ".codeiumignore",
        fileContent: "*.tmp",
      });

      expect(devinIgnore.getFilePath()).toBe("/custom/path/subdir/.codeiumignore");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new DevinIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".codeiumignore",
          fileContent: "", // empty content should be valid
        });
      }).not.toThrow();
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _instance = new DevinIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".codeiumignore",
          fileContent: "any content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with same content", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const devinIgnore = new DevinIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent,
      });

      const rulesyncIgnore = devinIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_FILE_NAME);
    });

    it("should preserve complex patterns", () => {
      const complexContent = `# Build outputs
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

      const devinIgnore = new DevinIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: complexContent,
      });

      const rulesyncIgnore = devinIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(complexContent);
    });

    it("should handle empty content", () => {
      const devinIgnore = new DevinIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: "",
      });

      const rulesyncIgnore = devinIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("");
    });

    it("should handle content with special characters", () => {
      const specialContent = "*.log\n節点模块/\n環境.env\n🏗️build/\n**/*.cache";
      const devinIgnore = new DevinIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: specialContent,
      });

      const rulesyncIgnore = devinIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(specialContent);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create DevinIgnore from RulesyncIgnore", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        outputRoot: "/test/project",
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent,
      });

      const devinIgnore = DevinIgnore.fromRulesyncIgnore({
        outputRoot: "/test/project",
        rulesyncIgnore,
      });

      expect(devinIgnore).toBeInstanceOf(DevinIgnore);
      expect(devinIgnore.getFileContent()).toBe(fileContent);
      expect(devinIgnore.getOutputRoot()).toBe("/test/project");
      expect(devinIgnore.getRelativeDirPath()).toBe(".");
      expect(devinIgnore.getRelativeFilePath()).toBe(".devinignore");
    });

    it("should use default outputRoot when not provided", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.log",
      });

      const devinIgnore = DevinIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(devinIgnore.getOutputRoot()).toBe(testDir);
    });

    it("should preserve complex content from RulesyncIgnore", () => {
      const complexContent = `# Devin AI code editor ignore patterns
# Generated from .rulesync/.aiignore

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

      const devinIgnore = DevinIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(devinIgnore.getFileContent()).toBe(complexContent);
    });

    it("should handle empty RulesyncIgnore content", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "",
      });

      const devinIgnore = DevinIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(devinIgnore.getFileContent()).toBe("");
    });
  });

  describe("fromFile", () => {
    it("should read .devinignore file from current directory", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      await writeFileContent(join(testDir, ".devinignore"), fileContent);

      const devinIgnore = await DevinIgnore.fromFile({
        outputRoot: testDir,
      });

      expect(devinIgnore).toBeInstanceOf(DevinIgnore);
      expect(devinIgnore.getRelativeFilePath()).toBe(".devinignore");
      expect(devinIgnore.getFileContent()).toBe(fileContent);
    });

    it("should prefer .devinignore over legacy .codeiumignore when both exist", async () => {
      await writeFileContent(join(testDir, ".devinignore"), "from-devinignore");
      await writeFileContent(join(testDir, ".codeiumignore"), "from-codeiumignore");

      const devinIgnore = await DevinIgnore.fromFile({
        outputRoot: testDir,
      });

      expect(devinIgnore.getRelativeFilePath()).toBe(".devinignore");
      expect(devinIgnore.getFileContent()).toBe("from-devinignore");
    });

    it("should fall back to legacy .codeiumignore file from current directory", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const codeiumIgnorePath = join(testDir, ".codeiumignore");
      await writeFileContent(codeiumIgnorePath, fileContent);

      const devinIgnore = await DevinIgnore.fromFile({
        outputRoot: testDir,
      });

      expect(devinIgnore).toBeInstanceOf(DevinIgnore);
      expect(devinIgnore.getOutputRoot()).toBe(testDir);
      expect(devinIgnore.getRelativeDirPath()).toBe(".");
      expect(devinIgnore.getRelativeFilePath()).toBe(".codeiumignore");
      expect(devinIgnore.getFileContent()).toBe(fileContent);
    });

    it("should use default outputRoot when not provided", async () => {
      // process.cwd() is already mocked to return testDir in beforeEach
      const fileContent = "*.log\nnode_modules/";
      const codeiumIgnorePath = join(testDir, ".codeiumignore");
      await writeFileContent(codeiumIgnorePath, fileContent);

      const devinIgnore = await DevinIgnore.fromFile({});

      expect(devinIgnore.getOutputRoot()).toBe(testDir);
      expect(devinIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty .codeiumignore file", async () => {
      const codeiumIgnorePath = join(testDir, ".codeiumignore");
      await writeFileContent(codeiumIgnorePath, "");

      const devinIgnore = await DevinIgnore.fromFile({
        outputRoot: testDir,
      });

      expect(devinIgnore.getFileContent()).toBe("");
    });

    it("should handle .codeiumignore file with complex patterns", async () => {
      const fileContent = `# Devin AI code editor ignore patterns
# These patterns follow gitignore syntax

# Build outputs
build/
dist/
*.map
out/

# Dependencies
node_modules/
.pnpm-store/
.yarn/
bower_components/

# Environment files
.env*
!.env.example

# IDE and editor files
.vscode/
.idea/
*.swp
*.swo
*~

# Logs
*.log
logs/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Cache and temporary files
.cache/
*.tmp
*.temp
.turbo/
.next/
.nuxt/

# OS generated files
.DS_Store
Thumbs.db
desktop.ini
ehthumbs.db

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/
*.lcov

# Dependency directories
jspm_packages/

# TypeScript cache
*.tsbuildinfo

# Optional npm cache directory
.npm

# Optional eslint cache
.eslintcache

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# dotenv environment variables file
.env.test
.env.production

# Stores VSCode versions used for testing VSCode extensions
.vscode-test

# Snowpack
.snowpack/

# Vite
.vite/`;

      const codeiumIgnorePath = join(testDir, ".codeiumignore");
      await writeFileContent(codeiumIgnorePath, fileContent);

      const devinIgnore = await DevinIgnore.fromFile({
        outputRoot: testDir,
      });

      expect(devinIgnore.getFileContent()).toBe(fileContent);
    });

    it("should throw error when neither .devinignore nor .codeiumignore exists", async () => {
      await expect(DevinIgnore.fromFile({ outputRoot: testDir })).rejects.toThrow();
    });

    it("should handle file with Windows line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/\r\n.env";
      const codeiumIgnorePath = join(testDir, ".codeiumignore");
      await writeFileContent(codeiumIgnorePath, fileContent);

      const devinIgnore = await DevinIgnore.fromFile({
        outputRoot: testDir,
      });

      expect(devinIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle file with mixed line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/\n.env\r\nbuild/";
      const codeiumIgnorePath = join(testDir, ".codeiumignore");
      await writeFileContent(codeiumIgnorePath, fileContent);

      const devinIgnore = await DevinIgnore.fromFile({
        outputRoot: testDir,
      });

      expect(devinIgnore.getFileContent()).toBe(fileContent);
    });

    it("should respect validate parameter", async () => {
      const fileContent = "*.log\nnode_modules/";
      const codeiumIgnorePath = join(testDir, ".codeiumignore");
      await writeFileContent(codeiumIgnorePath, fileContent);

      const devinIgnoreValidated = await DevinIgnore.fromFile({
        outputRoot: testDir,
        validate: true,
      });

      const devinIgnoreNotValidated = await DevinIgnore.fromFile({
        outputRoot: testDir,
        validate: false,
      });

      expect(devinIgnoreValidated.getFileContent()).toBe(fileContent);
      expect(devinIgnoreNotValidated.getFileContent()).toBe(fileContent);
    });
  });

  describe("inheritance from ToolIgnore", () => {
    it("should inherit file path methods from AiFile", () => {
      const devinIgnore = new DevinIgnore({
        outputRoot: "/test/base",
        relativeDirPath: "subdir",
        relativeFilePath: ".codeiumignore",
        fileContent: "*.log",
      });

      expect(devinIgnore.getOutputRoot()).toBe("/test/base");
      expect(devinIgnore.getRelativeDirPath()).toBe("subdir");
      expect(devinIgnore.getRelativeFilePath()).toBe(".codeiumignore");
      expect(devinIgnore.getFilePath()).toBe("/test/base/subdir/.codeiumignore");
      expect(devinIgnore.getFileContent()).toBe("*.log");
      expect(devinIgnore.getRelativePathFromCwd()).toBe("subdir/.codeiumignore");
    });

    it("should support setFileContent method", () => {
      const devinIgnore = new DevinIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: "*.log",
      });

      const newContent = "*.tmp\nnode_modules/";
      devinIgnore.setFileContent(newContent);

      expect(devinIgnore.getFileContent()).toBe(newContent);
    });

    it("should inherit validate method from ToolIgnore", () => {
      const devinIgnore = new DevinIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: "*.log\nnode_modules/",
      });

      const result = devinIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should inherit getPatterns method from ToolIgnore", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const devinIgnore = new DevinIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent,
      });

      const patterns = devinIgnore.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });
  });

  describe("edge cases", () => {
    it("should handle file content with only whitespace", () => {
      const devinIgnore = new DevinIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: "   \n\t\n   ",
      });

      expect(devinIgnore.getFileContent()).toBe("   \n\t\n   ");
    });

    it("should handle very long content", () => {
      const longPattern = "a".repeat(1000);
      const devinIgnore = new DevinIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: longPattern,
      });

      expect(devinIgnore.getFileContent()).toBe(longPattern);
    });

    it("should handle unicode characters in content", () => {
      const unicodeContent = "*.log\n節点模块/\n環境.env\n🏗️build/";
      const devinIgnore = new DevinIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: unicodeContent,
      });

      expect(devinIgnore.getFileContent()).toBe(unicodeContent);
    });

    it("should handle content with null bytes", () => {
      const contentWithNull = "*.log\0node_modules/";
      const devinIgnore = new DevinIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: contentWithNull,
        validate: false, // Skip validation for edge case content
      });

      expect(devinIgnore.getFileContent()).toBe(contentWithNull);
    });
  });

  describe("file integration", () => {
    it("should write and read file correctly", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const devinIgnore = new DevinIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(devinIgnore.getFilePath(), devinIgnore.getFileContent());

      // Read file back
      const readDevinIgnore = await DevinIgnore.fromFile({
        outputRoot: testDir,
      });

      expect(readDevinIgnore.getFileContent()).toBe(fileContent);
    });

    it("should preserve exact file content", async () => {
      const originalContent = `# Devin AI code editor ignore patterns
*.log
node_modules/
.env*
build/
dist/
*.tmp`;

      const devinIgnore = new DevinIgnore({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: originalContent,
      });

      await writeFileContent(devinIgnore.getFilePath(), devinIgnore.getFileContent());

      const readDevinIgnore = await DevinIgnore.fromFile({
        outputRoot: testDir,
      });

      expect(readDevinIgnore.getFileContent()).toBe(originalContent);
    });
  });

  describe("DevinIgnore-specific behavior", () => {
    it("should use .devinignore as the default generated filename", () => {
      expect(DevinIgnore.getSettablePaths().relativeFilePath).toBe(".devinignore");
    });

    it("should work as a Devin AI ignore file", () => {
      const fileContent = `# Devin AI code editor ignore patterns
# Uses gitignore-compatible syntax
# Automatically respects .gitignore patterns
# Has built-in defaults for node_modules/ and hidden files

# Additional patterns for AI context
*.log
logs/
.env*
!.env.example
build/
dist/
coverage/
*.tmp
*.cache
.DS_Store`;

      const devinIgnore = new DevinIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent,
      });

      expect(devinIgnore.getFileContent()).toBe(fileContent);
    });

    it("should work in project root context", () => {
      const devinIgnore = new DevinIgnore({
        outputRoot: "/project/root",
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: "*.log\nnode_modules/",
      });

      // DevinIgnore typically lives in project root
      expect(devinIgnore.getRelativeDirPath()).toBe(".");
      expect(devinIgnore.getRelativeFilePath()).toBe(".codeiumignore");
      expect(devinIgnore.getFilePath()).toBe("/project/root/.codeiumignore");
    });

    it("should maintain content for gitignore-compatible patterns", () => {
      const gitignoreContent = `# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
lerna-debug.log*

# Diagnostic reports (https://nodejs.org/api/report.html)
report.[0-9]*.[0-9]*.[0-9]*.[0-9]*.json

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/
*.lcov

# nyc test coverage
.nyc_output

# Grunt intermediate storage (https://gruntjs.com/creating-plugins#storing-task-files)
.grunt

# Bower dependency directory (https://bower.io/)
bower_components

# node-waf configuration
.lock-wscript

# Compiled binary addons (https://nodejs.org/api/addons.html)
build/Release

# Dependency directories
node_modules/
jspm_packages/

# Snowpack dependency directory (https://snowpack.dev/)
web_modules/

# TypeScript cache
*.tsbuildinfo

# Optional npm cache directory
.npm

# Optional eslint cache
.eslintcache

# Microbundle cache
.rpt2_cache/
.rts2_cache_cjs/
.rts2_cache_es/
.rts2_cache_umd/

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# dotenv environment variables file
.env
.env.test

# parcel-bundler cache (https://parceljs.org/)
.cache
.parcel-cache

# Next.js build output
.next
out

# Nuxt.js build / generate output
.nuxt
dist

# Gatsby files
.cache/
# Comment in the public line in if your project uses Gatsby and not Next.js
# https://nextjs.org/blog/next-9-1#public-directory-support
# public

# vuepress build output
.vuepress/dist

# Serverless directories
.serverless/

# FuseBox cache
.fusebox/

# DynamoDB Local files
.dynamodb/

# TernJS port file
.tern-port

# Stores VSCode versions used for testing VSCode extensions
.vscode-test

# yarn v2
.yarn/cache
.yarn/unplugged
.yarn/build-state.yml
.yarn/install-state.gz
.pnp.*`;

      const devinIgnore = new DevinIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: gitignoreContent,
      });

      expect(devinIgnore.getFileContent()).toBe(gitignoreContent);
    });
  });

  describe("static method behavior", () => {
    it("should use fixed parameters in fromFile method", async () => {
      const fileContent = "*.log\nnode_modules/";
      const codeiumIgnorePath = join(testDir, ".codeiumignore");
      await writeFileContent(codeiumIgnorePath, fileContent);

      const devinIgnore = await DevinIgnore.fromFile({
        outputRoot: testDir,
      });

      // fromFile always uses these fixed parameters for relativeDirPath and relativeFilePath
      expect(devinIgnore.getRelativeDirPath()).toBe(".");
      expect(devinIgnore.getRelativeFilePath()).toBe(".codeiumignore");
    });

    it("should create instance with validation enabled by default", async () => {
      const fileContent = "*.log\nnode_modules/";
      const codeiumIgnorePath = join(testDir, ".codeiumignore");
      await writeFileContent(codeiumIgnorePath, fileContent);

      const devinIgnore = await DevinIgnore.fromFile({
        outputRoot: testDir,
      });

      // Should have been validated during construction
      expect(devinIgnore.validate().success).toBe(true);
    });

    it("should handle fromRulesyncIgnore with different base directories", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        outputRoot: "/different/path",
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.log\nnode_modules/",
      });

      const devinIgnore = DevinIgnore.fromRulesyncIgnore({
        outputRoot: "/target/path",
        rulesyncIgnore,
      });

      expect(devinIgnore.getOutputRoot()).toBe("/target/path");
      expect(devinIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });
  });

  describe("roundtrip conversion", () => {
    it("should maintain content through fromRulesyncIgnore -> toRulesyncIgnore", () => {
      const originalContent = "*.log\nnode_modules/\n.env*\nbuild/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: originalContent,
      });

      const devinIgnore = DevinIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      const backToRulesync = devinIgnore.toRulesyncIgnore();

      expect(backToRulesync.getFileContent()).toBe(originalContent);
    });

    it("should preserve complex patterns in roundtrip", () => {
      const complexContent = `# Complex gitignore patterns
# Negation patterns
!important.log
*.log

# Directory patterns
build/
node_modules/

# Wildcard patterns
*.tmp
*.cache
**/*.bak

# Bracket expressions
*.[oa]
*.[0-9]

# Special characters
# These should all be preserved exactly
file with spaces.txt
file-with-dashes.txt
file_with_underscores.txt
file.with.dots.txt`;

      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: complexContent,
      });

      const devinIgnore = DevinIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      const backToRulesync = devinIgnore.toRulesyncIgnore();

      expect(backToRulesync.getFileContent()).toBe(complexContent);
    });
  });
});

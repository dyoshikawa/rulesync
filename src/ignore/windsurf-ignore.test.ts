import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { WindsurfIgnore } from "./windsurf-ignore.js";

describe("WindsurfIgnore", () => {
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
      const windsurfIgnore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(windsurfIgnore).toBeInstanceOf(WindsurfIgnore);
      expect(windsurfIgnore.getRelativeDirPath()).toBe(".");
      expect(windsurfIgnore.getRelativeFilePath()).toBe(".codeiumignore");
      expect(windsurfIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });

    it("should create instance with custom baseDir", () => {
      const windsurfIgnore = new WindsurfIgnore({
        baseDir: "/custom/path",
        relativeDirPath: "subdir",
        relativeFilePath: ".codeiumignore",
        fileContent: "*.tmp",
      });

      expect(windsurfIgnore.getFilePath()).toBe("/custom/path/subdir/.codeiumignore");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new WindsurfIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".codeiumignore",
          fileContent: "", // empty content should be valid
        });
      }).not.toThrow();
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _instance = new WindsurfIgnore({
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
      const windsurfIgnore = new WindsurfIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent,
      });

      const rulesyncIgnore = windsurfIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
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

      const windsurfIgnore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: complexContent,
      });

      const rulesyncIgnore = windsurfIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(complexContent);
    });

    it("should handle empty content", () => {
      const windsurfIgnore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: "",
      });

      const rulesyncIgnore = windsurfIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("");
    });

    it("should handle content with special characters", () => {
      const specialContent = "*.log\n節点模块/\n環境.env\n🏗️build/\n**/*.cache";
      const windsurfIgnore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: specialContent,
      });

      const rulesyncIgnore = windsurfIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(specialContent);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create WindsurfIgnore from RulesyncIgnore", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: "/test/project",
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent,
      });

      const windsurfIgnore = WindsurfIgnore.fromRulesyncIgnore({
        baseDir: "/test/project",
        rulesyncIgnore,
      });

      expect(windsurfIgnore).toBeInstanceOf(WindsurfIgnore);
      expect(windsurfIgnore.getFileContent()).toBe(fileContent);
      expect(windsurfIgnore.getBaseDir()).toBe("/test/project");
      expect(windsurfIgnore.getRelativeDirPath()).toBe(".");
      expect(windsurfIgnore.getRelativeFilePath()).toBe(".codeiumignore");
    });

    it("should use default baseDir when not provided", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: "*.log",
      });

      const windsurfIgnore = WindsurfIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(windsurfIgnore.getBaseDir()).toBe(testDir);
    });

    it("should preserve complex content from RulesyncIgnore", () => {
      const complexContent = `# Windsurf AI code editor ignore patterns
# Generated from .rulesyncignore

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
        relativeFilePath: ".rulesyncignore",
        fileContent: complexContent,
      });

      const windsurfIgnore = WindsurfIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(windsurfIgnore.getFileContent()).toBe(complexContent);
    });

    it("should handle empty RulesyncIgnore content", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: "",
      });

      const windsurfIgnore = WindsurfIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(windsurfIgnore.getFileContent()).toBe("");
    });
  });

  describe("fromFile", () => {
    it("should read .codeiumignore file from current directory", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const codeiumIgnorePath = join(testDir, ".codeiumignore");
      await writeFileContent(codeiumIgnorePath, fileContent);

      const windsurfIgnore = await WindsurfIgnore.fromFile({
        baseDir: testDir,
      });

      expect(windsurfIgnore).toBeInstanceOf(WindsurfIgnore);
      expect(windsurfIgnore.getBaseDir()).toBe(testDir);
      expect(windsurfIgnore.getRelativeDirPath()).toBe(".");
      expect(windsurfIgnore.getRelativeFilePath()).toBe(".codeiumignore");
      expect(windsurfIgnore.getFileContent()).toBe(fileContent);
    });

    it("should use default baseDir when not provided", async () => {
      // process.cwd() is already mocked to return testDir in beforeEach
      const fileContent = "*.log\nnode_modules/";
      const codeiumIgnorePath = join(testDir, ".codeiumignore");
      await writeFileContent(codeiumIgnorePath, fileContent);

      const windsurfIgnore = await WindsurfIgnore.fromFile({});

      expect(windsurfIgnore.getBaseDir()).toBe(testDir);
      expect(windsurfIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty .codeiumignore file", async () => {
      const codeiumIgnorePath = join(testDir, ".codeiumignore");
      await writeFileContent(codeiumIgnorePath, "");

      const windsurfIgnore = await WindsurfIgnore.fromFile({
        baseDir: testDir,
      });

      expect(windsurfIgnore.getFileContent()).toBe("");
    });

    it("should handle .codeiumignore file with complex patterns", async () => {
      const fileContent = `# Windsurf AI code editor ignore patterns
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

      const windsurfIgnore = await WindsurfIgnore.fromFile({
        baseDir: testDir,
      });

      expect(windsurfIgnore.getFileContent()).toBe(fileContent);
    });

    it("should throw error when .codeiumignore file does not exist", async () => {
      await expect(WindsurfIgnore.fromFile({ baseDir: testDir })).rejects.toThrow();
    });

    it("should handle file with Windows line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/\r\n.env";
      const codeiumIgnorePath = join(testDir, ".codeiumignore");
      await writeFileContent(codeiumIgnorePath, fileContent);

      const windsurfIgnore = await WindsurfIgnore.fromFile({
        baseDir: testDir,
      });

      expect(windsurfIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle file with mixed line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/\n.env\r\nbuild/";
      const codeiumIgnorePath = join(testDir, ".codeiumignore");
      await writeFileContent(codeiumIgnorePath, fileContent);

      const windsurfIgnore = await WindsurfIgnore.fromFile({
        baseDir: testDir,
      });

      expect(windsurfIgnore.getFileContent()).toBe(fileContent);
    });

    it("should respect validate parameter", async () => {
      const fileContent = "*.log\nnode_modules/";
      const codeiumIgnorePath = join(testDir, ".codeiumignore");
      await writeFileContent(codeiumIgnorePath, fileContent);

      const windsurfIgnoreValidated = await WindsurfIgnore.fromFile({
        baseDir: testDir,
        validate: true,
      });

      const windsurfIgnoreNotValidated = await WindsurfIgnore.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(windsurfIgnoreValidated.getFileContent()).toBe(fileContent);
      expect(windsurfIgnoreNotValidated.getFileContent()).toBe(fileContent);
    });
  });

  describe("inheritance from ToolIgnore", () => {
    it("should inherit file path methods from AiFile", () => {
      const windsurfIgnore = new WindsurfIgnore({
        baseDir: "/test/base",
        relativeDirPath: "subdir",
        relativeFilePath: ".codeiumignore",
        fileContent: "*.log",
      });

      expect(windsurfIgnore.getBaseDir()).toBe("/test/base");
      expect(windsurfIgnore.getRelativeDirPath()).toBe("subdir");
      expect(windsurfIgnore.getRelativeFilePath()).toBe(".codeiumignore");
      expect(windsurfIgnore.getFilePath()).toBe("/test/base/subdir/.codeiumignore");
      expect(windsurfIgnore.getFileContent()).toBe("*.log");
      expect(windsurfIgnore.getRelativePathFromCwd()).toBe("subdir/.codeiumignore");
    });

    it("should support setFileContent method", () => {
      const windsurfIgnore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: "*.log",
      });

      const newContent = "*.tmp\nnode_modules/";
      windsurfIgnore.setFileContent(newContent);

      expect(windsurfIgnore.getFileContent()).toBe(newContent);
    });

    it("should inherit validate method from ToolIgnore", () => {
      const windsurfIgnore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: "*.log\nnode_modules/",
      });

      const result = windsurfIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should inherit getPatterns method from ToolIgnore", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const windsurfIgnore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent,
      });

      const patterns = windsurfIgnore.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });
  });

  describe("edge cases", () => {
    it("should handle file content with only whitespace", () => {
      const windsurfIgnore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: "   \n\t\n   ",
      });

      expect(windsurfIgnore.getFileContent()).toBe("   \n\t\n   ");
    });

    it("should handle very long content", () => {
      const longPattern = "a".repeat(1000);
      const windsurfIgnore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: longPattern,
      });

      expect(windsurfIgnore.getFileContent()).toBe(longPattern);
    });

    it("should handle unicode characters in content", () => {
      const unicodeContent = "*.log\n節点模块/\n環境.env\n🏗️build/";
      const windsurfIgnore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: unicodeContent,
      });

      expect(windsurfIgnore.getFileContent()).toBe(unicodeContent);
    });

    it("should handle content with null bytes", () => {
      const contentWithNull = "*.log\0node_modules/";
      const windsurfIgnore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: contentWithNull,
        validate: false, // Skip validation for edge case content
      });

      expect(windsurfIgnore.getFileContent()).toBe(contentWithNull);
    });
  });

  describe("file integration", () => {
    it("should write and read file correctly", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const windsurfIgnore = new WindsurfIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(windsurfIgnore.getFilePath(), windsurfIgnore.getFileContent());

      // Read file back
      const readWindsurfIgnore = await WindsurfIgnore.fromFile({
        baseDir: testDir,
      });

      expect(readWindsurfIgnore.getFileContent()).toBe(fileContent);
    });

    it("should preserve exact file content", async () => {
      const originalContent = `# Windsurf AI code editor ignore patterns
*.log
node_modules/
.env*
build/
dist/
*.tmp`;

      const windsurfIgnore = new WindsurfIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: originalContent,
      });

      await writeFileContent(windsurfIgnore.getFilePath(), windsurfIgnore.getFileContent());

      const readWindsurfIgnore = await WindsurfIgnore.fromFile({
        baseDir: testDir,
      });

      expect(readWindsurfIgnore.getFileContent()).toBe(originalContent);
    });
  });

  describe("WindsurfIgnore-specific behavior", () => {
    it("should use .codeiumignore as the filename", () => {
      const windsurfIgnore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: "*.log",
      });

      expect(windsurfIgnore.getRelativeFilePath()).toBe(".codeiumignore");
    });

    it("should work as a Windsurf AI ignore file", () => {
      const fileContent = `# Windsurf AI code editor ignore patterns
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

      const windsurfIgnore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent,
      });

      expect(windsurfIgnore.getFileContent()).toBe(fileContent);
    });

    it("should work in project root context", () => {
      const windsurfIgnore = new WindsurfIgnore({
        baseDir: "/project/root",
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: "*.log\nnode_modules/",
      });

      // WindsurfIgnore typically lives in project root
      expect(windsurfIgnore.getRelativeDirPath()).toBe(".");
      expect(windsurfIgnore.getRelativeFilePath()).toBe(".codeiumignore");
      expect(windsurfIgnore.getFilePath()).toBe("/project/root/.codeiumignore");
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

      const windsurfIgnore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: gitignoreContent,
      });

      expect(windsurfIgnore.getFileContent()).toBe(gitignoreContent);
    });
  });

  describe("static method behavior", () => {
    it("should use fixed parameters in fromFile method", async () => {
      const fileContent = "*.log\nnode_modules/";
      const codeiumIgnorePath = join(testDir, ".codeiumignore");
      await writeFileContent(codeiumIgnorePath, fileContent);

      const windsurfIgnore = await WindsurfIgnore.fromFile({
        baseDir: testDir,
      });

      // fromFile always uses these fixed parameters for relativeDirPath and relativeFilePath
      expect(windsurfIgnore.getRelativeDirPath()).toBe(".");
      expect(windsurfIgnore.getRelativeFilePath()).toBe(".codeiumignore");
    });

    it("should create instance with validation enabled by default", async () => {
      const fileContent = "*.log\nnode_modules/";
      const codeiumIgnorePath = join(testDir, ".codeiumignore");
      await writeFileContent(codeiumIgnorePath, fileContent);

      const windsurfIgnore = await WindsurfIgnore.fromFile({
        baseDir: testDir,
      });

      // Should have been validated during construction
      expect(windsurfIgnore.validate().success).toBe(true);
    });

    it("should handle fromRulesyncIgnore with different base directories", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: "/different/path",
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: "*.log\nnode_modules/",
      });

      const windsurfIgnore = WindsurfIgnore.fromRulesyncIgnore({
        baseDir: "/target/path",
        rulesyncIgnore,
      });

      expect(windsurfIgnore.getBaseDir()).toBe("/target/path");
      expect(windsurfIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });
  });

  describe("roundtrip conversion", () => {
    it("should maintain content through fromRulesyncIgnore -> toRulesyncIgnore", () => {
      const originalContent = "*.log\nnode_modules/\n.env*\nbuild/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: originalContent,
      });

      const windsurfIgnore = WindsurfIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      const backToRulesync = windsurfIgnore.toRulesyncIgnore();

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
        relativeFilePath: ".rulesyncignore",
        fileContent: complexContent,
      });

      const windsurfIgnore = WindsurfIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      const backToRulesync = windsurfIgnore.toRulesyncIgnore();

      expect(backToRulesync.getFileContent()).toBe(complexContent);
    });
  });
});

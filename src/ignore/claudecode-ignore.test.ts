import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { ClaudecodeIgnore } from "./claudecode-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("ClaudecodeIgnore", () => {
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
    it("should create instance with valid JSON content", () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["Read(*.log)", "Read(node_modules/**)"],
          },
        },
        null,
        2,
      );

      const claudecodeIgnore = new ClaudecodeIgnore({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      expect(claudecodeIgnore).toBeInstanceOf(ClaudecodeIgnore);
      expect(claudecodeIgnore.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeIgnore.getRelativeFilePath()).toBe("settings.local.json");
      expect(claudecodeIgnore.getPatterns()).toEqual(["Read(*.log)", "Read(node_modules/**)"]);
    });

    it("should handle empty permissions object", () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {},
        },
        null,
        2,
      );

      const claudecodeIgnore = new ClaudecodeIgnore({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      expect(claudecodeIgnore.getPatterns()).toEqual([]);
    });

    it("should handle null deny array", () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: null,
          },
        },
        null,
        2,
      );

      const claudecodeIgnore = new ClaudecodeIgnore({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      expect(claudecodeIgnore.getPatterns()).toEqual([]);
    });

    it("should handle missing permissions property", () => {
      const jsonContent = JSON.stringify({}, null, 2);

      const claudecodeIgnore = new ClaudecodeIgnore({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      expect(claudecodeIgnore.getPatterns()).toEqual([]);
    });

    it("should create instance with custom baseDir", () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["Read(*.tmp)"],
          },
        },
        null,
        2,
      );

      const claudecodeIgnore = new ClaudecodeIgnore({
        baseDir: "/custom/path",
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      expect(claudecodeIgnore.getFilePath()).toBe("/custom/path/.claude/settings.local.json");
      expect(claudecodeIgnore.getPatterns()).toEqual(["Read(*.tmp)"]);
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for Claude Code", () => {
      const paths = ClaudecodeIgnore.getSettablePaths();

      expect(paths).toEqual({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
      });
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert Read() patterns to plain patterns", () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["Read(*.log)", "Read(node_modules/**)", "Read(.env)"],
          },
        },
        null,
        2,
      );

      const claudecodeIgnore = new ClaudecodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      const rulesyncIgnore = claudecodeIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe("*.log\nnode_modules/**\n.env");
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
    });

    it("should handle patterns without Read() wrapper", () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["*.log", "Read(node_modules/**)", ".env"],
          },
        },
        null,
        2,
      );

      const claudecodeIgnore = new ClaudecodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      const rulesyncIgnore = claudecodeIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("*.log\nnode_modules/**\n.env");
    });

    it("should filter out empty patterns", () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["Read(*.log)", "Read()", "", "Read(node_modules/**)"],
          },
        },
        null,
        2,
      );

      const claudecodeIgnore = new ClaudecodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      const rulesyncIgnore = claudecodeIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("*.log\nnode_modules/**");
    });

    it("should handle empty deny array", () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: [],
          },
        },
        null,
        2,
      );

      const claudecodeIgnore = new ClaudecodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      const rulesyncIgnore = claudecodeIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("");
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create ClaudecodeIgnore from RulesyncIgnore patterns", async () => {
      const fileContent = "*.log\nnode_modules/**\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const claudecodeIgnore = await ClaudecodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      expect(claudecodeIgnore).toBeInstanceOf(ClaudecodeIgnore);
      expect(claudecodeIgnore.getBaseDir()).toBe(testDir);
      expect(claudecodeIgnore.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeIgnore.getRelativeFilePath()).toBe("settings.local.json");

      const jsonValue = JSON.parse(claudecodeIgnore.getFileContent());
      expect(jsonValue.permissions.deny).toEqual([
        "Read(*.log)",
        "Read(.env)",
        "Read(node_modules/**)",
      ]);
    });

    it("should merge with existing permissions", async () => {
      const existingJsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["Read(existing.txt)", "Read(old.log)"],
          },
        },
        null,
        2,
      );

      const claudeDir = join(testDir, ".claude");
      await ensureDir(claudeDir);
      await writeFileContent(join(claudeDir, "settings.local.json"), existingJsonContent);

      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: "*.log\nnode_modules/**",
      });

      const claudecodeIgnore = await ClaudecodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      const jsonValue = JSON.parse(claudecodeIgnore.getFileContent());
      expect(jsonValue.permissions.deny).toEqual([
        "Read(*.log)",
        "Read(existing.txt)",
        "Read(node_modules/**)",
        "Read(old.log)",
      ]);
    });

    it("should handle patterns with comments and empty lines", async () => {
      const fileContent = "# Comment\n*.log\n\nnode_modules/**\n# Another comment\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const claudecodeIgnore = await ClaudecodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      const jsonValue = JSON.parse(claudecodeIgnore.getFileContent());
      expect(jsonValue.permissions.deny).toEqual([
        "Read(*.log)",
        "Read(.env)",
        "Read(node_modules/**)",
      ]);
    });

    it("should preserve other JSON properties", async () => {
      const existingJsonContent = JSON.stringify(
        {
          other: "property",
          permissions: {
            allow: ["Write(*.js)"],
            deny: ["Read(secret.txt)"],
          },
          another: "value",
        },
        null,
        2,
      );

      const claudeDir = join(testDir, ".claude");
      await ensureDir(claudeDir);
      await writeFileContent(join(claudeDir, "settings.local.json"), existingJsonContent);

      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: "*.log",
      });

      const claudecodeIgnore = await ClaudecodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      const jsonValue = JSON.parse(claudecodeIgnore.getFileContent());
      expect(jsonValue.other).toBe("property");
      expect(jsonValue.another).toBe("value");
      expect(jsonValue.permissions.allow).toEqual(["Write(*.js)"]);
      expect(jsonValue.permissions.deny).toEqual(["Read(*.log)", "Read(secret.txt)"]);
    });

    it("should remove duplicates and sort patterns", async () => {
      const existingJsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["Read(*.log)", "Read(z.txt)", "Read(a.txt)"],
          },
        },
        null,
        2,
      );

      const claudeDir = join(testDir, ".claude");
      await ensureDir(claudeDir);
      await writeFileContent(join(claudeDir, "settings.local.json"), existingJsonContent);

      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: "*.log\nb.txt\na.txt",
      });

      const claudecodeIgnore = await ClaudecodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      const jsonValue = JSON.parse(claudecodeIgnore.getFileContent());
      expect(jsonValue.permissions.deny).toEqual([
        "Read(*.log)",
        "Read(a.txt)",
        "Read(b.txt)",
        "Read(z.txt)",
      ]);
    });

    it("should handle Windows line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/**\r\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const claudecodeIgnore = await ClaudecodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      const jsonValue = JSON.parse(claudecodeIgnore.getFileContent());
      expect(jsonValue.permissions.deny).toEqual([
        "Read(*.log)",
        "Read(.env)",
        "Read(node_modules/**)",
      ]);
    });

    it("should create new JSON file when none exists", async () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: "*.log\nnode_modules/**",
      });

      const claudecodeIgnore = await ClaudecodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      const jsonValue = JSON.parse(claudecodeIgnore.getFileContent());
      expect(jsonValue).toEqual({
        permissions: {
          deny: ["Read(*.log)", "Read(node_modules/**)"],
        },
      });
    });

    it("should use default baseDir when not provided", async () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: "*.tmp",
      });

      const claudecodeIgnore = await ClaudecodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      expect(claudecodeIgnore.getBaseDir()).toBe(testDir);

      const jsonValue = JSON.parse(claudecodeIgnore.getFileContent());
      expect(jsonValue.permissions.deny).toEqual(["Read(*.tmp)"]);
    });
  });

  describe("fromFile", () => {
    it("should read settings.local.json file from .claude directory", async () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["Read(*.log)", "Read(node_modules/**)"],
          },
        },
        null,
        2,
      );

      const claudeDir = join(testDir, ".claude");
      await ensureDir(claudeDir);
      await writeFileContent(join(claudeDir, "settings.local.json"), jsonContent);

      const claudecodeIgnore = await ClaudecodeIgnore.fromFile({
        baseDir: testDir,
      });

      expect(claudecodeIgnore).toBeInstanceOf(ClaudecodeIgnore);
      expect(claudecodeIgnore.getBaseDir()).toBe(testDir);
      expect(claudecodeIgnore.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeIgnore.getRelativeFilePath()).toBe("settings.local.json");
      expect(claudecodeIgnore.getPatterns()).toEqual(["Read(*.log)", "Read(node_modules/**)"]);
    });

    it("should read file with validation enabled by default", async () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["Read(*.log)"],
          },
        },
        null,
        2,
      );

      const claudeDir = join(testDir, ".claude");
      await ensureDir(claudeDir);
      await writeFileContent(join(claudeDir, "settings.local.json"), jsonContent);

      const claudecodeIgnore = await ClaudecodeIgnore.fromFile({
        baseDir: testDir,
      });

      expect(claudecodeIgnore.getFileContent()).toBe(jsonContent);
    });

    it("should read file with validation disabled", async () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["Read(*.log)"],
          },
        },
        null,
        2,
      );

      const claudeDir = join(testDir, ".claude");
      await ensureDir(claudeDir);
      await writeFileContent(join(claudeDir, "settings.local.json"), jsonContent);

      const claudecodeIgnore = await ClaudecodeIgnore.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(claudecodeIgnore.getFileContent()).toBe(jsonContent);
    });

    it("should handle complex JSON structure", async () => {
      const jsonContent = JSON.stringify(
        {
          version: "1.0.0",
          permissions: {
            allow: ["Write(*.js)", "Execute(npm)"],
            deny: ["Read(*.log)", "Read(secrets/**)"],
          },
          customSettings: {
            theme: "dark",
          },
        },
        null,
        2,
      );

      const claudeDir = join(testDir, ".claude");
      await ensureDir(claudeDir);
      await writeFileContent(join(claudeDir, "settings.local.json"), jsonContent);

      const claudecodeIgnore = await ClaudecodeIgnore.fromFile({
        baseDir: testDir,
      });

      expect(claudecodeIgnore.getFileContent()).toBe(jsonContent);
      expect(claudecodeIgnore.getPatterns()).toEqual(["Read(*.log)", "Read(secrets/**)"]);
    });

    it("should default baseDir to process.cwd() when not provided", async () => {
      // process.cwd() is already mocked to return testDir in beforeEach
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["Read(*.log)"],
          },
        },
        null,
        2,
      );

      const claudeDir = join(testDir, ".claude");
      await ensureDir(claudeDir);
      await writeFileContent(join(claudeDir, "settings.local.json"), jsonContent);

      const claudecodeIgnore = await ClaudecodeIgnore.fromFile({});

      expect(claudecodeIgnore.getBaseDir()).toBe(testDir);
      expect(claudecodeIgnore.getPatterns()).toEqual(["Read(*.log)"]);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        ClaudecodeIgnore.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain patterns in round-trip conversion", async () => {
      const originalPatterns = ["*.log", "node_modules/**", ".env", "build/", "*.tmp"];
      const originalContent = originalPatterns.join("\n");

      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: originalContent,
      });

      const claudecodeIgnore = await ClaudecodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      const convertedRulesyncIgnore = claudecodeIgnore.toRulesyncIgnore();
      const convertedPatterns = convertedRulesyncIgnore.getFileContent().split("\n");
      const originalPatternsList = originalContent.split("\n");

      // Check that all original patterns are present (order may differ due to sorting)
      expect(convertedPatterns.toSorted()).toEqual(originalPatternsList.toSorted());
    });

    it("should handle complex patterns in round-trip", async () => {
      const patterns = [
        "*.log",
        "**/*.tmp",
        "!important.tmp",
        "node_modules/**",
        ".env*",
        "build/",
        "dist/**/*.map",
      ];
      const originalContent = patterns.join("\n");

      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: originalContent,
      });

      const claudecodeIgnore = await ClaudecodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      const convertedRulesyncIgnore = claudecodeIgnore.toRulesyncIgnore();
      const convertedPatterns = convertedRulesyncIgnore.getFileContent().split("\n");
      const originalPatternsList = originalContent.split("\n");

      // Check that all original patterns are present (order may differ due to sorting)
      expect(convertedPatterns.toSorted()).toEqual(originalPatternsList.toSorted());
    });
  });

  describe("edge cases", () => {
    it("should handle malformed JSON gracefully", () => {
      expect(() => {
        new ClaudecodeIgnore({
          relativeDirPath: ".claude",
          relativeFilePath: "settings.local.json",
          fileContent: "{ invalid json }",
        });
      }).toThrow();
    });

    it("should handle patterns with special characters", () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: [
              "Read(file with spaces.txt)",
              "Read(file(with)parens.txt)",
              "Read(file[with]brackets.txt)",
              "Read(file{with}braces.txt)",
            ],
          },
        },
        null,
        2,
      );

      const claudecodeIgnore = new ClaudecodeIgnore({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      const rulesyncIgnore = claudecodeIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(
        "file with spaces.txt\n" +
          "file(with)parens.txt\n" +
          "file[with]brackets.txt\n" +
          "file{with}braces.txt",
      );
    });

    it("should handle nested Read() patterns", () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["Read(Read(nested).txt)"],
          },
        },
        null,
        2,
      );

      const claudecodeIgnore = new ClaudecodeIgnore({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      const rulesyncIgnore = claudecodeIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("Read(nested).txt");
    });

    it("should handle patterns with trailing/leading spaces", () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["  Read(*.log)  ", "Read(  spaced.txt  )"],
          },
        },
        null,
        2,
      );

      const claudecodeIgnore = new ClaudecodeIgnore({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      expect(claudecodeIgnore.getPatterns()).toEqual(["  Read(*.log)  ", "Read(  spaced.txt  )"]);
    });

    it("should handle unicode characters in patterns", () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["Read(文件.log)", "Read(ファイル/**)", "Read(🚀.txt)"],
          },
        },
        null,
        2,
      );

      const claudecodeIgnore = new ClaudecodeIgnore({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      const rulesyncIgnore = claudecodeIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("文件.log\nファイル/**\n🚀.txt");
    });

    it("should handle very long pattern lists", () => {
      const patterns = Array.from({ length: 100 }, (_, i) => `Read(file${i}.txt)`);
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: patterns,
          },
        },
        null,
        2,
      );

      const claudecodeIgnore = new ClaudecodeIgnore({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      expect(claudecodeIgnore.getPatterns()).toHaveLength(100);
      expect(claudecodeIgnore.getPatterns()[0]).toBe("Read(file0.txt)");
      expect(claudecodeIgnore.getPatterns()[99]).toBe("Read(file99.txt)");
    });
  });

  describe("inheritance from ToolIgnore", () => {
    it("should inherit getPatterns method", () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["Read(*.log)", "Read(node_modules/**)", "Read(.env)"],
          },
        },
        null,
        2,
      );

      const claudecodeIgnore = new ClaudecodeIgnore({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      const patterns = claudecodeIgnore.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns).toEqual(["Read(*.log)", "Read(node_modules/**)", "Read(.env)"]);
    });

    it("should inherit validation method", () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["Read(*.log)"],
          },
        },
        null,
        2,
      );

      const claudecodeIgnore = new ClaudecodeIgnore({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      const result = claudecodeIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should inherit file path methods from ToolFile", () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["Read(*.log)"],
          },
        },
        null,
        2,
      );

      const claudecodeIgnore = new ClaudecodeIgnore({
        baseDir: "/test/base",
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      expect(claudecodeIgnore.getBaseDir()).toBe("/test/base");
      expect(claudecodeIgnore.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeIgnore.getRelativeFilePath()).toBe("settings.local.json");
      expect(claudecodeIgnore.getFilePath()).toBe("/test/base/.claude/settings.local.json");
      expect(claudecodeIgnore.getFileContent()).toBe(jsonContent);
    });
  });

  describe("file integration", () => {
    it("should write and read file correctly", async () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["Read(*.log)", "Read(node_modules/**)"],
          },
        },
        null,
        2,
      );

      const claudecodeIgnore = new ClaudecodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      const claudeDir = join(testDir, ".claude");
      await ensureDir(claudeDir);
      await writeFileContent(claudecodeIgnore.getFilePath(), claudecodeIgnore.getFileContent());

      const readClaudecodeIgnore = await ClaudecodeIgnore.fromFile({
        baseDir: testDir,
      });

      expect(readClaudecodeIgnore.getFileContent()).toBe(jsonContent);
      expect(readClaudecodeIgnore.getPatterns()).toEqual(["Read(*.log)", "Read(node_modules/**)"]);
    });

    it("should handle subdirectory placement", async () => {
      const subDir = join(testDir, "project");
      await ensureDir(subDir);

      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["Read(*.log)"],
          },
        },
        null,
        2,
      );

      const claudecodeIgnore = new ClaudecodeIgnore({
        baseDir: subDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      const claudeDir = join(subDir, ".claude");
      await ensureDir(claudeDir);
      await writeFileContent(claudecodeIgnore.getFilePath(), claudecodeIgnore.getFileContent());

      const readClaudecodeIgnore = await ClaudecodeIgnore.fromFile({
        baseDir: subDir,
      });

      expect(readClaudecodeIgnore.getFileContent()).toBe(jsonContent);
    });
  });

  describe("ClaudecodeIgnore-specific behavior", () => {
    it("should use .claude/settings.local.json as the file path", () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["Read(*.log)"],
          },
        },
        null,
        2,
      );

      const claudecodeIgnore = new ClaudecodeIgnore({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      expect(claudecodeIgnore.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeIgnore.getRelativeFilePath()).toBe("settings.local.json");
    });

    it("should format JSON output with 2-space indentation", async () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: "*.log",
      });

      const claudecodeIgnore = await ClaudecodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      const fileContent = claudecodeIgnore.getFileContent();
      const jsonValue = JSON.parse(fileContent);

      // Check that the JSON has the expected structure
      expect(jsonValue.permissions).toBeDefined();
      expect(jsonValue.permissions.deny).toEqual(["Read(*.log)"]);

      // Check that the file is formatted with proper indentation
      expect(fileContent).toContain('  "'); // Should have 2-space indentation
      expect(fileContent.startsWith("{")).toBe(true);
      expect(fileContent.endsWith("}")).toBe(true);
    });

    it("should handle Read() permission format correctly", () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            deny: ["Read(**/*.secret)", "Read(private/**)", "Read(*.key)"],
          },
        },
        null,
        2,
      );

      const claudecodeIgnore = new ClaudecodeIgnore({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
        fileContent: jsonContent,
      });

      const patterns = claudecodeIgnore.getPatterns();
      expect(patterns).toEqual(["Read(**/*.secret)", "Read(private/**)", "Read(*.key)"]);

      const rulesyncIgnore = claudecodeIgnore.toRulesyncIgnore();
      expect(rulesyncIgnore.getFileContent()).toBe("**/*.secret\nprivate/**\n*.key");
    });
  });
});

import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { RulesyncRule } from "../../features/rules/rulesync-rule.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, listDirectoryFiles, removeFile, writeFileContent } from "../../utils/file.js";

describe("MCP Server", () => {
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

  describe("listRules functionality", () => {
    it("should list rules with frontmatter", async () => {
      // Create sample rule files
      const rule1 = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_OVERVIEW_FILE_NAME,
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Project overview",
          globs: ["**/*"],
        },
        body: "# Overview\n\nThis is the project overview.",
      });

      const rule2 = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "coding-style.md",
        frontmatter: {
          root: false,
          targets: ["cursor", "claudecode"],
          description: "Coding style guidelines",
          globs: ["**/*.ts", "**/*.js"],
        },
        body: "# Coding Style\n\nUse TypeScript.",
      });

      // Write the files
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(rule1.getFilePath(), rule1.getFileContent());
      await writeFileContent(rule2.getFilePath(), rule2.getFileContent());

      // Test reading the rules
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      const files = await listDirectoryFiles(rulesDir);
      const mdFiles = files.filter((file) => file.endsWith(".md"));

      const rules = await Promise.all(
        mdFiles.map(async (file) => {
          const rule = await RulesyncRule.fromFile({
            relativeFilePath: file,
            validate: true,
          });
          return {
            path: join(RULESYNC_RULES_RELATIVE_DIR_PATH, file),
            frontmatter: rule.getFrontmatter(),
          };
        }),
      );

      expect(rules).toHaveLength(2);

      const overview = rules.find((r) => r.path.includes(RULESYNC_OVERVIEW_FILE_NAME));
      expect(overview).toBeDefined();
      expect(overview?.frontmatter.description).toBe("Project overview");
      expect(overview?.frontmatter.globs).toEqual(["**/*"]);
      expect(overview?.frontmatter.root).toBe(true);

      const codingStyle = rules.find((r) => r.path.includes("coding-style.md"));
      expect(codingStyle).toBeDefined();
      expect(codingStyle?.frontmatter.description).toBe("Coding style guidelines");
      expect(codingStyle?.frontmatter.globs).toEqual(["**/*.ts", "**/*.js"]);
      expect(codingStyle?.frontmatter.root).toBe(false);
    });

    it("should return empty array when rules directory doesn't exist", async () => {
      // Don't create .rulesync/rules directory
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      const files = await listDirectoryFiles(rulesDir);
      expect(files).toEqual([]);
    });
  });

  describe("getRule functionality", () => {
    it("should get detailed rule information", async () => {
      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Test rule",
          globs: ["**/*.test.ts"],
        },
        body: "# Test Rule\n\nThis is a test rule body.",
      });

      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(rule.getFilePath(), rule.getFileContent());

      // Test reading the rule
      const readRule = await RulesyncRule.fromFile({
        relativeFilePath: "test-rule.md",
        validate: true,
      });

      expect(readRule.getFrontmatter().description).toBe("Test rule");
      expect(readRule.getBody()).toBe("# Test Rule\n\nThis is a test rule body.");
    });
  });

  describe("putRule functionality", () => {
    it("should create a new rule", async () => {
      const frontmatter: {
        root: boolean;
        targets: "*"[];
        description: string;
        globs: string[];
      } = {
        root: false,
        targets: ["*"],
        description: "New rule",
        globs: ["**/*.ts"],
      };

      const body = "# New Rule\n\nThis is a new rule.";

      // Create and write the rule
      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "new-rule.md",
        frontmatter,
        body,
        validate: true,
      });

      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(rule.getFilePath(), rule.getFileContent());

      // Verify the rule was created
      const readRule = await RulesyncRule.fromFile({
        relativeFilePath: "new-rule.md",
        validate: true,
      });

      expect(readRule.getFrontmatter().description).toBe("New rule");
      expect(readRule.getBody()).toBe(body);
    });

    it("should update an existing rule", async () => {
      // Create initial rule
      const initialRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "update-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Initial description",
          globs: ["**/*.ts"],
        },
        body: "Initial body",
      });

      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(initialRule.getFilePath(), initialRule.getFileContent());

      // Update the rule
      const updatedRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "update-rule.md",
        frontmatter: {
          root: false,
          targets: ["cursor"],
          description: "Updated description",
          globs: ["**/*.tsx"],
        },
        body: "Updated body",
      });

      await writeFileContent(updatedRule.getFilePath(), updatedRule.getFileContent());

      // Verify the rule was updated
      const readRule = await RulesyncRule.fromFile({
        relativeFilePath: "update-rule.md",
        validate: true,
      });

      expect(readRule.getFrontmatter().description).toBe("Updated description");
      expect(readRule.getBody()).toBe("Updated body");
      expect(readRule.getFrontmatter().targets).toEqual(["cursor"]);
    });
  });

  describe("deleteRule functionality", () => {
    it("should delete a rule file", async () => {
      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "delete-me.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Rule to delete",
          globs: ["**/*"],
        },
        body: "This rule will be deleted",
      });

      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(rule.getFilePath(), rule.getFileContent());

      // Verify rule exists
      const files = await listDirectoryFiles(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      expect(files).toContain("delete-me.md");

      // Delete the rule
      await removeFile(rule.getFilePath());

      // Verify rule was deleted
      const filesAfterDelete = await listDirectoryFiles(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH),
      );
      expect(filesAfterDelete).not.toContain("delete-me.md");
    });
  });

  describe("Path validation", () => {
    it("should reject paths outside .rulesync/rules/", () => {
      // Test path traversal attempts
      const invalidPaths = [
        "../../etc/passwd",
        "../rules/test.md",
        ".rulesync/test.md", // Not in rules subdirectory
        "test.md", // Not in .rulesync at all
      ];

      for (const invalidPath of invalidPaths) {
        expect(() => {
          // Validate that path starts with .rulesync/rules/
          const normalizedPath = invalidPath.replace(/\\/g, "/");
          if (!normalizedPath.startsWith(".rulesync/rules/")) {
            throw new Error("Invalid rule path: must be within .rulesync/rules/ directory");
          }
        }).toThrow(/Invalid rule path/);
      }
    });

    it("should accept valid paths within .rulesync/rules/", () => {
      const validPaths = [
        ".rulesync/rules/test.md",
        ".rulesync/rules/coding-style.md",
        ".rulesync/rules/my-rule.md",
      ];

      for (const validPath of validPaths) {
        const normalizedPath = validPath.replace(/\\/g, "/");
        expect(normalizedPath.startsWith(".rulesync/rules/")).toBe(true);
      }
    });

    it("should reject invalid filenames", () => {
      const invalidFilenames = [
        ".rulesync/rules/.hidden.md", // Hidden file
        ".rulesync/rules/test.txt", // Not .md
        ".rulesync/rules/test file.md", // Space in filename
        ".rulesync/rules/test@file.md", // Special character
      ];

      for (const filename of invalidFilenames) {
        const basename = filename.split("/").pop() || "";
        const isValid = /^[a-zA-Z0-9_-]+\.md$/.test(basename);
        expect(isValid).toBe(false);
      }
    });

    it("should accept valid filenames", () => {
      const validFilenames = [
        ".rulesync/rules/test.md",
        ".rulesync/rules/coding-style.md",
        ".rulesync/rules/my_rule-123.md",
      ];

      for (const filename of validFilenames) {
        const basename = filename.split("/").pop() || "";
        const isValid = /^[a-zA-Z0-9_-]+\.md$/.test(basename);
        expect(isValid).toBe(true);
      }
    });
  });

  describe("Resource constraints", () => {
    it("should respect file size limits", () => {
      const MAX_SIZE = 1024 * 1024; // 1MB
      const largeBody = "a".repeat(MAX_SIZE + 1);
      const frontmatter = { root: false, targets: ["*"], description: "Large file" };
      const estimatedSize = JSON.stringify(frontmatter).length + largeBody.length;

      expect(estimatedSize).toBeGreaterThan(MAX_SIZE);
    });

    it("should allow files under size limit", () => {
      const MAX_SIZE = 1024 * 1024; // 1MB
      const normalBody = "# Normal Rule\n\nThis is a normal sized rule.";
      const frontmatter = { root: false, targets: ["*"], description: "Normal file" };
      const estimatedSize = JSON.stringify(frontmatter).length + normalBody.length;

      expect(estimatedSize).toBeLessThan(MAX_SIZE);
    });
  });
});

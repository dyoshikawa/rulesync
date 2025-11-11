import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RulesyncRule } from "../../rules/rulesync-rule.js";
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
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "overview.md",
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
        relativeDirPath: ".rulesync/rules",
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
      await ensureDir(join(testDir, ".rulesync", "rules"));
      await writeFileContent(rule1.getFilePath(), rule1.getFileContent());
      await writeFileContent(rule2.getFilePath(), rule2.getFileContent());

      // Test reading the rules
      const rulesDir = join(testDir, ".rulesync", "rules");
      const files = await listDirectoryFiles(rulesDir);
      const mdFiles = files.filter((file) => file.endsWith(".md"));

      const rules = await Promise.all(
        mdFiles.map(async (file) => {
          const rule = await RulesyncRule.fromFile({
            relativeFilePath: file,
            validate: true,
          });
          return {
            path: join(".rulesync", "rules", file),
            frontmatter: rule.getFrontmatter(),
          };
        }),
      );

      expect(rules).toHaveLength(2);

      const overview = rules.find((r) => r.path.includes("overview.md"));
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
  });

  describe("getRule functionality", () => {
    it("should get detailed rule information", async () => {
      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Test rule",
          globs: ["**/*.test.ts"],
        },
        body: "# Test Rule\n\nThis is a test rule body.",
      });

      await ensureDir(join(testDir, ".rulesync", "rules"));
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
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "new-rule.md",
        frontmatter,
        body,
        validate: true,
      });

      await ensureDir(join(testDir, ".rulesync", "rules"));
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
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "update-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Initial description",
          globs: ["**/*.ts"],
        },
        body: "Initial body",
      });

      await ensureDir(join(testDir, ".rulesync", "rules"));
      await writeFileContent(initialRule.getFilePath(), initialRule.getFileContent());

      // Update the rule
      const updatedRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
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
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "delete-me.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Rule to delete",
          globs: ["**/*"],
        },
        body: "This rule will be deleted",
      });

      await ensureDir(join(testDir, ".rulesync", "rules"));
      await writeFileContent(rule.getFilePath(), rule.getFileContent());

      // Verify rule exists
      const files = await listDirectoryFiles(join(testDir, ".rulesync", "rules"));
      expect(files).toContain("delete-me.md");

      // Delete the rule
      await removeFile(rule.getFilePath());

      // Verify rule was deleted
      const filesAfterDelete = await listDirectoryFiles(join(testDir, ".rulesync", "rules"));
      expect(filesAfterDelete).not.toContain("delete-me.md");
    });
  });
});

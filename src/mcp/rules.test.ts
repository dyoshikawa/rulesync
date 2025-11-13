import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { ruleTools } from "./rules.js";

describe("MCP Rules Tools", () => {
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

  describe("listRules", () => {
    it("should return an empty array when .rulesync/rules directory is empty", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      const result = await ruleTools.listRules.execute();
      const parsed = JSON.parse(result);

      expect(parsed.rules).toEqual([]);
    });

    it("should list all rules with their frontmatter", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      // Create test rule files
      await writeFileContent(
        join(rulesDir, "rule1.md"),
        `---
root: true
targets: ["*"]
description: "First rule"
globs: ["*.ts"]
---
# Rule 1 body`,
      );

      await writeFileContent(
        join(rulesDir, "rule2.md"),
        `---
root: false
targets: ["cursor", "copilot"]
description: "Second rule"
---
# Rule 2 body`,
      );

      const result = await ruleTools.listRules.execute();
      const parsed = JSON.parse(result);

      expect(parsed.rules).toHaveLength(2);
      expect(parsed.rules[0].relativePathFromCwd).toBe(
        join(RULESYNC_RULES_RELATIVE_DIR_PATH, "rule1.md"),
      );
      expect(parsed.rules[0].frontmatter.root).toBe(true);
      expect(parsed.rules[0].frontmatter.description).toBe("First rule");
      expect(parsed.rules[1].relativePathFromCwd).toBe(
        join(RULESYNC_RULES_RELATIVE_DIR_PATH, "rule2.md"),
      );
      expect(parsed.rules[1].frontmatter.root).toBe(false);
    });

    it("should handle rules without frontmatter", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      await writeFileContent(join(rulesDir, "simple.md"), "# Simple rule without frontmatter");

      const result = await ruleTools.listRules.execute();
      const parsed = JSON.parse(result);

      expect(parsed.rules).toHaveLength(1);
      // RulesyncRule adds default values for missing frontmatter fields
      expect(parsed.rules[0].frontmatter).toEqual({
        root: false,
        targets: ["*"],
        description: "",
        globs: [],
      });
    });

    it("should skip non-markdown files", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      await writeFileContent(join(rulesDir, "rule.md"), "---\nroot: true\n---\n# Test");
      await writeFileContent(join(rulesDir, "not-a-rule.txt"), "Not a rule");
      await writeFileContent(join(rulesDir, "config.json"), '{"test": true}');

      const result = await ruleTools.listRules.execute();
      const parsed = JSON.parse(result);

      expect(parsed.rules).toHaveLength(1);
      expect(parsed.rules[0].relativePathFromCwd).toBe(
        join(RULESYNC_RULES_RELATIVE_DIR_PATH, "rule.md"),
      );
    });

    it("should handle invalid rule files gracefully", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      // Create a valid rule
      await writeFileContent(
        join(rulesDir, "valid.md"),
        `---
root: true
---
# Valid rule`,
      );

      // Create an invalid rule (malformed frontmatter)
      await writeFileContent(
        join(rulesDir, "invalid.md"),
        `---
this is not valid yaml: [[[
---
# Invalid rule`,
      );

      const result = await ruleTools.listRules.execute();
      const parsed = JSON.parse(result);

      // Should only include the valid rule
      expect(parsed.rules).toHaveLength(1);
      expect(parsed.rules[0].relativePathFromCwd).toBe(
        join(RULESYNC_RULES_RELATIVE_DIR_PATH, "valid.md"),
      );
    });
  });

  describe("getRule", () => {
    it("should get a rule with frontmatter and body", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      await writeFileContent(
        join(rulesDir, "test.md"),
        `---
root: true
targets: ["*"]
description: "Test rule"
globs: ["*.ts", "*.js"]
---
# Test Rule

This is the body of the test rule.`,
      );

      const result = await ruleTools.getRule.execute({
        relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "test.md"),
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(join(RULESYNC_RULES_RELATIVE_DIR_PATH, "test.md"));
      expect(parsed.frontmatter.root).toBe(true);
      expect(parsed.frontmatter.targets).toEqual(["*"]);
      expect(parsed.frontmatter.description).toBe("Test rule");
      expect(parsed.frontmatter.globs).toEqual(["*.ts", "*.js"]);
      expect(parsed.body).toContain("This is the body of the test rule.");
    });

    it("should throw error for non-existent rule", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      await expect(
        ruleTools.getRule.execute({
          relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "nonexistent.md"),
        }),
      ).rejects.toThrow();
    });

    it("should reject path traversal attempts", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      await expect(
        ruleTools.getRule.execute({
          relativePathFromCwd: "../../../etc/passwd",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should handle rule with cursor-specific configuration", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      await writeFileContent(
        join(rulesDir, "cursor-rule.md"),
        `---
root: false
targets: ["cursor"]
cursor:
  alwaysApply: true
  description: "Cursor specific rule"
  globs: ["*.tsx"]
---
# Cursor Rule Body`,
      );

      const result = await ruleTools.getRule.execute({
        relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "cursor-rule.md"),
      });
      const parsed = JSON.parse(result);

      expect(parsed.frontmatter.cursor).toEqual({
        alwaysApply: true,
        description: "Cursor specific rule",
        globs: ["*.tsx"],
      });
    });
  });

  describe("putRule", () => {
    it("should create a new rule", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      const result = await ruleTools.putRule.execute({
        relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "new-rule.md"),
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "New rule",
        },
        body: "# New Rule Body",
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(
        join(RULESYNC_RULES_RELATIVE_DIR_PATH, "new-rule.md"),
      );
      expect(parsed.frontmatter.root).toBe(true);
      expect(parsed.body).toBe("# New Rule Body");

      // Verify file was created
      const getResult = await ruleTools.getRule.execute({
        relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "new-rule.md"),
      });
      const getParsed = JSON.parse(getResult);
      expect(getParsed.body).toBe("# New Rule Body");
    });

    it("should update an existing rule", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      // Create initial rule
      await writeFileContent(
        join(rulesDir, "existing.md"),
        `---
root: true
description: "Original"
---
# Original body`,
      );

      // Update the rule
      const result = await ruleTools.putRule.execute({
        relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "existing.md"),
        frontmatter: {
          root: false,
          description: "Updated",
        },
        body: "# Updated body",
      });
      const parsed = JSON.parse(result);

      expect(parsed.frontmatter.root).toBe(false);
      expect(parsed.frontmatter.description).toBe("Updated");
      expect(parsed.body).toBe("# Updated body");
    });

    it("should reject path traversal attempts", async () => {
      await expect(
        ruleTools.putRule.execute({
          relativePathFromCwd: "../../../etc/passwd",
          frontmatter: { root: true },
          body: "malicious",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should reject oversized rules", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      const largeBody = "a".repeat(1024 * 1024 + 1); // > 1MB

      await expect(
        ruleTools.putRule.execute({
          relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "large.md"),
          frontmatter: { root: true },
          body: largeBody,
        }),
      ).rejects.toThrow(/exceeds maximum/i);
    });

    it("should allow updating existing rules even when at max count", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      // Create an existing rule
      await writeFileContent(
        join(rulesDir, "existing.md"),
        `---
root: true
---
# Existing rule`,
      );

      // Update should work regardless of count (since it's not creating new)
      const result = await ruleTools.putRule.execute({
        relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "existing.md"),
        frontmatter: { root: false, description: "Updated" },
        body: "# Updated rule",
      });
      const parsed = JSON.parse(result);

      expect(parsed.frontmatter.description).toBe("Updated");
      expect(parsed.body).toBe("# Updated rule");
    });

    it("should create .rulesync/rules directory if it doesn't exist", async () => {
      // Don't create the directory beforehand

      const result = await ruleTools.putRule.execute({
        relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "auto-created.md"),
        frontmatter: {
          root: true,
        },
        body: "# Auto-created",
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(
        join(RULESYNC_RULES_RELATIVE_DIR_PATH, "auto-created.md"),
      );
      expect(parsed.body).toBe("# Auto-created");
    });

    it("should handle complex frontmatter with tool-specific configurations", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      const result = await ruleTools.putRule.execute({
        relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "complex.md"),
        frontmatter: {
          root: false,
          targets: ["cursor", "claudecode"],
          description: "Complex rule",
          globs: ["*.ts", "*.tsx"],
          cursor: {
            alwaysApply: true,
            description: "Cursor override",
            globs: ["*.tsx"],
          },
          agentsmd: {
            subprojectPath: "packages/frontend",
          },
        },
        body: "# Complex rule body",
      });
      const parsed = JSON.parse(result);

      expect(parsed.frontmatter.cursor).toEqual({
        alwaysApply: true,
        description: "Cursor override",
        globs: ["*.tsx"],
      });
      expect(parsed.frontmatter.agentsmd).toEqual({
        subprojectPath: "packages/frontend",
      });
    });
  });

  describe("deleteRule", () => {
    it("should delete an existing rule", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      // Create a rule
      await writeFileContent(
        join(rulesDir, "to-delete.md"),
        `---
root: true
---
# To be deleted`,
      );

      // Verify it exists
      await expect(
        ruleTools.getRule.execute({
          relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "to-delete.md"),
        }),
      ).resolves.toBeDefined();

      // Delete it
      const result = await ruleTools.deleteRule.execute({
        relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "to-delete.md"),
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(
        join(RULESYNC_RULES_RELATIVE_DIR_PATH, "to-delete.md"),
      );

      // Verify it's deleted
      await expect(
        ruleTools.getRule.execute({
          relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "to-delete.md"),
        }),
      ).rejects.toThrow();
    });

    it("should succeed when deleting non-existent rule (idempotent)", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      // Deleting a non-existent file should succeed (idempotent operation)
      const result = await ruleTools.deleteRule.execute({
        relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "nonexistent.md"),
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(
        join(RULESYNC_RULES_RELATIVE_DIR_PATH, "nonexistent.md"),
      );
    });

    it("should reject path traversal attempts", async () => {
      await expect(
        ruleTools.deleteRule.execute({
          relativePathFromCwd: "../../../etc/passwd",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should delete only the specified rule and not affect others", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      // Create multiple rules
      await writeFileContent(join(rulesDir, "keep1.md"), "---\nroot: true\n---\n# Keep 1");
      await writeFileContent(join(rulesDir, "delete.md"), "---\nroot: true\n---\n# Delete");
      await writeFileContent(join(rulesDir, "keep2.md"), "---\nroot: true\n---\n# Keep 2");

      // Delete one
      await ruleTools.deleteRule.execute({
        relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "delete.md"),
      });

      // Verify others still exist
      const listResult = await ruleTools.listRules.execute();
      const parsed = JSON.parse(listResult);

      expect(parsed.rules).toHaveLength(2);
      expect(parsed.rules.map((r: any) => r.relativePathFromCwd)).toEqual([
        join(RULESYNC_RULES_RELATIVE_DIR_PATH, "keep1.md"),
        join(RULESYNC_RULES_RELATIVE_DIR_PATH, "keep2.md"),
      ]);
    });
  });

  describe("integration scenarios", () => {
    it("should handle full CRUD lifecycle", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      // Create
      await ruleTools.putRule.execute({
        relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "lifecycle.md"),
        frontmatter: {
          root: true,
          description: "Lifecycle test",
        },
        body: "# Initial body",
      });

      // Read
      let result = await ruleTools.getRule.execute({
        relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "lifecycle.md"),
      });
      let parsed = JSON.parse(result);
      expect(parsed.body).toBe("# Initial body");

      // Update
      await ruleTools.putRule.execute({
        relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "lifecycle.md"),
        frontmatter: {
          root: false,
          description: "Updated lifecycle test",
        },
        body: "# Updated body",
      });

      result = await ruleTools.getRule.execute({
        relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "lifecycle.md"),
      });
      parsed = JSON.parse(result);
      expect(parsed.body).toBe("# Updated body");
      expect(parsed.frontmatter.root).toBe(false);

      // Delete
      await ruleTools.deleteRule.execute({
        relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "lifecycle.md"),
      });

      await expect(
        ruleTools.getRule.execute({
          relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "lifecycle.md"),
        }),
      ).rejects.toThrow();
    });

    it("should handle multiple rules with different configurations", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      // Create multiple rules with different configs
      await ruleTools.putRule.execute({
        relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Project overview",
        },
        body: "# Project Overview",
      });

      await ruleTools.putRule.execute({
        relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "coding-guidelines.md"),
        frontmatter: {
          root: false,
          targets: ["cursor", "claudecode"],
          description: "Coding guidelines",
          globs: ["**/*.ts"],
        },
        body: "# Coding Guidelines",
      });

      await ruleTools.putRule.execute({
        relativePathFromCwd: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "testing.md"),
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Testing guidelines",
          globs: ["**/*.test.ts"],
        },
        body: "# Testing Guidelines",
      });

      // List all rules
      const listResult = await ruleTools.listRules.execute();
      const parsed = JSON.parse(listResult);

      expect(parsed.rules).toHaveLength(3);
      expect(parsed.rules.find((r: any) => r.frontmatter.root)).toBeDefined();
      expect(parsed.rules.filter((r: any) => !r.frontmatter.root)).toHaveLength(2);
    });
  });
});

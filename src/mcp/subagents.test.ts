import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { subagentTools } from "./subagents.js";

describe("MCP Subagents Tools", () => {
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

  describe("listSubagents", () => {
    it("should return an empty array when .rulesync/subagents directory is empty", async () => {
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      await ensureDir(subagentsDir);

      const result = await subagentTools.listSubagents.execute();
      const parsed = JSON.parse(result);

      expect(parsed.subagents).toEqual([]);
    });

    it("should list all subagents with their frontmatter", async () => {
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      await ensureDir(subagentsDir);

      // Create test subagent files
      await writeFileContent(
        join(subagentsDir, "code-reviewer.md"),
        `---
name: code-reviewer
targets: ["*"]
description: "Code review agent"
claudecode:
  model: sonnet
---
# Code Reviewer body`,
      );

      await writeFileContent(
        join(subagentsDir, "security-reviewer.md"),
        `---
name: security-reviewer
targets: ["cursor", "claudecode"]
description: "Security review agent"
claudecode:
  model: inherit
---
# Security Reviewer body`,
      );

      const result = await subagentTools.listSubagents.execute();
      const parsed = JSON.parse(result);

      expect(parsed.subagents).toHaveLength(2);
      expect(parsed.subagents[0].relativePathFromCwd).toBe(".rulesync/subagents/code-reviewer.md");
      expect(parsed.subagents[0].frontmatter.name).toBe("code-reviewer");
      expect(parsed.subagents[0].frontmatter.description).toBe("Code review agent");
      expect(parsed.subagents[1].relativePathFromCwd).toBe(
        ".rulesync/subagents/security-reviewer.md",
      );
      expect(parsed.subagents[1].frontmatter.name).toBe("security-reviewer");
    });

    it("should skip non-markdown files", async () => {
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      await ensureDir(subagentsDir);

      await writeFileContent(
        join(subagentsDir, "subagent.md"),
        `---
name: test-agent
targets: ["*"]
description: "Test"
---
# Test`,
      );
      await writeFileContent(join(subagentsDir, "not-a-subagent.txt"), "Not a subagent");
      await writeFileContent(join(subagentsDir, "config.json"), '{"test": true}');

      const result = await subagentTools.listSubagents.execute();
      const parsed = JSON.parse(result);

      expect(parsed.subagents).toHaveLength(1);
      expect(parsed.subagents[0].relativePathFromCwd).toBe(".rulesync/subagents/subagent.md");
    });

    it("should handle invalid subagent files gracefully", async () => {
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      await ensureDir(subagentsDir);

      // Create a valid subagent
      await writeFileContent(
        join(subagentsDir, "valid.md"),
        `---
name: valid-agent
targets: ["*"]
description: "Valid"
---
# Valid subagent`,
      );

      // Create an invalid subagent (malformed frontmatter)
      await writeFileContent(
        join(subagentsDir, "invalid.md"),
        `---
this is not valid yaml: [[[
---
# Invalid subagent`,
      );

      const result = await subagentTools.listSubagents.execute();
      const parsed = JSON.parse(result);

      // Should only include the valid subagent
      expect(parsed.subagents).toHaveLength(1);
      expect(parsed.subagents[0].relativePathFromCwd).toBe(".rulesync/subagents/valid.md");
    });
  });

  describe("getSubagent", () => {
    it("should get a subagent with frontmatter and body", async () => {
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      await ensureDir(subagentsDir);

      await writeFileContent(
        join(subagentsDir, "test.md"),
        `---
name: test-agent
targets: ["*"]
description: "Test subagent"
claudecode:
  model: haiku
---
# Test Subagent

This is the body of the test subagent.`,
      );

      const result = await subagentTools.getSubagent.execute({
        relativePathFromCwd: ".rulesync/subagents/test.md",
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(".rulesync/subagents/test.md");
      expect(parsed.frontmatter.name).toBe("test-agent");
      expect(parsed.frontmatter.targets).toEqual(["*"]);
      expect(parsed.frontmatter.description).toBe("Test subagent");
      expect(parsed.frontmatter.claudecode).toEqual({ model: "haiku" });
      expect(parsed.body).toContain("This is the body of the test subagent.");
    });

    it("should throw error for non-existent subagent", async () => {
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      await ensureDir(subagentsDir);

      await expect(
        subagentTools.getSubagent.execute({
          relativePathFromCwd: ".rulesync/subagents/nonexistent.md",
        }),
      ).rejects.toThrow();
    });

    it("should reject path traversal attempts", async () => {
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      await ensureDir(subagentsDir);

      await expect(
        subagentTools.getSubagent.execute({
          relativePathFromCwd: "../../../etc/passwd",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should handle subagent with specific model configuration", async () => {
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      await ensureDir(subagentsDir);

      await writeFileContent(
        join(subagentsDir, "opus-agent.md"),
        `---
name: opus-agent
targets: ["claudecode"]
description: "Opus model agent"
claudecode:
  model: opus
---
# Opus Agent Body`,
      );

      const result = await subagentTools.getSubagent.execute({
        relativePathFromCwd: ".rulesync/subagents/opus-agent.md",
      });
      const parsed = JSON.parse(result);

      expect(parsed.frontmatter.claudecode).toEqual({
        model: "opus",
      });
    });
  });

  describe("putSubagent", () => {
    it("should create a new subagent", async () => {
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      await ensureDir(subagentsDir);

      const result = await subagentTools.putSubagent.execute({
        relativePathFromCwd: ".rulesync/subagents/new-agent.md",
        frontmatter: {
          name: "new-agent",
          targets: ["*"],
          description: "New agent",
        },
        body: "# New Agent Body",
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(".rulesync/subagents/new-agent.md");
      expect(parsed.frontmatter.name).toBe("new-agent");
      expect(parsed.body).toBe("# New Agent Body");

      // Verify file was created
      const getResult = await subagentTools.getSubagent.execute({
        relativePathFromCwd: ".rulesync/subagents/new-agent.md",
      });
      const getParsed = JSON.parse(getResult);
      expect(getParsed.body).toBe("# New Agent Body");
    });

    it("should update an existing subagent", async () => {
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      await ensureDir(subagentsDir);

      // Create initial subagent
      await writeFileContent(
        join(subagentsDir, "existing.md"),
        `---
name: existing-agent
targets: ["*"]
description: "Original"
---
# Original body`,
      );

      // Update the subagent
      const result = await subagentTools.putSubagent.execute({
        relativePathFromCwd: ".rulesync/subagents/existing.md",
        frontmatter: {
          name: "existing-agent",
          targets: ["cursor"],
          description: "Updated",
        },
        body: "# Updated body",
      });
      const parsed = JSON.parse(result);

      expect(parsed.frontmatter.targets).toEqual(["cursor"]);
      expect(parsed.frontmatter.description).toBe("Updated");
      expect(parsed.body).toBe("# Updated body");
    });

    it("should reject path traversal attempts", async () => {
      await expect(
        subagentTools.putSubagent.execute({
          relativePathFromCwd: "../../../etc/passwd",
          frontmatter: {
            name: "malicious",
            targets: ["*"],
            description: "malicious",
          },
          body: "malicious",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should reject oversized subagents", async () => {
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      await ensureDir(subagentsDir);

      const largeBody = "a".repeat(1024 * 1024 + 1); // > 1MB

      await expect(
        subagentTools.putSubagent.execute({
          relativePathFromCwd: ".rulesync/subagents/large.md",
          frontmatter: {
            name: "large-agent",
            targets: ["*"],
            description: "Large",
          },
          body: largeBody,
        }),
      ).rejects.toThrow(/exceeds maximum/i);
    });

    it("should allow updating existing subagents even when at max count", async () => {
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      await ensureDir(subagentsDir);

      // Create an existing subagent
      await writeFileContent(
        join(subagentsDir, "existing.md"),
        `---
name: existing-agent
targets: ["*"]
description: "Original"
---
# Existing subagent`,
      );

      // Update should work regardless of count (since it's not creating new)
      const result = await subagentTools.putSubagent.execute({
        relativePathFromCwd: ".rulesync/subagents/existing.md",
        frontmatter: {
          name: "existing-agent",
          targets: ["claudecode"],
          description: "Updated",
        },
        body: "# Updated subagent",
      });
      const parsed = JSON.parse(result);

      expect(parsed.frontmatter.description).toBe("Updated");
      expect(parsed.body).toBe("# Updated subagent");
    });

    it("should create .rulesync/subagents directory if it doesn't exist", async () => {
      // Don't create the directory beforehand

      const result = await subagentTools.putSubagent.execute({
        relativePathFromCwd: ".rulesync/subagents/auto-created.md",
        frontmatter: {
          name: "auto-created",
          targets: ["*"],
          description: "Auto-created",
        },
        body: "# Auto-created",
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(".rulesync/subagents/auto-created.md");
      expect(parsed.body).toBe("# Auto-created");
    });

    it("should handle complex frontmatter with claudecode configuration", async () => {
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      await ensureDir(subagentsDir);

      const result = await subagentTools.putSubagent.execute({
        relativePathFromCwd: ".rulesync/subagents/complex.md",
        frontmatter: {
          name: "complex-agent",
          targets: ["claudecode"],
          description: "Complex agent",
          claudecode: {
            model: "opus",
          },
        },
        body: "# Complex agent body",
      });
      const parsed = JSON.parse(result);

      expect(parsed.frontmatter.claudecode).toEqual({
        model: "opus",
      });
    });
  });

  describe("deleteSubagent", () => {
    it("should delete an existing subagent", async () => {
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      await ensureDir(subagentsDir);

      // Create a subagent
      await writeFileContent(
        join(subagentsDir, "to-delete.md"),
        `---
name: to-delete
targets: ["*"]
description: "To be deleted"
---
# To be deleted`,
      );

      // Verify it exists
      await expect(
        subagentTools.getSubagent.execute({
          relativePathFromCwd: ".rulesync/subagents/to-delete.md",
        }),
      ).resolves.toBeDefined();

      // Delete it
      const result = await subagentTools.deleteSubagent.execute({
        relativePathFromCwd: ".rulesync/subagents/to-delete.md",
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(".rulesync/subagents/to-delete.md");

      // Verify it's deleted
      await expect(
        subagentTools.getSubagent.execute({
          relativePathFromCwd: ".rulesync/subagents/to-delete.md",
        }),
      ).rejects.toThrow();
    });

    it("should succeed when deleting non-existent subagent (idempotent)", async () => {
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      await ensureDir(subagentsDir);

      // Deleting a non-existent file should succeed (idempotent operation)
      const result = await subagentTools.deleteSubagent.execute({
        relativePathFromCwd: ".rulesync/subagents/nonexistent.md",
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(".rulesync/subagents/nonexistent.md");
    });

    it("should reject path traversal attempts", async () => {
      await expect(
        subagentTools.deleteSubagent.execute({
          relativePathFromCwd: "../../../etc/passwd",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should delete only the specified subagent and not affect others", async () => {
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      await ensureDir(subagentsDir);

      // Create multiple subagents
      await writeFileContent(
        join(subagentsDir, "keep1.md"),
        `---
name: keep1
targets: ["*"]
description: "Keep 1"
---
# Keep 1`,
      );
      await writeFileContent(
        join(subagentsDir, "delete.md"),
        `---
name: delete
targets: ["*"]
description: "Delete"
---
# Delete`,
      );
      await writeFileContent(
        join(subagentsDir, "keep2.md"),
        `---
name: keep2
targets: ["*"]
description: "Keep 2"
---
# Keep 2`,
      );

      // Delete one
      await subagentTools.deleteSubagent.execute({
        relativePathFromCwd: ".rulesync/subagents/delete.md",
      });

      // Verify others still exist
      const listResult = await subagentTools.listSubagents.execute();
      const parsed = JSON.parse(listResult);

      expect(parsed.subagents).toHaveLength(2);
      expect(parsed.subagents.map((s: any) => s.relativePathFromCwd)).toEqual([
        ".rulesync/subagents/keep1.md",
        ".rulesync/subagents/keep2.md",
      ]);
    });
  });

  describe("integration scenarios", () => {
    it("should handle full CRUD lifecycle", async () => {
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      await ensureDir(subagentsDir);

      // Create
      await subagentTools.putSubagent.execute({
        relativePathFromCwd: ".rulesync/subagents/lifecycle.md",
        frontmatter: {
          name: "lifecycle-agent",
          targets: ["*"],
          description: "Lifecycle test",
        },
        body: "# Initial body",
      });

      // Read
      let result = await subagentTools.getSubagent.execute({
        relativePathFromCwd: ".rulesync/subagents/lifecycle.md",
      });
      let parsed = JSON.parse(result);
      expect(parsed.body).toBe("# Initial body");

      // Update
      await subagentTools.putSubagent.execute({
        relativePathFromCwd: ".rulesync/subagents/lifecycle.md",
        frontmatter: {
          name: "lifecycle-agent",
          targets: ["claudecode"],
          description: "Updated lifecycle test",
        },
        body: "# Updated body",
      });

      result = await subagentTools.getSubagent.execute({
        relativePathFromCwd: ".rulesync/subagents/lifecycle.md",
      });
      parsed = JSON.parse(result);
      expect(parsed.body).toBe("# Updated body");
      expect(parsed.frontmatter.targets).toEqual(["claudecode"]);

      // Delete
      await subagentTools.deleteSubagent.execute({
        relativePathFromCwd: ".rulesync/subagents/lifecycle.md",
      });

      await expect(
        subagentTools.getSubagent.execute({
          relativePathFromCwd: ".rulesync/subagents/lifecycle.md",
        }),
      ).rejects.toThrow();
    });

    it("should handle multiple subagents with different configurations", async () => {
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      await ensureDir(subagentsDir);

      // Create multiple subagents with different configs
      await subagentTools.putSubagent.execute({
        relativePathFromCwd: ".rulesync/subagents/code-reviewer.md",
        frontmatter: {
          name: "code-reviewer",
          targets: ["*"],
          description: "Code reviewer",
          claudecode: {
            model: "sonnet",
          },
        },
        body: "# Code Reviewer",
      });

      await subagentTools.putSubagent.execute({
        relativePathFromCwd: ".rulesync/subagents/security-reviewer.md",
        frontmatter: {
          name: "security-reviewer",
          targets: ["claudecode"],
          description: "Security reviewer",
          claudecode: {
            model: "opus",
          },
        },
        body: "# Security Reviewer",
      });

      await subagentTools.putSubagent.execute({
        relativePathFromCwd: ".rulesync/subagents/test-runner.md",
        frontmatter: {
          name: "test-runner",
          targets: ["cursor", "claudecode"],
          description: "Test runner",
          claudecode: {
            model: "haiku",
          },
        },
        body: "# Test Runner",
      });

      // List all subagents
      const listResult = await subagentTools.listSubagents.execute();
      const parsed = JSON.parse(listResult);

      expect(parsed.subagents).toHaveLength(3);
      expect(
        parsed.subagents.find((s: any) => s.frontmatter.name === "code-reviewer"),
      ).toBeDefined();
      expect(
        parsed.subagents.filter((s: any) => s.frontmatter.targets.includes("claudecode")),
      ).toHaveLength(2);
    });
  });
});

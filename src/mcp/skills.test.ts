import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { skillTools } from "./skills.js";

describe("MCP Skills Tools", () => {
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

  describe("listSkills", () => {
    it("should return an empty array when .rulesync/skills directory is empty", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      const result = await skillTools.listSkills.execute();
      const parsed = JSON.parse(result);

      expect(parsed.skills).toEqual([]);
    });

    it("should list all skills with their frontmatter", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);

      // Create test skill directories
      await ensureDir(join(skillsDir, "code-reviewer"));
      await writeFileContent(
        join(skillsDir, "code-reviewer", SKILL_FILE_NAME),
        `---
name: code-reviewer
targets: ["*"]
description: "Code review skill"
---
# Code Reviewer body`,
      );

      await ensureDir(join(skillsDir, "security-scanner"));
      await writeFileContent(
        join(skillsDir, "security-scanner", SKILL_FILE_NAME),
        `---
name: security-scanner
targets: ["cursor", "claudecode"]
description: "Security scanning skill"
claudecode:
  allowed-tools:
    - "Bash"
    - "Read"
---
# Security Scanner body`,
      );

      const result = await skillTools.listSkills.execute();
      const parsed = JSON.parse(result);

      expect(parsed.skills).toHaveLength(2);
      expect(parsed.skills[0].relativeDirPathFromCwd).toBe(".rulesync/skills/code-reviewer");
      expect(parsed.skills[0].frontmatter.name).toBe("code-reviewer");
      expect(parsed.skills[0].frontmatter.description).toBe("Code review skill");
      expect(parsed.skills[1].relativeDirPathFromCwd).toBe(".rulesync/skills/security-scanner");
      expect(parsed.skills[1].frontmatter.name).toBe("security-scanner");
    });

    it("should skip directories without SKILL.md", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);

      // Create a valid skill
      await ensureDir(join(skillsDir, "valid-skill"));
      await writeFileContent(
        join(skillsDir, "valid-skill", SKILL_FILE_NAME),
        `---
name: valid-skill
targets: ["*"]
description: "Valid"
---
# Valid`,
      );

      // Create an invalid directory (no SKILL.md)
      await ensureDir(join(skillsDir, "invalid-skill"));
      await writeFileContent(join(skillsDir, "invalid-skill", "README.md"), "Not a skill");

      const result = await skillTools.listSkills.execute();
      const parsed = JSON.parse(result);

      expect(parsed.skills).toHaveLength(1);
      expect(parsed.skills[0].relativeDirPathFromCwd).toBe(".rulesync/skills/valid-skill");
    });

    it("should handle invalid skill files gracefully", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);

      // Create a valid skill
      await ensureDir(join(skillsDir, "valid"));
      await writeFileContent(
        join(skillsDir, "valid", SKILL_FILE_NAME),
        `---
name: valid-skill
targets: ["*"]
description: "Valid"
---
# Valid skill`,
      );

      // Create an invalid skill (malformed frontmatter)
      await ensureDir(join(skillsDir, "invalid"));
      await writeFileContent(
        join(skillsDir, "invalid", SKILL_FILE_NAME),
        `---
this is not valid yaml: [[[
---
# Invalid skill`,
      );

      const result = await skillTools.listSkills.execute();
      const parsed = JSON.parse(result);

      // Should only include the valid skill
      expect(parsed.skills).toHaveLength(1);
      expect(parsed.skills[0].relativeDirPathFromCwd).toBe(".rulesync/skills/valid");
    });
  });

  describe("getSkill", () => {
    it("should get a skill with frontmatter, body, and other files", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(join(skillsDir, "test-skill"));

      await writeFileContent(
        join(skillsDir, "test-skill", SKILL_FILE_NAME),
        `---
name: test-skill
targets: ["*"]
description: "Test skill"
claudecode:
  allowed-tools:
    - "Bash"
    - "Read"
---
# Test Skill

This is the body of the test skill.`,
      );

      // Create additional files
      await writeFileContent(
        join(skillsDir, "test-skill", "helper.ts"),
        "export const helper = 1;",
      );

      const result = await skillTools.getSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/test-skill",
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativeDirPathFromCwd).toBe(".rulesync/skills/test-skill");
      expect(parsed.frontmatter.name).toBe("test-skill");
      expect(parsed.frontmatter.targets).toEqual(["*"]);
      expect(parsed.frontmatter.description).toBe("Test skill");
      expect(parsed.frontmatter.claudecode).toEqual({ "allowed-tools": ["Bash", "Read"] });
      expect(parsed.body).toContain("This is the body of the test skill.");
      expect(parsed.otherFiles).toHaveLength(1);
      expect(parsed.otherFiles[0].name).toBe("helper.ts");
      expect(parsed.otherFiles[0].body).toBe("export const helper = 1;");
    });

    it("should throw error for non-existent skill", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      await expect(
        skillTools.getSkill.execute({
          relativeDirPathFromCwd: ".rulesync/skills/nonexistent",
        }),
      ).rejects.toThrow();
    });

    it("should reject path traversal attempts", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      await expect(
        skillTools.getSkill.execute({
          relativeDirPathFromCwd: "../../../etc/passwd",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should handle skill with claudecode configuration", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(join(skillsDir, "claude-skill"));

      await writeFileContent(
        join(skillsDir, "claude-skill", SKILL_FILE_NAME),
        `---
name: claude-skill
targets: ["claudecode"]
description: "Claude Code skill"
claudecode:
  allowed-tools:
    - "Bash"
    - "Read"
    - "Write"
---
# Claude Skill Body`,
      );

      const result = await skillTools.getSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/claude-skill",
      });
      const parsed = JSON.parse(result);

      expect(parsed.frontmatter.claudecode).toEqual({
        "allowed-tools": ["Bash", "Read", "Write"],
      });
    });
  });

  describe("putSkill", () => {
    it("should create a new skill", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      const result = await skillTools.putSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/new-skill",
        frontmatter: {
          name: "new-skill",
          targets: ["*"],
          description: "New skill",
        },
        body: "# New Skill Body",
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativeDirPathFromCwd).toBe(".rulesync/skills/new-skill");
      expect(parsed.frontmatter.name).toBe("new-skill");
      expect(parsed.body).toBe("# New Skill Body");

      // Verify skill was created
      const getResult = await skillTools.getSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/new-skill",
      });
      const getParsed = JSON.parse(getResult);
      expect(getParsed.body).toBe("# New Skill Body");
    });

    it("should update an existing skill", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(join(skillsDir, "existing"));

      // Create initial skill
      await writeFileContent(
        join(skillsDir, "existing", SKILL_FILE_NAME),
        `---
name: existing-skill
targets: ["*"]
description: "Original"
---
# Original body`,
      );

      // Update the skill
      const result = await skillTools.putSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/existing",
        frontmatter: {
          name: "existing-skill",
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

    it("should create skill with other files", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      const result = await skillTools.putSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/skill-with-files",
        frontmatter: {
          name: "skill-with-files",
          targets: ["*"],
          description: "Skill with files",
        },
        body: "# Skill with files",
        otherFiles: [
          { name: "helper.ts", body: "export const helper = 1;" },
          { name: "utils/format.ts", body: "export const format = () => {};" },
        ],
      });
      const parsed = JSON.parse(result);

      expect(parsed.otherFiles).toHaveLength(2);

      // Verify files were created
      const getResult = await skillTools.getSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/skill-with-files",
      });
      const getParsed = JSON.parse(getResult);
      expect(getParsed.otherFiles).toHaveLength(2);
    });

    it("should reject path traversal attempts", async () => {
      await expect(
        skillTools.putSkill.execute({
          relativeDirPathFromCwd: "../../../etc/passwd",
          frontmatter: {
            name: "malicious",
            targets: ["*"],
            description: "malicious",
          },
          body: "malicious",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should reject path traversal attempts in otherFiles", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      await expect(
        skillTools.putSkill.execute({
          relativeDirPathFromCwd: ".rulesync/skills/test-skill",
          frontmatter: {
            name: "test-skill",
            targets: ["*"],
            description: "test",
          },
          body: "test body",
          otherFiles: [{ name: "../../../etc/passwd", body: "malicious content" }],
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should reject oversized skills", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      const largeBody = "a".repeat(1024 * 1024 + 1); // > 1MB

      await expect(
        skillTools.putSkill.execute({
          relativeDirPathFromCwd: ".rulesync/skills/large",
          frontmatter: {
            name: "large-skill",
            targets: ["*"],
            description: "Large",
          },
          body: largeBody,
        }),
      ).rejects.toThrow(/exceeds maximum/i);
    });

    it("should allow updating existing skills even when at max count", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(join(skillsDir, "existing"));

      // Create an existing skill
      await writeFileContent(
        join(skillsDir, "existing", SKILL_FILE_NAME),
        `---
name: existing-skill
targets: ["*"]
description: "Original"
---
# Existing skill`,
      );

      // Update should work regardless of count (since it's not creating new)
      const result = await skillTools.putSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/existing",
        frontmatter: {
          name: "existing-skill",
          targets: ["claudecode"],
          description: "Updated",
        },
        body: "# Updated skill",
      });
      const parsed = JSON.parse(result);

      expect(parsed.frontmatter.description).toBe("Updated");
      expect(parsed.body).toBe("# Updated skill");
    });

    it("should create .rulesync/skills directory if it doesn't exist", async () => {
      // Don't create the directory beforehand

      const result = await skillTools.putSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/auto-created",
        frontmatter: {
          name: "auto-created",
          targets: ["*"],
          description: "Auto-created",
        },
        body: "# Auto-created",
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativeDirPathFromCwd).toBe(".rulesync/skills/auto-created");
      expect(parsed.body).toBe("# Auto-created");
    });

    it("should handle complex frontmatter with claudecode configuration", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      const result = await skillTools.putSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/complex",
        frontmatter: {
          name: "complex-skill",
          targets: ["claudecode"],
          description: "Complex skill",
          claudecode: {
            "allowed-tools": ["Bash", "Read", "Write", "Grep"],
          },
        },
        body: "# Complex skill body",
      });
      const parsed = JSON.parse(result);

      expect(parsed.frontmatter.claudecode).toEqual({
        "allowed-tools": ["Bash", "Read", "Write", "Grep"],
      });
    });
  });

  describe("deleteSkill", () => {
    it("should delete an existing skill", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(join(skillsDir, "to-delete"));

      // Create a skill
      await writeFileContent(
        join(skillsDir, "to-delete", SKILL_FILE_NAME),
        `---
name: to-delete
targets: ["*"]
description: "To be deleted"
---
# To be deleted`,
      );

      // Verify it exists
      await expect(
        skillTools.getSkill.execute({
          relativeDirPathFromCwd: ".rulesync/skills/to-delete",
        }),
      ).resolves.toBeDefined();

      // Delete it
      const result = await skillTools.deleteSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/to-delete",
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativeDirPathFromCwd).toBe(".rulesync/skills/to-delete");

      // Verify it's deleted
      await expect(
        skillTools.getSkill.execute({
          relativeDirPathFromCwd: ".rulesync/skills/to-delete",
        }),
      ).rejects.toThrow();
    });

    it("should succeed when deleting non-existent skill (idempotent)", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      // Deleting a non-existent directory should succeed (idempotent operation)
      const result = await skillTools.deleteSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/nonexistent",
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativeDirPathFromCwd).toBe(".rulesync/skills/nonexistent");
    });

    it("should reject path traversal attempts", async () => {
      await expect(
        skillTools.deleteSkill.execute({
          relativeDirPathFromCwd: "../../../etc/passwd",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should delete only the specified skill and not affect others", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);

      // Create multiple skills
      await ensureDir(join(skillsDir, "keep1"));
      await writeFileContent(
        join(skillsDir, "keep1", SKILL_FILE_NAME),
        `---
name: keep1
targets: ["*"]
description: "Keep 1"
---
# Keep 1`,
      );
      await ensureDir(join(skillsDir, "delete"));
      await writeFileContent(
        join(skillsDir, "delete", SKILL_FILE_NAME),
        `---
name: delete
targets: ["*"]
description: "Delete"
---
# Delete`,
      );
      await ensureDir(join(skillsDir, "keep2"));
      await writeFileContent(
        join(skillsDir, "keep2", SKILL_FILE_NAME),
        `---
name: keep2
targets: ["*"]
description: "Keep 2"
---
# Keep 2`,
      );

      // Delete one
      await skillTools.deleteSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/delete",
      });

      // Verify others still exist
      const listResult = await skillTools.listSkills.execute();
      const parsed = JSON.parse(listResult);

      expect(parsed.skills).toHaveLength(2);
      expect(
        parsed.skills.map((s: { relativeDirPathFromCwd: string }) => s.relativeDirPathFromCwd),
      ).toEqual([".rulesync/skills/keep1", ".rulesync/skills/keep2"]);
    });

    it("should delete skill directory with all its files", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(join(skillsDir, "with-files"));

      // Create a skill with multiple files
      await writeFileContent(
        join(skillsDir, "with-files", SKILL_FILE_NAME),
        `---
name: with-files
targets: ["*"]
description: "With files"
---
# With files`,
      );
      await writeFileContent(
        join(skillsDir, "with-files", "helper.ts"),
        "export const helper = 1;",
      );
      await ensureDir(join(skillsDir, "with-files", "utils"));
      await writeFileContent(
        join(skillsDir, "with-files", "utils", "format.ts"),
        "export const format = () => {};",
      );

      // Delete the skill
      await skillTools.deleteSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/with-files",
      });

      // Verify it's deleted
      await expect(
        skillTools.getSkill.execute({
          relativeDirPathFromCwd: ".rulesync/skills/with-files",
        }),
      ).rejects.toThrow();
    });
  });

  describe("integration scenarios", () => {
    it("should handle full CRUD lifecycle", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      // Create
      await skillTools.putSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/lifecycle",
        frontmatter: {
          name: "lifecycle-skill",
          targets: ["*"],
          description: "Lifecycle test",
        },
        body: "# Initial body",
      });

      // Read
      let result = await skillTools.getSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/lifecycle",
      });
      let parsed = JSON.parse(result);
      expect(parsed.body).toBe("# Initial body");

      // Update
      await skillTools.putSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/lifecycle",
        frontmatter: {
          name: "lifecycle-skill",
          targets: ["claudecode"],
          description: "Updated lifecycle test",
        },
        body: "# Updated body",
      });

      result = await skillTools.getSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/lifecycle",
      });
      parsed = JSON.parse(result);
      expect(parsed.body).toBe("# Updated body");
      expect(parsed.frontmatter.targets).toEqual(["claudecode"]);

      // Delete
      await skillTools.deleteSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/lifecycle",
      });

      await expect(
        skillTools.getSkill.execute({
          relativeDirPathFromCwd: ".rulesync/skills/lifecycle",
        }),
      ).rejects.toThrow();
    });

    it("should handle multiple skills with different configurations", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      // Create multiple skills with different configs
      await skillTools.putSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/code-reviewer",
        frontmatter: {
          name: "code-reviewer",
          targets: ["*"],
          description: "Code reviewer",
          claudecode: {
            "allowed-tools": ["Read", "Grep"],
          },
        },
        body: "# Code Reviewer",
      });

      await skillTools.putSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/security-scanner",
        frontmatter: {
          name: "security-scanner",
          targets: ["claudecode"],
          description: "Security scanner",
          claudecode: {
            "allowed-tools": ["Bash", "Read"],
          },
        },
        body: "# Security Scanner",
      });

      await skillTools.putSkill.execute({
        relativeDirPathFromCwd: ".rulesync/skills/test-runner",
        frontmatter: {
          name: "test-runner",
          targets: ["cursor", "claudecode"],
          description: "Test runner",
        },
        body: "# Test Runner",
      });

      // List all skills
      const listResult = await skillTools.listSkills.execute();
      const parsed = JSON.parse(listResult);

      expect(parsed.skills).toHaveLength(3);
      expect(
        parsed.skills.find(
          (s: { frontmatter: { name: string } }) => s.frontmatter.name === "code-reviewer",
        ),
      ).toBeDefined();
      expect(
        parsed.skills.filter((s: { frontmatter: { targets: string[] } }) =>
          s.frontmatter.targets.includes("claudecode"),
        ),
      ).toHaveLength(2);
    });
  });
});

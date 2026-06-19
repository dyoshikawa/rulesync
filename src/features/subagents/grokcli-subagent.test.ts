import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { GrokcliSubagent } from "./grokcli-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { ToolSubagent } from "./tool-subagent.js";

describe("GrokcliSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validMarkdownContent = `---
name: Test Grokcli Agent
description: Test grokcli agent description
---

This is the body of the grokcli agent.
It can be multiline.`;

  const invalidMarkdownContent = `---
# Missing required fields
invalid: true
---

Body content`;

  const markdownWithoutFrontmatter = `This is just plain content without frontmatter.`;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for grokcli subagents", () => {
      const paths = GrokcliSubagent.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: join(".grok", "agents"),
      });
    });

    it("should return same .grok/agents path in global mode (resolved relative to home)", () => {
      // Grok Build discovers agent definitions from `.grok/agents/` (project)
      // and `~/.grok/agents/` (global) — the same relative directory resolved
      // against the home dir in global mode (verified via `grok inspect`).
      const paths = GrokcliSubagent.getSettablePaths({ global: true });
      expect(paths).toEqual({
        relativeDirPath: join(".grok", "agents"),
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid markdown content", () => {
      const subagent = new GrokcliSubagent({
        outputRoot: testDir,
        relativeDirPath: ".grok/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Grokcli Agent",
          description: "Test grokcli agent description",
        },
        body: "This is the body of the grokcli agent.\nIt can be multiline.",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(GrokcliSubagent);
      expect(subagent.getBody()).toBe(
        "This is the body of the grokcli agent.\nIt can be multiline.",
      );
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test Grokcli Agent",
        description: "Test grokcli agent description",
      });
    });

    it("should create instance with empty name and description", () => {
      const subagent = new GrokcliSubagent({
        outputRoot: testDir,
        relativeDirPath: ".grok/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "",
          description: "",
        },
        body: "This is a grokcli agent without name or description.",
        validate: true,
      });

      expect(subagent.getBody()).toBe("This is a grokcli agent without name or description.");
      expect(subagent.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
    });

    it("should create instance without validation when validate is false", () => {
      const subagent = new GrokcliSubagent({
        outputRoot: testDir,
        relativeDirPath: ".grok/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test body",
        validate: false,
      });

      expect(subagent).toBeInstanceOf(GrokcliSubagent);
    });

    it("should throw error for invalid frontmatter when validation is enabled", () => {
      expect(
        () =>
          new GrokcliSubagent({
            outputRoot: testDir,
            relativeDirPath: ".grok/agents",
            relativeFilePath: "invalid-agent.md",
            frontmatter: {
              // Missing required fields
            } as { name: string },
            body: "Body content",
            validate: true,
          }),
      ).toThrow();
    });
  });

  describe("getBody", () => {
    it("should return the body content", () => {
      const subagent = new GrokcliSubagent({
        outputRoot: testDir,
        relativeDirPath: ".grok/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Agent",
          description: "Test description",
        },
        body: "This is the body content.\nWith multiple lines.",
        validate: true,
      });

      expect(subagent.getBody()).toBe("This is the body content.\nWith multiple lines.");
    });
  });

  describe("getFrontmatter", () => {
    it("should return frontmatter with name and description", () => {
      const subagent = new GrokcliSubagent({
        outputRoot: testDir,
        relativeDirPath: ".grok/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Grokcli Agent",
          description: "Test grokcli agent",
        },
        body: "Test body",
        validate: true,
      });

      const frontmatter = subagent.getFrontmatter();
      expect(frontmatter).toEqual({
        name: "Test Grokcli Agent",
        description: "Test grokcli agent",
      });
    });

    it("should preserve grok-specific tuning keys via the loose schema", () => {
      const subagent = new GrokcliSubagent({
        outputRoot: testDir,
        relativeDirPath: ".grok/agents",
        relativeFilePath: "tuned-agent.md",
        frontmatter: {
          name: "Tuned Agent",
          description: "Agent with grok tuning keys",
          prompt_mode: "full",
          model: "inherit",
          permission_mode: "plan",
          agents_md: true,
        },
        body: "Test body",
        validate: true,
      });

      expect(subagent.getFrontmatter()).toEqual({
        name: "Tuned Agent",
        description: "Agent with grok tuning keys",
        prompt_mode: "full",
        model: "inherit",
        permission_mode: "plan",
        agents_md: true,
      });
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should convert to RulesyncSubagent", () => {
      const subagent = new GrokcliSubagent({
        outputRoot: testDir,
        relativeDirPath: ".grok/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      expect(rulesyncSubagent).toBeInstanceOf(RulesyncSubagent);
      expect(rulesyncSubagent.getFrontmatter().name).toBe("Test Agent");
      expect(rulesyncSubagent.getFrontmatter().description).toBe("Test description");
      expect(rulesyncSubagent.getBody()).toBe("Test body");
    });

    it("should carry grok tuning keys into the grokcli section", () => {
      const subagent = new GrokcliSubagent({
        outputRoot: testDir,
        relativeDirPath: ".grok/agents",
        relativeFilePath: "tuned-agent.md",
        frontmatter: {
          name: "Tuned Agent",
          description: "Tuned description",
          permission_mode: "plan",
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      expect(rulesyncSubagent.getFrontmatter().grokcli).toEqual({ permission_mode: "plan" });
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should create GrokcliSubagent from RulesyncSubagent", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["grokcli"],
          name: "Test Agent",
          description: "Test description from rulesync",
        },
        body: "Test agent content",
        validate: true,
      });

      const grokcliSubagent = GrokcliSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".grok/agents",
        rulesyncSubagent,
        validate: true,
      }) as GrokcliSubagent;

      expect(grokcliSubagent).toBeInstanceOf(GrokcliSubagent);
      expect(grokcliSubagent.getBody()).toBe("Test agent content");
      expect(grokcliSubagent.getFrontmatter()).toEqual({
        name: "Test Agent",
        description: "Test description from rulesync",
      });
      expect(grokcliSubagent.getRelativeFilePath()).toBe("test-agent.md");
      expect(grokcliSubagent.getRelativeDirPath()).toBe(".grok/agents");
    });

    it("should restore grok tuning keys from the grokcli section", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "tuned-agent.md",
        frontmatter: {
          targets: ["grokcli"],
          name: "Tuned Agent",
          description: "Tuned description",
          grokcli: { permission_mode: "plan", prompt_mode: "full" },
        },
        body: "Test content",
        validate: true,
      });

      const grokcliSubagent = GrokcliSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".grok/agents",
        rulesyncSubagent,
        validate: true,
      }) as GrokcliSubagent;

      expect(grokcliSubagent.getFrontmatter()).toEqual({
        name: "Tuned Agent",
        description: "Tuned description",
        permission_mode: "plan",
        prompt_mode: "full",
      });
    });

    it("should handle RulesyncSubagent with different file extensions", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "complex-agent.txt",
        frontmatter: {
          targets: ["grokcli"],
          name: "Complex Agent",
          description: "Complex agent",
        },
        body: "Complex content",
        validate: true,
      });

      const grokcliSubagent = GrokcliSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".grok/agents",
        rulesyncSubagent,
        validate: true,
      }) as GrokcliSubagent;

      expect(grokcliSubagent.getRelativeFilePath()).toBe("complex-agent.txt");
    });

    it("should handle empty name and description", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["grokcli"],
          name: "",
          description: "",
        },
        body: "Test content",
        validate: true,
      });

      const grokcliSubagent = GrokcliSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".grok/agents",
        rulesyncSubagent,
        validate: true,
      }) as GrokcliSubagent;

      expect(grokcliSubagent.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
    });
  });

  describe("fromFile", () => {
    it("should load GrokcliSubagent from file", async () => {
      const subagentsDir = join(testDir, ".grok", "agents");
      const filePath = join(subagentsDir, "test-file-agent.md");

      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await GrokcliSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "test-file-agent.md",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(GrokcliSubagent);
      expect(subagent.getBody()).toBe(
        "This is the body of the grokcli agent.\nIt can be multiline.",
      );
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test Grokcli Agent",
        description: "Test grokcli agent description",
      });
      expect(subagent.getRelativeFilePath()).toBe("test-file-agent.md");
    });

    it("should handle file path with subdirectories", async () => {
      const subagentsDir = join(testDir, ".grok", "agents", "subdir");
      const filePath = join(subagentsDir, "nested-agent.md");

      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await GrokcliSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "subdir/nested-agent.md",
        validate: true,
      });

      expect(subagent.getRelativeFilePath()).toBe("subdir/nested-agent.md");
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        GrokcliSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "non-existent-agent.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should throw error when file contains invalid frontmatter", async () => {
      const subagentsDir = join(testDir, ".grok", "agents");
      const filePath = join(subagentsDir, "invalid-agent.md");

      await writeFileContent(filePath, invalidMarkdownContent);

      await expect(
        GrokcliSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "invalid-agent.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should handle file without frontmatter", async () => {
      const subagentsDir = join(testDir, ".grok", "agents");
      const filePath = join(subagentsDir, "no-frontmatter.md");

      await writeFileContent(filePath, markdownWithoutFrontmatter);

      await expect(
        GrokcliSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "no-frontmatter.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const subagent = new GrokcliSubagent({
        outputRoot: testDir,
        relativeDirPath: ".grok/agents",
        relativeFilePath: "valid-agent.md",
        frontmatter: {
          name: "Valid Agent",
          description: "Valid description",
        },
        body: "Valid body",
        validate: false,
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should handle frontmatter with additional properties", () => {
      const subagent = new GrokcliSubagent({
        outputRoot: testDir,
        relativeDirPath: ".grok/agents",
        relativeFilePath: "agent-with-extras.md",
        frontmatter: {
          name: "Agent",
          description: "Agent with extra properties",
          extra: "property",
        },
        body: "Body content",
        validate: false,
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle empty body content", () => {
      const subagent = new GrokcliSubagent({
        outputRoot: testDir,
        relativeDirPath: ".grok/agents",
        relativeFilePath: "empty-body.md",
        frontmatter: {
          name: "Empty Body Agent",
          description: "Agent with empty body",
        },
        body: "",
        validate: true,
      });

      expect(subagent.getBody()).toBe("");
      expect(subagent.getFrontmatter()).toEqual({
        name: "Empty Body Agent",
        description: "Agent with empty body",
      });
    });

    it("should handle special characters in content", () => {
      const specialContent =
        "Special characters: @#$%^&*()\nUnicode: 你好世界 🌍\nQuotes: \"Hello 'World'\"";

      const subagent = new GrokcliSubagent({
        outputRoot: testDir,
        relativeDirPath: ".grok/agents",
        relativeFilePath: "special-char.md",
        frontmatter: {
          name: "Special Agent",
          description: "Special characters test",
        },
        body: specialContent,
        validate: true,
      });

      expect(subagent.getBody()).toBe(specialContent);
      expect(subagent.getBody()).toContain("@#$%^&*()");
      expect(subagent.getBody()).toContain("你好世界 🌍");
      expect(subagent.getBody()).toContain("\"Hello 'World'\"");
    });

    it("should handle very long content", () => {
      const longContent = "A".repeat(10000);

      const subagent = new GrokcliSubagent({
        outputRoot: testDir,
        relativeDirPath: ".grok/agents",
        relativeFilePath: "long-content.md",
        frontmatter: {
          name: "Long Agent",
          description: "Long content test",
        },
        body: longContent,
        validate: true,
      });

      expect(subagent.getBody()).toBe(longContent);
      expect(subagent.getBody().length).toBe(10000);
    });

    it("should handle Windows-style line endings", () => {
      const windowsContent = "Line 1\r\nLine 2\r\nLine 3";

      const subagent = new GrokcliSubagent({
        outputRoot: testDir,
        relativeDirPath: ".grok/agents",
        relativeFilePath: "windows-lines.md",
        frontmatter: {
          name: "Windows Agent",
          description: "Test with Windows line endings",
        },
        body: windowsContent,
        validate: true,
      });

      expect(subagent.getBody()).toBe(windowsContent);
    });
  });

  describe("inheritance", () => {
    it("should be an instance of ToolSubagent", () => {
      const subagent = new GrokcliSubagent({
        outputRoot: testDir,
        relativeDirPath: ".grok/agents",
        relativeFilePath: "test.md",
        frontmatter: {
          name: "Test",
          description: "Test",
        },
        body: "Test",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(GrokcliSubagent);
      expect(subagent).toBeInstanceOf(ToolSubagent);
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should return true when targets includes grokcli", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["grokcli"],
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test content",
        validate: true,
      });

      expect(GrokcliSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return true when targets includes asterisk", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["*"],
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test content",
        validate: true,
      });

      expect(GrokcliSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return false when targets array is empty", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: [],
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test content",
        validate: false,
      });

      expect(GrokcliSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(false);
    });

    it("should return false when targets does not include grokcli", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["copilot", "cline"],
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test content",
        validate: true,
      });

      expect(GrokcliSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(false);
    });

    it("should return true when targets includes grokcli among other targets", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["copilot", "grokcli", "cline"],
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test content",
        validate: true,
      });

      expect(GrokcliSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });
  });
});

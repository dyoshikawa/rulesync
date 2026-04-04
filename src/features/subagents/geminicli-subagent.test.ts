import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { GeminiCliSubagent } from "./geminicli-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { ToolSubagent } from "./tool-subagent.js";

describe("GeminiCliSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validMarkdownContent = `---
name: Test GeminiCli Agent
description: Test geminicli agent description
---

This is the body of the geminicli agent.
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
    it("should return correct paths for geminicli subagents", () => {
      const paths = GeminiCliSubagent.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: join(".gemini", "agents"),
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid markdown content", () => {
      const subagent = new GeminiCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".gemini/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test GeminiCli Agent",
          description: "Test geminicli agent description",
        },
        body: "This is the body of the geminicli agent.\nIt can be multiline.",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(GeminiCliSubagent);
      expect(subagent.getBody()).toBe(
        "This is the body of the geminicli agent.\nIt can be multiline.",
      );
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test GeminiCli Agent",
        description: "Test geminicli agent description",
      });
    });

    it("should create instance with empty name and description", () => {
      const subagent = new GeminiCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".gemini/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "",
          description: "",
        },
        body: "This is a geminicli agent without name or description.",
        validate: true,
      });

      expect(subagent.getBody()).toBe("This is a geminicli agent without name or description.");
      expect(subagent.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
    });

    it("should create instance without validation when validate is false", () => {
      const subagent = new GeminiCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".gemini/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test body",
        validate: false,
      });

      expect(subagent).toBeInstanceOf(GeminiCliSubagent);
    });

    it("should throw error for invalid frontmatter when validation is enabled", () => {
      expect(
        () =>
          new GeminiCliSubagent({
            baseDir: testDir,
            relativeDirPath: ".gemini/agents",
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
      const subagent = new GeminiCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".gemini/agents",
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
      const subagent = new GeminiCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".gemini/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test GeminiCli Agent",
          description: "Test geminicli agent",
        },
        body: "Test body",
        validate: true,
      });

      const frontmatter = subagent.getFrontmatter();
      expect(frontmatter).toEqual({
        name: "Test GeminiCli Agent",
        description: "Test geminicli agent",
      });
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should convert to RulesyncSubagent", () => {
      const subagent = new GeminiCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".gemini/agents",
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
  });

  describe("fromRulesyncSubagent", () => {
    it("should create GeminiCliSubagent from RulesyncSubagent", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["geminicli"],
          name: "Test Agent",
          description: "Test description from rulesync",
        },
        body: "Test agent content",
        validate: true,
      });

      const geminiCliSubagent = GeminiCliSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".gemini/agents",
        rulesyncSubagent,
        validate: true,
      }) as GeminiCliSubagent;

      expect(geminiCliSubagent).toBeInstanceOf(GeminiCliSubagent);
      expect(geminiCliSubagent.getBody()).toBe("Test agent content");
      expect(geminiCliSubagent.getFrontmatter()).toEqual({
        name: "Test Agent",
        description: "Test description from rulesync",
      });
      expect(geminiCliSubagent.getRelativeFilePath()).toBe("test-agent.md");
      expect(geminiCliSubagent.getRelativeDirPath()).toBe(".gemini/agents");
    });

    it("should handle RulesyncSubagent with different file extensions", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "complex-agent.txt",
        frontmatter: {
          targets: ["geminicli"],
          name: "Complex Agent",
          description: "Complex agent",
        },
        body: "Complex content",
        validate: true,
      });

      const geminiCliSubagent = GeminiCliSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".gemini/agents",
        rulesyncSubagent,
        validate: true,
      }) as GeminiCliSubagent;

      expect(geminiCliSubagent.getRelativeFilePath()).toBe("complex-agent.txt");
    });

    it("should handle empty name and description", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["geminicli"],
          name: "",
          description: "",
        },
        body: "Test content",
        validate: true,
      });

      const geminiCliSubagent = GeminiCliSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".gemini/agents",
        rulesyncSubagent,
        validate: true,
      }) as GeminiCliSubagent;

      expect(geminiCliSubagent.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
    });
  });

  describe("fromFile", () => {
    it("should load GeminiCliSubagent from file", async () => {
      const subagentsDir = join(testDir, ".gemini", "agents");
      const filePath = join(subagentsDir, "test-file-agent.md");

      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await GeminiCliSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-file-agent.md",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(GeminiCliSubagent);
      expect(subagent.getBody()).toBe(
        "This is the body of the geminicli agent.\nIt can be multiline.",
      );
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test GeminiCli Agent",
        description: "Test geminicli agent description",
      });
      expect(subagent.getRelativeFilePath()).toBe("test-file-agent.md");
    });

    it("should handle file path with subdirectories", async () => {
      const subagentsDir = join(testDir, ".gemini", "agents", "subdir");
      const filePath = join(subagentsDir, "nested-agent.md");

      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await GeminiCliSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "subdir/nested-agent.md",
        validate: true,
      });

      expect(subagent.getRelativeFilePath()).toBe("nested-agent.md");
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        GeminiCliSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "non-existent-agent.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should throw error when file contains invalid frontmatter", async () => {
      const subagentsDir = join(testDir, ".gemini", "agents");
      const filePath = join(subagentsDir, "invalid-agent.md");

      await writeFileContent(filePath, invalidMarkdownContent);

      await expect(
        GeminiCliSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "invalid-agent.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should handle file without frontmatter", async () => {
      const subagentsDir = join(testDir, ".gemini", "agents");
      const filePath = join(subagentsDir, "no-frontmatter.md");

      await writeFileContent(filePath, markdownWithoutFrontmatter);

      await expect(
        GeminiCliSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "no-frontmatter.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const subagent = new GeminiCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".gemini/agents",
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
      const subagent = new GeminiCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".gemini/agents",
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
      const subagent = new GeminiCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".gemini/agents",
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

      const subagent = new GeminiCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".gemini/agents",
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

      const subagent = new GeminiCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".gemini/agents",
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

    it("should handle multi-line name and description", () => {
      const subagent = new GeminiCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".gemini/agents",
        relativeFilePath: "multiline-fields.md",
        frontmatter: {
          name: "Multi-line\nAgent Name",
          description: "This is a multi-line\ndescription with\nmultiple lines",
        },
        body: "Test body",
        validate: true,
      });

      expect(subagent.getFrontmatter()).toEqual({
        name: "Multi-line\nAgent Name",
        description: "This is a multi-line\ndescription with\nmultiple lines",
      });
    });

    it("should handle Windows-style line endings", () => {
      const windowsContent = "Line 1\r\nLine 2\r\nLine 3";

      const subagent = new GeminiCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".gemini/agents",
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
      const subagent = new GeminiCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".gemini/agents",
        relativeFilePath: "test.md",
        frontmatter: {
          name: "Test",
          description: "Test",
        },
        body: "Test",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(GeminiCliSubagent);
      expect(subagent).toBeInstanceOf(ToolSubagent);
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should return true when targets includes geminicli", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["geminicli"],
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test content",
        validate: true,
      });

      expect(GeminiCliSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return true when targets includes asterisk", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
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

      expect(GeminiCliSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return false when targets array is empty", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
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

      expect(GeminiCliSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(false);
    });

    it("should return false when targets does not include geminicli", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
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

      expect(GeminiCliSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(false);
    });

    it("should return true when targets includes geminicli among other targets", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["copilot", "geminicli", "cline"],
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test content",
        validate: true,
      });

      expect(GeminiCliSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });
  });
});

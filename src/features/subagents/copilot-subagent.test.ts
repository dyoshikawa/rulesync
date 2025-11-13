import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CopilotSubagent } from "./copilot-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import {
  SimulatedSubagentFrontmatter,
  SimulatedSubagentFrontmatterSchema,
} from "./simulated-subagent.js";

describe("CopilotSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validMarkdownContent = `---
name: Test Copilot Agent
description: Test copilot agent description
---

This is the body of the copilot agent.
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
    it("should return correct paths for copilot subagents", () => {
      const paths = CopilotSubagent.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: ".github/subagents",
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid markdown content", () => {
      const subagent = new CopilotSubagent({
        baseDir: testDir,
        relativeDirPath: ".github/subagents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Copilot Agent",
          description: "Test copilot agent description",
        },
        body: "This is the body of the copilot agent.\nIt can be multiline.",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(CopilotSubagent);
      expect(subagent.getBody()).toBe(
        "This is the body of the copilot agent.\nIt can be multiline.",
      );
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test Copilot Agent",
        description: "Test copilot agent description",
      });
    });

    it("should create instance with empty name and description", () => {
      const subagent = new CopilotSubagent({
        baseDir: testDir,
        relativeDirPath: ".github/subagents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "",
          description: "",
        },
        body: "This is a copilot agent without name or description.",
        validate: true,
      });

      expect(subagent.getBody()).toBe("This is a copilot agent without name or description.");
      expect(subagent.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
    });

    it("should create instance without validation when validate is false", () => {
      const subagent = new CopilotSubagent({
        baseDir: testDir,
        relativeDirPath: ".github/subagents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test body",
        validate: false,
      });

      expect(subagent).toBeInstanceOf(CopilotSubagent);
    });

    it("should throw error for invalid frontmatter when validation is enabled", () => {
      expect(
        () =>
          new CopilotSubagent({
            baseDir: testDir,
            relativeDirPath: ".github/subagents",
            relativeFilePath: "invalid-agent.md",
            frontmatter: {
              // Missing required fields
            } as SimulatedSubagentFrontmatter,
            body: "Body content",
            validate: true,
          }),
      ).toThrow();
    });
  });

  describe("getBody", () => {
    it("should return the body content", () => {
      const subagent = new CopilotSubagent({
        baseDir: testDir,
        relativeDirPath: ".github/subagents",
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
      const subagent = new CopilotSubagent({
        baseDir: testDir,
        relativeDirPath: ".github/subagents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Copilot Agent",
          description: "Test copilot agent",
        },
        body: "Test body",
        validate: true,
      });

      const frontmatter = subagent.getFrontmatter();
      expect(frontmatter).toEqual({
        name: "Test Copilot Agent",
        description: "Test copilot agent",
      });
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should throw error as it is a simulated file", () => {
      const subagent = new CopilotSubagent({
        baseDir: testDir,
        relativeDirPath: ".github/subagents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test body",
        validate: true,
      });

      expect(() => subagent.toRulesyncSubagent()).toThrow(
        "Not implemented because it is a SIMULATED file.",
      );
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should create CopilotSubagent from RulesyncSubagent", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["copilot"],
          name: "Test Agent",
          description: "Test description from rulesync",
        },
        body: "Test agent content",
        validate: true,
      });

      const copilotSubagent = CopilotSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".github/subagents",
        rulesyncSubagent,
        validate: true,
      }) as CopilotSubagent;

      expect(copilotSubagent).toBeInstanceOf(CopilotSubagent);
      expect(copilotSubagent.getBody()).toBe("Test agent content");
      expect(copilotSubagent.getFrontmatter()).toEqual({
        name: "Test Agent",
        description: "Test description from rulesync",
      });
      expect(copilotSubagent.getRelativeFilePath()).toBe("test-agent.md");
      expect(copilotSubagent.getRelativeDirPath()).toBe(".github/subagents");
    });

    it("should handle RulesyncSubagent with different file extensions", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "complex-agent.txt",
        frontmatter: {
          targets: ["copilot"],
          name: "Complex Agent",
          description: "Complex agent",
        },
        body: "Complex content",
        validate: true,
      });

      const copilotSubagent = CopilotSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".github/subagents",
        rulesyncSubagent,
        validate: true,
      }) as CopilotSubagent;

      expect(copilotSubagent.getRelativeFilePath()).toBe("complex-agent.txt");
    });

    it("should handle empty name and description", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["copilot"],
          name: "",
          description: "",
        },
        body: "Test content",
        validate: true,
      });

      const copilotSubagent = CopilotSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".github/subagents",
        rulesyncSubagent,
        validate: true,
      }) as CopilotSubagent;

      expect(copilotSubagent.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
    });
  });

  describe("fromFile", () => {
    it("should load CopilotSubagent from file", async () => {
      const subagentsDir = join(testDir, ".github", "subagents");
      const filePath = join(subagentsDir, "test-file-agent.md");

      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await CopilotSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-file-agent.md",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(CopilotSubagent);
      expect(subagent.getBody()).toBe(
        "This is the body of the copilot agent.\nIt can be multiline.",
      );
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test Copilot Agent",
        description: "Test copilot agent description",
      });
      expect(subagent.getRelativeFilePath()).toBe("test-file-agent.md");
    });

    it("should use process.cwd() as default baseDir", async () => {
      const subagentsDir = join(testDir, ".github", "subagents");
      const filePath = join(subagentsDir, "default-basedir-agent.md");

      await writeFileContent(filePath, validMarkdownContent);

      // Not passing baseDir - should use mocked process.cwd()
      const subagent = await CopilotSubagent.fromFile({
        relativeFilePath: "default-basedir-agent.md",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(CopilotSubagent);
      expect(subagent.getBody()).toBe(
        "This is the body of the copilot agent.\nIt can be multiline.",
      );
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test Copilot Agent",
        description: "Test copilot agent description",
      });
    });

    it("should handle file path with subdirectories", async () => {
      const subagentsDir = join(testDir, ".github", "subagents", "subdir");
      const filePath = join(subagentsDir, "nested-agent.md");

      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await CopilotSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "subdir/nested-agent.md",
        validate: true,
      });

      expect(subagent.getRelativeFilePath()).toBe("nested-agent.md");
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        CopilotSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "non-existent-agent.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should throw error when file contains invalid frontmatter", async () => {
      const subagentsDir = join(testDir, ".github", "subagents");
      const filePath = join(subagentsDir, "invalid-agent.md");

      await writeFileContent(filePath, invalidMarkdownContent);

      await expect(
        CopilotSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "invalid-agent.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should handle file without frontmatter", async () => {
      const subagentsDir = join(testDir, ".github", "subagents");
      const filePath = join(subagentsDir, "no-frontmatter.md");

      await writeFileContent(filePath, markdownWithoutFrontmatter);

      await expect(
        CopilotSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "no-frontmatter.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const subagent = new CopilotSubagent({
        baseDir: testDir,
        relativeDirPath: ".github/subagents",
        relativeFilePath: "valid-agent.md",
        frontmatter: {
          name: "Valid Agent",
          description: "Valid description",
        },
        body: "Valid body",
        validate: false, // Skip validation in constructor to test validate method
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should handle frontmatter with additional properties", () => {
      const subagent = new CopilotSubagent({
        baseDir: testDir,
        relativeDirPath: ".github/subagents",
        relativeFilePath: "agent-with-extras.md",
        frontmatter: {
          name: "Agent",
          description: "Agent with extra properties",
          // Additional properties should be allowed but not validated
          extra: "property",
        } as any,
        body: "Body content",
        validate: false,
      });

      const result = subagent.validate();
      // The validation should pass as long as required fields are present
      expect(result.success).toBe(true);
    });
  });

  describe("SimulatedSubagentFrontmatterSchema", () => {
    it("should validate valid frontmatter with name and description", () => {
      const validFrontmatter = {
        name: "Test Agent",
        description: "Test description",
      };

      const result = SimulatedSubagentFrontmatterSchema.parse(validFrontmatter);
      expect(result).toEqual(validFrontmatter);
    });

    it("should throw error for frontmatter without name", () => {
      const invalidFrontmatter = {
        description: "Test description",
      };

      expect(() => SimulatedSubagentFrontmatterSchema.parse(invalidFrontmatter)).toThrow();
    });

    it("should throw error for frontmatter without description", () => {
      const invalidFrontmatter = {
        name: "Test Agent",
      };

      expect(() => SimulatedSubagentFrontmatterSchema.parse(invalidFrontmatter)).toThrow();
    });

    it("should throw error for frontmatter with invalid types", () => {
      const invalidFrontmatter = {
        name: 123, // Should be string
        description: "Test",
      };

      expect(() => SimulatedSubagentFrontmatterSchema.parse(invalidFrontmatter)).toThrow();
    });
  });

  describe("edge cases", () => {
    it("should handle empty body content", () => {
      const subagent = new CopilotSubagent({
        baseDir: testDir,
        relativeDirPath: ".github/subagents",
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

      const subagent = new CopilotSubagent({
        baseDir: testDir,
        relativeDirPath: ".github/subagents",
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

      const subagent = new CopilotSubagent({
        baseDir: testDir,
        relativeDirPath: ".github/subagents",
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
      const subagent = new CopilotSubagent({
        baseDir: testDir,
        relativeDirPath: ".github/subagents",
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

      const subagent = new CopilotSubagent({
        baseDir: testDir,
        relativeDirPath: ".github/subagents",
        relativeFilePath: "windows-lines.md",
        frontmatter: {
          name: "Windows Agent",
          description: "Windows line endings test",
        },
        body: windowsContent,
        validate: true,
      });

      expect(subagent.getBody()).toBe(windowsContent);
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should return true for rulesync subagent with wildcard target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["*"], name: "Test", description: "Test" },
        body: "Body",
      });

      const result = CopilotSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
      expect(result).toBe(true);
    });

    it("should return true for rulesync subagent with copilot target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["copilot"], name: "Test", description: "Test" },
        body: "Body",
      });

      const result = CopilotSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
      expect(result).toBe(true);
    });

    it("should return true for rulesync subagent with copilot and other targets", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot", "cline"],
          name: "Test",
          description: "Test",
        },
        body: "Body",
      });

      const result = CopilotSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
      expect(result).toBe(true);
    });

    it("should return false for rulesync subagent with different target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor"], name: "Test", description: "Test" },
        body: "Body",
      });

      const result = CopilotSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
      expect(result).toBe(false);
    });

    it("should return true for rulesync subagent with no targets specified", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test.md",
        frontmatter: { targets: undefined, name: "Test", description: "Test" } as any,
        body: "Body",
        validate: false,
      });

      const result = CopilotSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
      expect(result).toBe(true);
    });
  });

  describe("integration with base classes", () => {
    it("should properly inherit from SimulatedSubagent", () => {
      const subagent = new CopilotSubagent({
        baseDir: testDir,
        relativeDirPath: ".github/subagents",
        relativeFilePath: "test.md",
        frontmatter: {
          name: "Test",
          description: "Test",
        },
        body: "Body",
        validate: true,
      });

      // Check that it's an instance of parent classes
      expect(subagent).toBeInstanceOf(CopilotSubagent);
      expect(subagent.getRelativeDirPath()).toBe(".github/subagents");
      expect(subagent.getRelativeFilePath()).toBe("test.md");
    });

    it("should handle baseDir correctly", () => {
      const customBaseDir = "/custom/base/dir";
      const subagent = new CopilotSubagent({
        baseDir: customBaseDir,
        relativeDirPath: ".github/subagents",
        relativeFilePath: "test.md",
        frontmatter: {
          name: "Test",
          description: "Test",
        },
        body: "Body",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(CopilotSubagent);
    });
  });
});

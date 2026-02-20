import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { AgentsmdSubagent } from "./agentsmd-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { SimulatedSubagentFrontmatter } from "./simulated-subagent.js";

describe("AgentsmdSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validMarkdownContent = `---
name: Test Agentsmd Agent
description: Test agentsmd agent description
---

This is the body of the agentsmd agent.
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
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for agentsmd subagents", () => {
      const paths = AgentsmdSubagent.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: ".agents/subagents",
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid markdown content", () => {
      const subagent = new AgentsmdSubagent({
        baseDir: testDir,
        relativeDirPath: ".agents/subagents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Agentsmd Agent",
          description: "Test agentsmd agent description",
        },
        body: "This is the body of the agentsmd agent.\nIt can be multiline.",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(AgentsmdSubagent);
      expect(subagent.getBody()).toBe(
        "This is the body of the agentsmd agent.\nIt can be multiline.",
      );
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test Agentsmd Agent",
        description: "Test agentsmd agent description",
      });
    });

    it("should create instance with empty name and description", () => {
      const subagent = new AgentsmdSubagent({
        baseDir: testDir,
        relativeDirPath: ".agents/subagents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "",
          description: "",
        },
        body: "This is an agentsmd agent without name or description.",
        validate: true,
      });

      expect(subagent.getBody()).toBe("This is an agentsmd agent without name or description.");
      expect(subagent.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
    });

    it("should create instance without validation when validate is false", () => {
      const subagent = new AgentsmdSubagent({
        baseDir: testDir,
        relativeDirPath: ".agents/subagents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test body",
        validate: false,
      });

      expect(subagent).toBeInstanceOf(AgentsmdSubagent);
    });

    it("should throw error for invalid frontmatter when validation is enabled", () => {
      expect(
        () =>
          new AgentsmdSubagent({
            baseDir: testDir,
            relativeDirPath: ".agents/subagents",
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
      const subagent = new AgentsmdSubagent({
        baseDir: testDir,
        relativeDirPath: ".agents/subagents",
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
      const subagent = new AgentsmdSubagent({
        baseDir: testDir,
        relativeDirPath: ".agents/subagents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Agentsmd Agent",
          description: "Test agentsmd agent",
        },
        body: "Test body",
        validate: true,
      });

      const frontmatter = subagent.getFrontmatter();
      expect(frontmatter).toEqual({
        name: "Test Agentsmd Agent",
        description: "Test agentsmd agent",
      });
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should throw error as it is a simulated file", () => {
      const subagent = new AgentsmdSubagent({
        baseDir: testDir,
        relativeDirPath: ".agents/subagents",
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
    it("should create AgentsmdSubagent from RulesyncSubagent", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["agentsmd"],
          name: "Test Agent",
          description: "Test description from rulesync",
        },
        body: "Test agent content",
        validate: true,
      });

      const agentsmdSubagent = AgentsmdSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".agents/subagents",
        rulesyncSubagent,
        validate: true,
      }) as AgentsmdSubagent;

      expect(agentsmdSubagent).toBeInstanceOf(AgentsmdSubagent);
      expect(agentsmdSubagent.getBody()).toBe("Test agent content");
      expect(agentsmdSubagent.getFrontmatter()).toEqual({
        name: "Test Agent",
        description: "Test description from rulesync",
      });
      expect(agentsmdSubagent.getRelativeFilePath()).toBe("test-agent.md");
      expect(agentsmdSubagent.getRelativeDirPath()).toBe(".agents/subagents");
    });

    it("should handle RulesyncSubagent with different file extensions", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "complex-agent.txt",
        frontmatter: {
          targets: ["agentsmd"],
          name: "Complex Agent",
          description: "Complex agent",
        },
        body: "Complex content",
        validate: true,
      });

      const agentsmdSubagent = AgentsmdSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".agents/subagents",
        rulesyncSubagent,
        validate: true,
      }) as AgentsmdSubagent;

      expect(agentsmdSubagent.getRelativeFilePath()).toBe("complex-agent.txt");
    });

    it("should handle empty name and description", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["agentsmd"],
          name: "",
          description: "",
        },
        body: "Test content",
        validate: true,
      });

      const agentsmdSubagent = AgentsmdSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".agents/subagents",
        rulesyncSubagent,
        validate: true,
      }) as AgentsmdSubagent;

      expect(agentsmdSubagent.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
    });
  });

  describe("fromFile", () => {
    it("should load AgentsmdSubagent from file", async () => {
      const subagentsDir = join(testDir, ".agents", "subagents");
      const filePath = join(subagentsDir, "test-file-agent.md");

      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await AgentsmdSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-file-agent.md",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(AgentsmdSubagent);
      expect(subagent.getBody()).toBe(
        "This is the body of the agentsmd agent.\nIt can be multiline.",
      );
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test Agentsmd Agent",
        description: "Test agentsmd agent description",
      });
      expect(subagent.getRelativeFilePath()).toBe("test-file-agent.md");
    });

    it("should handle file path with subdirectories", async () => {
      const subagentsDir = join(testDir, ".agents", "subagents", "subdir");
      const filePath = join(subagentsDir, "nested-agent.md");

      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await AgentsmdSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "subdir/nested-agent.md",
        validate: true,
      });

      expect(subagent.getRelativeFilePath()).toBe("nested-agent.md");
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        AgentsmdSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "non-existent-agent.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should throw error when file contains invalid frontmatter", async () => {
      const subagentsDir = join(testDir, ".agents", "subagents");
      const filePath = join(subagentsDir, "invalid-agent.md");

      await writeFileContent(filePath, invalidMarkdownContent);

      await expect(
        AgentsmdSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "invalid-agent.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should handle file without frontmatter", async () => {
      const subagentsDir = join(testDir, ".agents", "subagents");
      const filePath = join(subagentsDir, "no-frontmatter.md");

      await writeFileContent(filePath, markdownWithoutFrontmatter);

      await expect(
        AgentsmdSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "no-frontmatter.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const subagent = new AgentsmdSubagent({
        baseDir: testDir,
        relativeDirPath: ".agents/subagents",
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
      const subagent = new AgentsmdSubagent({
        baseDir: testDir,
        relativeDirPath: ".agents/subagents",
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

  describe("edge cases", () => {
    it("should handle empty body content", () => {
      const subagent = new AgentsmdSubagent({
        baseDir: testDir,
        relativeDirPath: ".agents/subagents",
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

      const subagent = new AgentsmdSubagent({
        baseDir: testDir,
        relativeDirPath: ".agents/subagents",
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

      const subagent = new AgentsmdSubagent({
        baseDir: testDir,
        relativeDirPath: ".agents/subagents",
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
      const subagent = new AgentsmdSubagent({
        baseDir: testDir,
        relativeDirPath: ".agents/subagents",
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

      const subagent = new AgentsmdSubagent({
        baseDir: testDir,
        relativeDirPath: ".agents/subagents",
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
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["*"], name: "Test", description: "Test" },
        body: "Body",
      });

      const result = AgentsmdSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
      expect(result).toBe(true);
    });

    it("should return true for rulesync subagent with agentsmd target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["agentsmd"], name: "Test", description: "Test" },
        body: "Body",
      });

      const result = AgentsmdSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
      expect(result).toBe(true);
    });

    it("should return true for rulesync subagent with agentsmd and other targets", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "agentsmd", "cline"],
          name: "Test",
          description: "Test",
        },
        body: "Body",
      });

      const result = AgentsmdSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
      expect(result).toBe(true);
    });

    it("should return false for rulesync subagent with different target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor"], name: "Test", description: "Test" },
        body: "Body",
      });

      const result = AgentsmdSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
      expect(result).toBe(false);
    });

    it("should return true for rulesync subagent with no targets specified", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: undefined, name: "Test", description: "Test" } as any,
        body: "Body",
        validate: false,
      });

      const result = AgentsmdSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
      expect(result).toBe(true);
    });
  });

  describe("integration with base classes", () => {
    it("should properly inherit from SimulatedSubagent", () => {
      const subagent = new AgentsmdSubagent({
        baseDir: testDir,
        relativeDirPath: ".agents/subagents",
        relativeFilePath: "test.md",
        frontmatter: {
          name: "Test",
          description: "Test",
        },
        body: "Body",
        validate: true,
      });

      // Check that it's an instance of parent classes
      expect(subagent).toBeInstanceOf(AgentsmdSubagent);
      expect(subagent.getRelativeDirPath()).toBe(".agents/subagents");
      expect(subagent.getRelativeFilePath()).toBe("test.md");
    });

    it("should handle baseDir correctly", () => {
      const customBaseDir = "/custom/base/dir";
      const subagent = new AgentsmdSubagent({
        baseDir: customBaseDir,
        relativeDirPath: ".agents/subagents",
        relativeFilePath: "test.md",
        frontmatter: {
          name: "Test",
          description: "Test",
        },
        body: "Body",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(AgentsmdSubagent);
    });
  });
});

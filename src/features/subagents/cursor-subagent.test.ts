import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { CursorSubagent } from "./cursor-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import {
  SimulatedSubagentFrontmatter,
  SimulatedSubagentFrontmatterSchema,
} from "./simulated-subagent.js";

describe("CursorSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validMarkdownContent = `---
name: Test Cursor Agent
description: Test cursor agent description
---

This is the body of the cursor agent.
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
    it("should return correct paths for cursor subagents", () => {
      const paths = CursorSubagent.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: ".cursor/agents",
      });
    });

    it("should return correct paths for global mode", () => {
      const paths = CursorSubagent.getSettablePaths({ global: true });
      expect(paths).toEqual({
        relativeDirPath: ".cursor/agents",
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid markdown content", () => {
      const frontmatter = {
        name: "Test Cursor Agent",
        description: "Test cursor agent description",
      };
      const body = "This is the body of the cursor agent.\nIt can be multiline.";
      const subagent = new CursorSubagent({
        baseDir: testDir,
        relativeDirPath: ".cursor/agents",
        relativeFilePath: "test-agent.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
        validate: true,
      });

      expect(subagent).toBeInstanceOf(CursorSubagent);
      expect(subagent.getBody()).toBe(
        "This is the body of the cursor agent.\nIt can be multiline.",
      );
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test Cursor Agent",
        description: "Test cursor agent description",
      });
    });

    it("should create instance with empty name and description", () => {
      const frontmatter = {
        name: "",
        description: "",
      };
      const body = "This is a cursor agent without name or description.";
      const subagent = new CursorSubagent({
        baseDir: testDir,
        relativeDirPath: ".cursor/agents",
        relativeFilePath: "test-agent.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
        validate: true,
      });

      expect(subagent.getBody()).toBe("This is a cursor agent without name or description.");
      expect(subagent.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
    });

    it("should create instance without validation when validate is false", () => {
      const frontmatter = {
        name: "Test Agent",
        description: "Test description",
      };
      const body = "Test body";
      const subagent = new CursorSubagent({
        baseDir: testDir,
        relativeDirPath: ".cursor/agents",
        relativeFilePath: "test-agent.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
        validate: false,
      });

      expect(subagent).toBeInstanceOf(CursorSubagent);
    });

    it("should throw error for invalid frontmatter when validation is enabled", () => {
      const frontmatter = {
        // Missing required fields
      } as SimulatedSubagentFrontmatter;
      const body = "Body content";
      expect(
        () =>
          new CursorSubagent({
            baseDir: testDir,
            relativeDirPath: ".cursor/agents",
            relativeFilePath: "invalid-agent.md",
            frontmatter,
            body,
            fileContent: stringifyFrontmatter(body, frontmatter),
            validate: true,
          }),
      ).toThrow();
    });
  });

  describe("getBody", () => {
    it("should return the body content", () => {
      const frontmatter = {
        name: "Test Agent",
        description: "Test description",
      };
      const body = "This is the body content.\nWith multiple lines.";
      const subagent = new CursorSubagent({
        baseDir: testDir,
        relativeDirPath: ".cursor/agents",
        relativeFilePath: "test-agent.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
        validate: true,
      });

      expect(subagent.getBody()).toBe("This is the body content.\nWith multiple lines.");
    });
  });

  describe("getFrontmatter", () => {
    it("should return frontmatter with name and description", () => {
      const frontmatter = {
        name: "Test Cursor Agent",
        description: "Test cursor agent",
      };
      const body = "Test body";
      const subagent = new CursorSubagent({
        baseDir: testDir,
        relativeDirPath: ".cursor/agents",
        relativeFilePath: "test-agent.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
        validate: true,
      });

      const result = subagent.getFrontmatter();
      expect(result).toEqual({
        name: "Test Cursor Agent",
        description: "Test cursor agent",
      });
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should convert CursorSubagent to RulesyncSubagent", () => {
      const subagent = new CursorSubagent({
        baseDir: testDir,
        relativeDirPath: ".cursor/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test body",
        fileContent: "---\nname: Test Agent\ndescription: Test description\n---\n\nTest body",
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
    it("should create CursorSubagent from RulesyncSubagent", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["cursor"],
          name: "Test Agent",
          description: "Test description from rulesync",
        },
        body: "Test agent content",
        validate: true,
      });

      const cursorSubagent = CursorSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".cursor/agents",
        rulesyncSubagent,
        validate: true,
      }) as CursorSubagent;

      expect(cursorSubagent).toBeInstanceOf(CursorSubagent);
      expect(cursorSubagent.getBody()).toBe("Test agent content");
      expect(cursorSubagent.getFrontmatter()).toEqual({
        name: "Test Agent",
        description: "Test description from rulesync",
      });
      expect(cursorSubagent.getRelativeFilePath()).toBe("test-agent.md");
      expect(cursorSubagent.getRelativeDirPath()).toBe(".cursor/agents");
    });

    it("should handle RulesyncSubagent with different file extensions", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "complex-agent.txt",
        frontmatter: {
          targets: ["cursor"],
          name: "Complex Agent",
          description: "Complex agent",
        },
        body: "Complex content",
        validate: true,
      });

      const cursorSubagent = CursorSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".cursor/agents",
        rulesyncSubagent,
        validate: true,
      }) as CursorSubagent;

      expect(cursorSubagent.getRelativeFilePath()).toBe("complex-agent.txt");
    });

    it("should handle empty name and description", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["cursor"],
          name: "",
          description: "",
        },
        body: "Test content",
        validate: true,
      });

      const cursorSubagent = CursorSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".cursor/agents",
        rulesyncSubagent,
        validate: true,
      }) as CursorSubagent;

      expect(cursorSubagent.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
    });
  });

  describe("fromFile", () => {
    it("should load CursorSubagent from file", async () => {
      const subagentsDir = join(testDir, ".cursor", "agents");
      const filePath = join(subagentsDir, "test-file-agent.md");

      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await CursorSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-file-agent.md",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(CursorSubagent);
      expect(subagent.getBody()).toBe(
        "This is the body of the cursor agent.\nIt can be multiline.",
      );
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test Cursor Agent",
        description: "Test cursor agent description",
      });
      expect(subagent.getRelativeFilePath()).toBe("test-file-agent.md");
    });

    it("should handle file path with subdirectories", async () => {
      const subagentsDir = join(testDir, ".cursor", "agents", "subdir");
      const filePath = join(subagentsDir, "nested-agent.md");

      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await CursorSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "subdir/nested-agent.md",
        validate: true,
      });

      expect(subagent.getRelativeFilePath()).toBe("subdir/nested-agent.md");
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        CursorSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "non-existent-agent.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should throw error when file contains invalid frontmatter", async () => {
      const subagentsDir = join(testDir, ".cursor", "agents");
      const filePath = join(subagentsDir, "invalid-agent.md");

      await writeFileContent(filePath, invalidMarkdownContent);

      await expect(
        CursorSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "invalid-agent.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should handle file without frontmatter", async () => {
      const subagentsDir = join(testDir, ".cursor", "agents");
      const filePath = join(subagentsDir, "no-frontmatter.md");

      await writeFileContent(filePath, markdownWithoutFrontmatter);

      await expect(
        CursorSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "no-frontmatter.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const frontmatter = {
        name: "Valid Agent",
        description: "Valid description",
      };
      const body = "Valid body";
      const subagent = new CursorSubagent({
        baseDir: testDir,
        relativeDirPath: ".cursor/agents",
        relativeFilePath: "valid-agent.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
        validate: false, // Skip validation in constructor to test validate method
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should handle frontmatter with additional properties", () => {
      const frontmatter = {
        name: "Agent",
        description: "Agent with extra properties",
        // Additional properties should be allowed but not validated
        extra: "property",
      } as any;
      const body = "Body content";
      const subagent = new CursorSubagent({
        baseDir: testDir,
        relativeDirPath: ".cursor/agents",
        relativeFilePath: "agent-with-extras.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
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
      const frontmatter = {
        name: "Empty Body Agent",
        description: "Agent with empty body",
      };
      const body = "";
      const subagent = new CursorSubagent({
        baseDir: testDir,
        relativeDirPath: ".cursor/agents",
        relativeFilePath: "empty-body.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
        validate: true,
      });

      expect(subagent.getBody()).toBe("");
      expect(subagent.getFrontmatter()).toEqual({
        name: "Empty Body Agent",
        description: "Agent with empty body",
      });
    });

    it("should handle special characters in content", () => {
      const frontmatter = {
        name: "Special Agent",
        description: "Special characters test",
      };
      const body = "Special characters: @#$%^&*()\nUnicode: 你好世界 🌍\nQuotes: \"Hello 'World'\"";
      const subagent = new CursorSubagent({
        baseDir: testDir,
        relativeDirPath: ".cursor/agents",
        relativeFilePath: "special-char.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
        validate: true,
      });

      expect(subagent.getBody()).toBe(body);
      expect(subagent.getBody()).toContain("@#$%^&*()");
      expect(subagent.getBody()).toContain("你好世界 🌍");
      expect(subagent.getBody()).toContain("\"Hello 'World'\"");
    });

    it("should handle very long content", () => {
      const frontmatter = {
        name: "Long Agent",
        description: "Long content test",
      };
      const body = "A".repeat(10000);
      const subagent = new CursorSubagent({
        baseDir: testDir,
        relativeDirPath: ".cursor/agents",
        relativeFilePath: "long-content.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
        validate: true,
      });

      expect(subagent.getBody()).toBe(body);
      expect(subagent.getBody().length).toBe(10000);
    });

    it("should handle multi-line name and description", () => {
      const frontmatter = {
        name: "Multi-line\nAgent Name",
        description: "This is a multi-line\ndescription with\nmultiple lines",
      };
      const body = "Test body";
      const subagent = new CursorSubagent({
        baseDir: testDir,
        relativeDirPath: ".cursor/agents",
        relativeFilePath: "multiline-fields.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
        validate: true,
      });

      expect(subagent.getFrontmatter()).toEqual({
        name: "Multi-line\nAgent Name",
        description: "This is a multi-line\ndescription with\nmultiple lines",
      });
    });

    it("should handle Windows-style line endings", () => {
      const frontmatter = {
        name: "Windows Agent",
        description: "Test with Windows line endings",
      };
      const body = "Line 1\r\nLine 2\r\nLine 3";
      const subagent = new CursorSubagent({
        baseDir: testDir,
        relativeDirPath: ".cursor/agents",
        relativeFilePath: "windows-lines.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
        validate: true,
      });

      expect(subagent.getBody()).toBe(body);
    });
  });

  describe("inheritance", () => {
    it("should inherit from ToolSubagent", () => {
      const subagent = new CursorSubagent({
        baseDir: testDir,
        relativeDirPath: ".cursor/agents",
        relativeFilePath: "test.md",
        frontmatter: {
          name: "Test",
          description: "Test",
        },
        body: "Test",
        fileContent: "---\nname: Test\ndescription: Test\n---\n\nTest",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(CursorSubagent);
      // Test that it can convert to RulesyncSubagent (native support)
      const rulesyncSubagent = subagent.toRulesyncSubagent();
      expect(rulesyncSubagent).toBeInstanceOf(RulesyncSubagent);
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should return true when targets includes cursor", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["cursor"],
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test content",
        validate: true,
      });

      expect(CursorSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
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

      expect(CursorSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
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
        validate: false, // Skip validation to allow empty targets array
      });

      expect(CursorSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(false);
    });

    it("should return false when targets does not include cursor", () => {
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

      expect(CursorSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(false);
    });

    it("should return true when targets includes cursor among other targets", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["copilot", "cursor", "cline"],
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test content",
        validate: true,
      });

      expect(CursorSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });
  });
});

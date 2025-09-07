import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import {
  SimulatedSubagent,
  SimulatedSubagentFrontmatter,
  SimulatedSubagentFrontmatterSchema,
} from "./simulated-subagent.js";

// Create a concrete test implementation of SimulatedSubagent
class TestSimulatedSubagent extends SimulatedSubagent {
  static getSettablePaths() {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "TEST_AGENT.md",
      },
      nonRoot: {
        relativeDirPath: ".test/agents",
      },
    };
  }

  static async fromFile(params: any) {
    const baseParams = await this.fromFileDefault(params);
    return new TestSimulatedSubagent(baseParams);
  }

  static fromRulesyncSubagent(params: any) {
    const baseParams = this.fromRulesyncSubagentDefault(params);
    return new TestSimulatedSubagent(baseParams);
  }
}

describe("SimulatedSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validMarkdownContent = `---
name: Test Agent
description: Test agent description
---

This is the body of the simulated agent.
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

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const subagent = new TestSimulatedSubagent({
        baseDir: testDir,
        relativeDirPath: ".test/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Agent",
          description: "Test agent description",
        },
        body: "This is the body of the simulated agent.\nIt can be multiline.",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(TestSimulatedSubagent);
      expect(subagent.getBody()).toBe(
        "This is the body of the simulated agent.\nIt can be multiline.",
      );
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test Agent",
        description: "Test agent description",
      });
    });

    it("should create instance with empty name and description", () => {
      const subagent = new TestSimulatedSubagent({
        baseDir: testDir,
        relativeDirPath: ".test/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "",
          description: "",
        },
        body: "This is a simulated agent without name or description.",
        validate: true,
      });

      expect(subagent.getBody()).toBe("This is a simulated agent without name or description.");
      expect(subagent.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
    });

    it("should create instance without validation when validate is false", () => {
      const subagent = new TestSimulatedSubagent({
        baseDir: testDir,
        relativeDirPath: ".test/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test body",
        validate: false,
      });

      expect(subagent.getBody()).toBe("Test body");
    });

    it("should throw error for invalid frontmatter when validation is enabled", () => {
      expect(() => {
        new TestSimulatedSubagent({
          baseDir: testDir,
          relativeDirPath: ".test/agents",
          relativeFilePath: "test-agent.md",
          frontmatter: {
            // Missing required fields
            invalid: true,
          } as any,
          body: "Test body",
          validate: true,
        });
      }).toThrow();
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should throw error because SimulatedSubagent is simulated", () => {
      const subagent = new TestSimulatedSubagent({
        baseDir: testDir,
        relativeDirPath: ".test/agents",
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

  describe("fromFile", () => {
    it("should create instance from valid markdown file", async () => {
      const filePath = join(testDir, ".test/agents", "test-agent.md");
      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await TestSimulatedSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-agent.md",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(TestSimulatedSubagent);
      expect(subagent.getBody()).toBe(
        "This is the body of the simulated agent.\nIt can be multiline.",
      );
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test Agent",
        description: "Test agent description",
      });
    });

    it("should throw error for invalid markdown file", async () => {
      const filePath = join(testDir, ".test/agents", "invalid-agent.md");
      await writeFileContent(filePath, invalidMarkdownContent);

      await expect(
        TestSimulatedSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "invalid-agent.md",
          validate: true,
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });

    it("should throw error for file without frontmatter", async () => {
      const filePath = join(testDir, ".test/agents", "no-frontmatter.md");
      await writeFileContent(filePath, markdownWithoutFrontmatter);

      await expect(
        TestSimulatedSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "no-frontmatter.md",
          validate: true,
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should create instance from RulesyncSubagent", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["claudecode"],
          name: "Test Agent",
          description: "Test agent description",
        },
        body: "Test body content",
        fileContent: `---
targets:
  - claudecode
name: Test Agent
description: Test agent description
---

Test body content`,
        validate: true,
      });

      const simulatedSubagent = TestSimulatedSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".test/agents",
        rulesyncSubagent,
        validate: true,
      });

      expect(simulatedSubagent).toBeInstanceOf(TestSimulatedSubagent);
      expect(simulatedSubagent.getBody()).toBe("Test body content");
      expect(simulatedSubagent.getFrontmatter()).toEqual({
        name: "Test Agent",
        description: "Test agent description",
      });
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const subagent = new TestSimulatedSubagent({
        baseDir: testDir,
        relativeDirPath: ".test/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test body",
        validate: false,
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter", () => {
      const subagent = new TestSimulatedSubagent({
        baseDir: testDir,
        relativeDirPath: ".test/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          // Missing required fields
          invalid: true,
        } as any,
        body: "Test body",
        validate: false,
      });

      const result = subagent.validate();
      expect(result.success).toBe(false);
      expect(result.error).not.toBeNull();
    });
  });

  describe("SimulatedSubagentFrontmatterSchema", () => {
    it("should validate correct frontmatter", () => {
      const validFrontmatter: SimulatedSubagentFrontmatter = {
        name: "Test Agent",
        description: "Test description",
      };

      const result = SimulatedSubagentFrontmatterSchema.safeParse(validFrontmatter);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validFrontmatter);
      }
    });

    it("should reject frontmatter without name", () => {
      const invalidFrontmatter = {
        description: "Test description",
      };

      const result = SimulatedSubagentFrontmatterSchema.safeParse(invalidFrontmatter);
      expect(result.success).toBe(false);
    });

    it("should reject frontmatter without description", () => {
      const invalidFrontmatter = {
        name: "Test Agent",
      };

      const result = SimulatedSubagentFrontmatterSchema.safeParse(invalidFrontmatter);
      expect(result.success).toBe(false);
    });
  });
});

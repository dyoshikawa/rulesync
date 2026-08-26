import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
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
      relativeDirPath: ".test/agents",
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
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const subagent = new TestSimulatedSubagent({
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
          outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
          outputRoot: testDir,
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
          outputRoot: testDir,
          relativeFilePath: "no-frontmatter.md",
          validate: true,
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should create instance from RulesyncSubagent", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["claudecode"],
          name: "Test Agent",
          description: "Test agent description",
        },
        body: "Test body content",
        validate: true,
      });

      const simulatedSubagent = TestSimulatedSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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

  describe("shared output path", () => {
    it("should keep the pre-rendered fileContent instead of re-rendering the frontmatter", () => {
      // A simulated writer that shares its path with a native target has to
      // match that target's serialization byte for byte, so `fileContent` wins
      // over the plain frontmatter rendering.
      const preRendered = "---\nname: Test Agent\ntools: []\n---\n\nShared bytes.\n";

      const subagent = new TestSimulatedSubagent({
        outputRoot: testDir,
        relativeDirPath: ".test/agents",
        relativeFilePath: "test.md",
        frontmatter: { name: "Test Agent", description: "Test agent description" },
        body: "Shared bytes.",
        fileContent: preRendered,
      });

      expect(subagent.getFileContent()).toBe(preRendered);
    });

    it("should preserve frontmatter keys a native target owns", () => {
      // `looseObject`, not `object`: parsing a file read from a shared path must
      // not drop the keys the native writer of that path owns.
      const result = SimulatedSubagentFrontmatterSchema.safeParse({
        name: "Test Agent",
        description: "Test agent description",
        tools: ["read"],
        commandExecutionPolicy: "sandbox",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          name: "Test Agent",
          description: "Test agent description",
          tools: ["read"],
          commandExecutionPolicy: "sandbox",
        });
      }
    });

    it("should carry the bytes on disk through fromFile rather than re-rendering them", async () => {
      // The file may have been written by the native target that owns this
      // path; reading it back must not silently reshape it.
      const nativeContent = `---
name: Test Agent
description: Test agent description
tools:
  - read
---

Native body.
`;
      await writeFileContent(join(testDir, ".test/agents/native.md"), nativeContent);

      const subagent = await TestSimulatedSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "native.md",
      });

      expect(subagent.getFileContent()).toBe(nativeContent);
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test Agent",
        description: "Test agent description",
        tools: ["read"],
      });
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

    it("should accept frontmatter without description (description is optional)", () => {
      const frontmatter = {
        name: "Test Agent",
      };

      const result = SimulatedSubagentFrontmatterSchema.safeParse(frontmatter);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Test Agent");
        expect(result.data.description).toBeUndefined();
      }
    });
  });
});

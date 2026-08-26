import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { AgentsmdSubagent } from "./agentsmd-subagent.js";
import { AntigravityCliSubagent } from "./antigravity-cli-subagent.js";
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
        relativeDirPath: ".agents/agents",
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid markdown content", () => {
      const subagent = new AgentsmdSubagent({
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
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
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
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
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
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
            outputRoot: testDir,
            relativeDirPath: ".agents/agents",
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
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
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
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
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
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
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
        outputRoot: testDir,
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
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
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
      expect(agentsmdSubagent.getRelativeDirPath()).toBe(".agents/agents");
    });

    it("should handle RulesyncSubagent with different file extensions", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
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
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
        rulesyncSubagent,
        validate: true,
      }) as AgentsmdSubagent;

      expect(agentsmdSubagent.getRelativeFilePath()).toBe("complex-agent.txt");
    });

    it("should fill in the description Antigravity requires when it is empty", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
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
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
        rulesyncSubagent,
        validate: true,
      }) as AgentsmdSubagent;

      // `.agents/agents/` is shared with the native Antigravity targets, which
      // refuse to load an agent without a description, so the same generated
      // fallback applies here.
      expect(agentsmdSubagent.getFrontmatter()).toEqual({
        name: "",
        description: " subagent",
      });
    });

    it("should emit the same file the native Antigravity target writes to the shared path", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "shared-agent.md",
        frontmatter: {
          targets: ["*"],
          name: "shared-agent",
          description: "Shared agent description",
          "antigravity-ide": { model: "flash" },
          "antigravity-cli": { tools: ["read"], commandExecutionPolicy: "sandbox" },
        },
        body: "Shared agent body.",
        validate: true,
      });

      const agentsmdSubagent = AgentsmdSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
        rulesyncSubagent,
        validate: true,
      });
      const antigravitySubagent = AntigravityCliSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
        rulesyncSubagent,
        validate: true,
      });

      // Both targets write `.agents/agents/shared-agent.md`, so whichever runs
      // last the file on disk has to be the same.
      expect(agentsmdSubagent.getRelativeDirPath()).toBe(antigravitySubagent.getRelativeDirPath());
      expect(agentsmdSubagent.getFileContent()).toBe(antigravitySubagent.getFileContent());
      expect(agentsmdSubagent.getFileContent()).toContain("model: flash");
      expect(agentsmdSubagent.getFileContent()).toContain("commandExecutionPolicy: sandbox");
    });

    it("should emit plain name/description frontmatter when no Antigravity section is authored", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "plain-agent.md",
        frontmatter: {
          targets: ["agentsmd"],
          name: "plain-agent",
          description: "Plain agent description",
        },
        body: "Plain agent body.",
        validate: true,
      });

      const agentsmdSubagent = AgentsmdSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
        rulesyncSubagent,
        validate: true,
      });

      expect(agentsmdSubagent.getFileContent()).toBe(
        [
          "---",
          "name: plain-agent",
          "description: Plain agent description",
          "---",
          "Plain agent body.",
          "",
        ].join("\n"),
      );
    });

    it("should read the shared Antigravity sections even for an agentsmd-only subagent", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "scoped-agent.md",
        frontmatter: {
          targets: ["agentsmd"],
          name: "scoped-agent",
          description: "Scoped agent description",
          "antigravity-cli": { model: "pro" },
        },
        body: "Scoped agent body.",
        validate: true,
      });

      const agentsmdSubagent = AgentsmdSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
        rulesyncSubagent,
        validate: true,
      });

      // The file is shared, so the block belongs to the path rather than to the
      // target list the canonical subagent happens to name.
      expect(agentsmdSubagent.getFileContent()).toContain("model: pro");
    });

    it("should reject an invalid Antigravity block instead of writing a reduced file", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "broken-agent.md",
        frontmatter: {
          targets: ["agentsmd"],
          name: "broken-agent",
          description: "Broken agent description",
          "antigravity-cli": { tools: "not-an-array" },
        },
        body: "Broken agent body.",
        validate: true,
      });

      // Same file, same diagnostics: dropping the block and writing a plain file
      // would silently degrade the file the native targets own.
      expect(() =>
        AgentsmdSubagent.fromRulesyncSubagent({
          outputRoot: testDir,
          relativeDirPath: ".agents/agents",
          rulesyncSubagent,
          validate: true,
        }),
      ).toThrow("Invalid agentsmd subagent frontmatter");
    });
  });

  describe("fromFile", () => {
    it("should preserve the bytes a native writer of the shared path produced", async () => {
      const nativeContent = [
        "---",
        "name: native-agent",
        "description: Written by an Antigravity target",
        "model: pro",
        "commandExecutionPolicy: sandbox",
        "---",
        "",
        "Native agent body.",
        "",
      ].join("\n");
      await writeFileContent(join(testDir, ".agents", "agents", "native-agent.md"), nativeContent);

      const subagent = await AgentsmdSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "native-agent.md",
        validate: true,
      });

      expect(subagent.getFileContent()).toBe(nativeContent);
      expect(subagent.getFrontmatter()).toMatchObject({
        name: "native-agent",
        model: "pro",
        commandExecutionPolicy: "sandbox",
      });
    });

    it("should load AgentsmdSubagent from file", async () => {
      const subagentsDir = join(testDir, ".agents", "agents");
      const filePath = join(subagentsDir, "test-file-agent.md");

      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await AgentsmdSubagent.fromFile({
        outputRoot: testDir,
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
      const subagentsDir = join(testDir, ".agents", "agents", "subdir");
      const filePath = join(subagentsDir, "nested-agent.md");

      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await AgentsmdSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "subdir/nested-agent.md",
        validate: true,
      });

      expect(subagent.getRelativeFilePath()).toBe("nested-agent.md");
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        AgentsmdSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "non-existent-agent.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should throw error when file contains invalid frontmatter", async () => {
      const subagentsDir = join(testDir, ".agents", "agents");
      const filePath = join(subagentsDir, "invalid-agent.md");

      await writeFileContent(filePath, invalidMarkdownContent);

      await expect(
        AgentsmdSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "invalid-agent.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should handle file without frontmatter", async () => {
      const subagentsDir = join(testDir, ".agents", "agents");
      const filePath = join(subagentsDir, "no-frontmatter.md");

      await writeFileContent(filePath, markdownWithoutFrontmatter);

      await expect(
        AgentsmdSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "no-frontmatter.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const subagent = new AgentsmdSubagent({
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
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
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
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
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
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
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
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
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
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
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
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
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
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
        outputRoot: testDir,
        relativeDirPath: ".agents/agents",
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
      expect(subagent.getRelativeDirPath()).toBe(".agents/agents");
      expect(subagent.getRelativeFilePath()).toBe("test.md");
    });

    it("should handle outputRoot correctly", () => {
      const customOutputRoot = "/custom/base/dir";
      const subagent = new AgentsmdSubagent({
        outputRoot: customOutputRoot,
        relativeDirPath: ".agents/agents",
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

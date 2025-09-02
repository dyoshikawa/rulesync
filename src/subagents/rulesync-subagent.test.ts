import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import {
  RulesyncSubagent,
  type RulesyncSubagentFrontmatter,
  RulesyncSubagentFrontmatterSchema,
  RulesyncSubagentModelSchema,
} from "./rulesync-subagent.js";

describe("RulesyncSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("schemas", () => {
    describe("RulesyncSubagentModelSchema", () => {
      it("should validate valid model types", () => {
        const validModels = ["opus", "sonnet", "haiku", "inherit"];

        for (const model of validModels) {
          const result = RulesyncSubagentModelSchema.parse(model);
          expect(result).toBe(model);
        }
      });

      it("should reject invalid model types", () => {
        const invalidModels = ["gpt-4", "claude", "", null, undefined, 123];

        for (const model of invalidModels) {
          expect(() => RulesyncSubagentModelSchema.parse(model)).toThrow();
        }
      });
    });

    describe("RulesyncSubagentFrontmatterSchema", () => {
      it("should validate complete frontmatter", () => {
        const frontmatter = {
          targets: ["cursor", "claudecode"],
          name: "Test Subagent",
          description: "A test subagent for testing",
          claudecode: {
            model: "sonnet",
          },
        };

        const result = RulesyncSubagentFrontmatterSchema.parse(frontmatter);
        expect(result).toEqual(frontmatter);
      });

      it("should validate minimal frontmatter", () => {
        const frontmatter = {
          targets: ["*"],
          name: "Minimal Subagent",
          description: "Minimal description",
        };

        const result = RulesyncSubagentFrontmatterSchema.parse(frontmatter);
        expect(result).toEqual(frontmatter);
      });

      it("should reject missing required fields", () => {
        const invalidFrontmatters = [
          { targets: ["cursor"], name: "Test" }, // missing description
          { targets: ["cursor"], description: "Test" }, // missing name
          { name: "Test", description: "Test" }, // missing targets
          {}, // missing all required fields
        ];

        for (const frontmatter of invalidFrontmatters) {
          expect(() => RulesyncSubagentFrontmatterSchema.parse(frontmatter)).toThrow();
        }
      });

      it("should validate different target combinations", () => {
        const frontmatters = [
          {
            targets: ["*"],
            name: "All Tools",
            description: "For all tools",
          },
          {
            targets: ["cursor", "claudecode", "copilot"],
            name: "Multi Tools",
            description: "For multiple tools",
          },
          {
            targets: ["claudecode"],
            name: "Single Tool",
            description: "For single tool",
          },
        ];

        for (const frontmatter of frontmatters) {
          expect(() => RulesyncSubagentFrontmatterSchema.parse(frontmatter)).not.toThrow();
        }
      });

      it("should validate claudecode model configurations", () => {
        const modelsToTest = ["opus", "sonnet", "haiku", "inherit"];

        for (const model of modelsToTest) {
          const frontmatter = {
            targets: ["claudecode"],
            name: "Model Test",
            description: "Testing models",
            claudecode: { model },
          };

          const result = RulesyncSubagentFrontmatterSchema.parse(frontmatter);
          expect(result.claudecode?.model).toBe(model);
        }
      });
    });
  });

  describe("constructor", () => {
    it("should create subagent with valid frontmatter", () => {
      const frontmatter: RulesyncSubagentFrontmatter = {
        targets: ["cursor"],
        name: "Test Agent",
        description: "A test agent",
      };

      const subagent = new RulesyncSubagent({
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test.md",
        fileContent: "# Test\nBody content",
        frontmatter,
        body: "Body content",
      });

      expect(subagent.getFrontmatter()).toEqual(frontmatter);
      expect(subagent.getBody()).toBe("Body content");
      expect(subagent.getFileContent()).toBe("# Test\nBody content");
    });

    it("should validate frontmatter during construction", () => {
      const invalidFrontmatter = {
        targets: ["invalid-target"],
        name: "Test",
        description: "Test",
      };

      expect(() => {
        const _instance = new RulesyncSubagent({
          relativeDirPath: ".rulesync/subagents",
          relativeFilePath: "test.md",
          fileContent: "test",
          frontmatter: invalidFrontmatter as any,
          body: "body",
        });
      }).toThrow();
    });

    it("should skip frontmatter validation when validate=false", () => {
      const invalidFrontmatter = {
        targets: ["invalid-target"],
        name: "Test",
        description: "Test",
      };

      expect(() => {
        const _instance = new RulesyncSubagent({
          relativeDirPath: ".rulesync/subagents",
          relativeFilePath: "test.md",
          fileContent: "test",
          frontmatter: invalidFrontmatter as any,
          body: "body",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("getter methods", () => {
    let subagent: RulesyncSubagent;
    let frontmatter: RulesyncSubagentFrontmatter;

    beforeEach(() => {
      frontmatter = {
        targets: ["cursor", "claudecode"],
        name: "Code Helper",
        description: "Helps with coding tasks",
        claudecode: { model: "sonnet" },
      };

      subagent = new RulesyncSubagent({
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "helper.md",
        fileContent: "original file content",
        frontmatter,
        body: "Helper body content",
      });
    });

    it("should return frontmatter", () => {
      expect(subagent.getFrontmatter()).toEqual(frontmatter);
    });

    it("should return body", () => {
      expect(subagent.getBody()).toBe("Helper body content");
    });

    it("should return reference to frontmatter object", () => {
      const returnedFrontmatter = subagent.getFrontmatter();
      expect(returnedFrontmatter).toBe(frontmatter);
      expect(returnedFrontmatter.name).toBe("Code Helper");
    });
  });

  describe("validate", () => {
    it("should validate correct frontmatter", () => {
      const subagent = new RulesyncSubagent({
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test.md",
        fileContent: "test",
        frontmatter: {
          targets: ["cursor"],
          name: "Valid Agent",
          description: "Valid description",
        },
        body: "body",
        validate: false, // Skip constructor validation to test validate method directly
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return validation error for invalid frontmatter", () => {
      const subagent = new RulesyncSubagent({
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test.md",
        fileContent: "test",
        frontmatter: {
          targets: ["invalid-target"],
          name: "Test",
          description: "Test",
        } as any,
        body: "body",
        validate: false,
      });

      const result = subagent.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should handle undefined frontmatter gracefully", () => {
      // Create instance bypassing normal construction validation
      const subagent = Object.create(RulesyncSubagent.prototype);
      Object.assign(subagent, {
        frontmatter: undefined,
        body: "test body",
        fileContent: "test content",
        relativeDirPath: ".",
        relativeFilePath: "test.md",
        baseDir: ".",
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("fromFilePath", () => {
    it("should create subagent from file with valid frontmatter", async () => {
      const content = `---
targets: ["cursor", "claudecode"]
name: "File Agent"
description: "Created from file"
claudecode:
  model: "opus"
---

# File Agent

This agent was loaded from a file.`;

      const filePath = join(testDir, "file-agent.md");
      await writeFileContent(filePath, content);

      const subagent = await RulesyncSubagent.fromFilePath({ filePath });

      expect(subagent).toBeInstanceOf(RulesyncSubagent);
      expect(subagent.getFrontmatter()).toEqual({
        targets: ["cursor", "claudecode"],
        name: "File Agent",
        description: "Created from file",
        claudecode: { model: "opus" },
      });
      expect(subagent.getBody()).toBe("# File Agent\n\nThis agent was loaded from a file.");
      expect(subagent.getRelativeFilePath()).toBe("file-agent.md");
    });

    it("should throw error for invalid frontmatter", async () => {
      const content = `---
targets: ["invalid-target"]
name: "Invalid Agent"
description: "Has invalid target"
---

Body content`;

      const filePath = join(testDir, "invalid-agent.md");
      await writeFileContent(filePath, content);

      await expect(RulesyncSubagent.fromFilePath({ filePath })).rejects.toThrow(
        /Invalid frontmatter/,
      );
    });

    it("should handle file without frontmatter", async () => {
      const content = "Just body content without frontmatter";
      const filePath = join(testDir, "no-frontmatter.md");
      await writeFileContent(filePath, content);

      await expect(RulesyncSubagent.fromFilePath({ filePath })).rejects.toThrow();
    });

    it("should trim body content", async () => {
      const content = `---
targets: ["cursor"]
name: "Trim Test"
description: "Testing trimming"
---

   Body with whitespace   
`;

      const filePath = join(testDir, "trim-test.md");
      await writeFileContent(filePath, content);

      const subagent = await RulesyncSubagent.fromFilePath({ filePath });
      expect(subagent.getBody()).toBe("Body with whitespace");
    });

    it("should use correct file path components", async () => {
      const content = `---
targets: ["cursor"]
name: "Path Test"
description: "Testing paths"
---

Body content`;

      const subDir = join(testDir, "subdirectory");
      await ensureDir(subDir);
      const filePath = join(subDir, "path-test.md");
      await writeFileContent(filePath, content);

      const subagent = await RulesyncSubagent.fromFilePath({ filePath });

      expect(subagent.getRelativeDirPath()).toBe(".rulesync/subagents");
      expect(subagent.getRelativeFilePath()).toBe("path-test.md");
    });
  });

  describe("complex frontmatter scenarios", () => {
    it("should handle all model types", () => {
      const models = ["opus", "sonnet", "haiku", "inherit"];

      for (const model of models) {
        const frontmatter: RulesyncSubagentFrontmatter = {
          targets: ["claudecode"],
          name: `${model} Agent`,
          description: `Agent using ${model} model`,
          claudecode: { model: model as any },
        };

        const subagent = new RulesyncSubagent({
          relativeDirPath: ".rulesync/subagents",
          relativeFilePath: `${model}.md`,
          fileContent: "test",
          frontmatter,
          body: `Body for ${model}`,
        });

        expect(subagent.getFrontmatter().claudecode?.model).toBe(model);
      }
    });

    it("should handle all target combinations", () => {
      const targetCombinations = [
        ["*"],
        ["cursor"],
        ["cursor", "claudecode"],
        ["augmentcode", "copilot", "cline"],
        ["amazonqcli", "windsurf", "junie"],
      ];

      for (const targets of targetCombinations) {
        const frontmatter: RulesyncSubagentFrontmatter = {
          targets: targets as any,
          name: "Target Test",
          description: "Testing targets",
        };

        expect(() => {
          const _instance = new RulesyncSubagent({
            relativeDirPath: ".rulesync/subagents",
            relativeFilePath: "target-test.md",
            fileContent: "test",
            frontmatter,
            body: "body",
          });
        }).not.toThrow();
      }
    });

    it("should handle optional claudecode config", () => {
      const frontmatter: RulesyncSubagentFrontmatter = {
        targets: ["cursor"],
        name: "No ClaudeCode Config",
        description: "Agent without ClaudeCode config",
      };

      const subagent = new RulesyncSubagent({
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "no-claude.md",
        fileContent: "test",
        frontmatter,
        body: "body",
      });

      expect(subagent.getFrontmatter().claudecode).toBeUndefined();
    });
  });

  describe("integration with file system", () => {
    it("should handle real file content parsing", async () => {
      const realContent = `---
targets: ["cursor", "claudecode", "copilot"]
name: "Code Reviewer"
description: "Reviews code for quality and security issues"
claudecode:
  model: "sonnet"
---

# Code Reviewer Subagent

You are an expert code reviewer. Focus on:

1. Code quality and maintainability
2. Security vulnerabilities
3. Performance optimizations
4. Best practices adherence

## Guidelines

- Be thorough but constructive
- Provide specific examples
- Suggest improvements with code samples`;

      const filePath = join(testDir, "code-reviewer.md");
      await writeFileContent(filePath, realContent);

      const subagent = await RulesyncSubagent.fromFilePath({ filePath });

      expect(subagent.getFrontmatter()).toEqual({
        targets: ["cursor", "claudecode", "copilot"],
        name: "Code Reviewer",
        description: "Reviews code for quality and security issues",
        claudecode: { model: "sonnet" },
      });

      expect(subagent.getBody()).toContain("# Code Reviewer Subagent");
      expect(subagent.getBody()).toContain("You are an expert code reviewer");
      expect(subagent.getBody()).toContain("## Guidelines");
    });

    it("should handle complex YAML structures in frontmatter", async () => {
      const content = `---
targets: ["*"]
name: "Complex Agent"
description: "Agent with complex config"
claudecode:
  model: "opus"
customConfig:
  timeout: 30000
  retries: 3
  features:
    - feature1
    - feature2
  nested:
    deep:
      value: "test"
---

Complex agent body`;

      const filePath = join(testDir, "complex-agent.md");
      await writeFileContent(filePath, content);

      const subagent = await RulesyncSubagent.fromFilePath({ filePath });

      expect(subagent.getFrontmatter().targets).toEqual(["*"]);
      expect(subagent.getFrontmatter().name).toBe("Complex Agent");
      expect(subagent.getFrontmatter().claudecode?.model).toBe("opus");
      expect(subagent.getBody()).toBe("Complex agent body");
    });
  });
});

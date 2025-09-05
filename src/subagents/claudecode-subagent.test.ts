import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import { stringifyFrontmatter } from "../utils/frontmatter.js";
import {
  ClaudecodeSubagent,
  type ClaudecodeSubagentFrontmatter,
  ClaudecodeSubagentFrontmatterSchema,
} from "./claudecode-subagent.js";
import { RulesyncSubagent, type RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";

describe("ClaudecodeSubagentFrontmatterSchema", () => {
  it("should accept valid frontmatter with required fields only", () => {
    const validFrontmatter = {
      name: "test-agent",
      description: "A test agent",
    };

    expect(() => ClaudecodeSubagentFrontmatterSchema.parse(validFrontmatter)).not.toThrow();
  });

  it("should accept valid frontmatter with optional model field", () => {
    const frontmatterWithModel = {
      name: "test-agent",
      description: "A test agent",
      model: "sonnet" as const,
    };

    expect(() => ClaudecodeSubagentFrontmatterSchema.parse(frontmatterWithModel)).not.toThrow();
  });

  it("should accept all valid model values", () => {
    const models = ["opus", "sonnet", "haiku", "inherit"] as const;

    for (const model of models) {
      const frontmatter = {
        name: "test-agent",
        description: "A test agent",
        model,
      };

      expect(() => ClaudecodeSubagentFrontmatterSchema.parse(frontmatter)).not.toThrow();
    }
  });

  it("should reject frontmatter missing required fields", () => {
    // Missing name
    const missingName = {
      description: "A test agent",
    };
    expect(() => ClaudecodeSubagentFrontmatterSchema.parse(missingName)).toThrow();

    // Missing description
    const missingDescription = {
      name: "test-agent",
    };
    expect(() => ClaudecodeSubagentFrontmatterSchema.parse(missingDescription)).toThrow();
  });

  it("should reject invalid model values", () => {
    const invalidFrontmatter = {
      name: "test-agent",
      description: "A test agent",
      model: "invalid-model",
    };

    expect(() => ClaudecodeSubagentFrontmatterSchema.parse(invalidFrontmatter)).toThrow();
  });

  it("should reject non-string values for required fields", () => {
    const invalidName = {
      name: 123,
      description: "A test agent",
    };
    expect(() => ClaudecodeSubagentFrontmatterSchema.parse(invalidName)).toThrow();

    const invalidDescription = {
      name: "test-agent",
      description: null,
    };
    expect(() => ClaudecodeSubagentFrontmatterSchema.parse(invalidDescription)).toThrow();
  });
});

describe("ClaudecodeSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with valid parameters", () => {
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "test-agent",
        description: "A test agent",
      };

      const subagent = new ClaudecodeSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "test-agent.md",
        frontmatter,
        body: "Test agent body content",
        fileContent: stringifyFrontmatter("Test agent body content", frontmatter),
        validate: true,
      });

      expect(subagent).toBeInstanceOf(ClaudecodeSubagent);
      expect(subagent.getFrontmatter()).toEqual(frontmatter);
      expect(subagent.getBody()).toBe("Test agent body content");
    });

    it("should create instance with model field", () => {
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "test-agent",
        description: "A test agent",
        model: "sonnet",
      };

      const subagent = new ClaudecodeSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "test-agent.md",
        frontmatter,
        body: "Test agent body content",
        fileContent: stringifyFrontmatter("Test agent body content", frontmatter),
        validate: true,
      });

      expect(subagent.getFrontmatter().model).toBe("sonnet");
    });

    it("should throw error with invalid frontmatter when validation enabled", () => {
      const invalidFrontmatter = {
        name: "test-agent",
        description: "A test agent",
        model: "invalid-model",
      } as any;

      expect(() => {
        // oxlint-disable-next-line eslint/no-new
        new ClaudecodeSubagent({
          baseDir: testDir,
          relativeDirPath: ".claude/agents",
          relativeFilePath: "test-agent.md",
          frontmatter: invalidFrontmatter,
          body: "Test agent body content",
          fileContent: stringifyFrontmatter("Test agent body content", invalidFrontmatter),
          validate: true,
        });
      }).toThrow();
    });

    it("should not validate when validation is disabled", () => {
      const invalidFrontmatter = {
        name: "test-agent",
        description: "A test agent",
        model: "invalid-model",
      } as any;

      expect(() => {
        // oxlint-disable-next-line eslint/no-new
        new ClaudecodeSubagent({
          baseDir: testDir,
          relativeDirPath: ".claude/agents",
          relativeFilePath: "test-agent.md",
          frontmatter: invalidFrontmatter,
          body: "Test agent body content",
          fileContent: stringifyFrontmatter("Test agent body content", invalidFrontmatter),
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("getFrontmatter", () => {
    it("should return the frontmatter", () => {
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "test-agent",
        description: "A test agent",
        model: "opus",
      };

      const subagent = new ClaudecodeSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "test-agent.md",
        frontmatter,
        body: "Test content",
        fileContent: stringifyFrontmatter("Test content", frontmatter),
      });

      expect(subagent.getFrontmatter()).toEqual(frontmatter);
    });
  });

  describe("getBody", () => {
    it("should return the body content", () => {
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "test-agent",
        description: "A test agent",
      };

      const body = "This is the agent body content";
      const subagent = new ClaudecodeSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "test-agent.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
      });

      expect(subagent.getBody()).toBe(body);
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "test-agent",
        description: "A test agent",
        model: "sonnet",
      };

      const subagent = new ClaudecodeSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "test-agent.md",
        frontmatter,
        body: "Test content",
        fileContent: stringifyFrontmatter("Test content", frontmatter),
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success when frontmatter is not set", () => {
      // Create subagent without validation
      const subagent = new ClaudecodeSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: undefined as any,
        body: "Test content",
        fileContent: "Test content",
        validate: false,
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter", () => {
      const invalidFrontmatter = {
        name: "test-agent",
        description: "A test agent",
        model: "invalid-model",
      } as any;

      const subagent = new ClaudecodeSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: invalidFrontmatter,
        body: "Test content",
        fileContent: stringifyFrontmatter("Test content", invalidFrontmatter),
        validate: false,
      });

      const result = subagent.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should convert to RulesyncSubagent without model", () => {
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "test-agent",
        description: "A test agent",
      };

      const body = "Agent body content";
      const subagent = new ClaudecodeSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "test-agent.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();

      expect(rulesyncSubagent).toBeInstanceOf(RulesyncSubagent);

      const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
      expect(rulesyncFrontmatter.targets).toEqual(["claudecode"]);
      expect(rulesyncFrontmatter.name).toBe("test-agent");
      expect(rulesyncFrontmatter.description).toBe("A test agent");
      expect(rulesyncFrontmatter.claudecode).toBeUndefined();

      expect(rulesyncSubagent.getBody()).toBe(body);
      expect(rulesyncSubagent.getRelativeDirPath()).toBe(".rulesync/subagents");
      expect(rulesyncSubagent.getRelativeFilePath()).toBe("test-agent.md");
    });

    it("should convert to RulesyncSubagent with model", () => {
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "test-agent",
        description: "A test agent",
        model: "opus",
      };

      const body = "Agent body content";
      const subagent = new ClaudecodeSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "test-agent.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();

      const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
      expect(rulesyncFrontmatter.targets).toEqual(["claudecode"]);
      expect(rulesyncFrontmatter.name).toBe("test-agent");
      expect(rulesyncFrontmatter.description).toBe("A test agent");
      expect(rulesyncFrontmatter.claudecode?.model).toBe("opus");
    });

    it("should preserve baseDir and relativeFilePath", () => {
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "test-agent",
        description: "A test agent",
      };

      const subagent = new ClaudecodeSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "custom/test-agent.md",
        frontmatter,
        body: "Test content",
        fileContent: stringifyFrontmatter("Test content", frontmatter),
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();

      expect(rulesyncSubagent.getBaseDir()).toBe(testDir);
      expect(rulesyncSubagent.getRelativeFilePath()).toBe("custom/test-agent.md");
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should convert from RulesyncSubagent without model", () => {
      const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
        targets: ["claudecode"],
        name: "test-agent",
        description: "A test agent",
      };

      const body = "Agent body content";
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test-agent.md",
        frontmatter: rulesyncFrontmatter,
        body,
        fileContent: stringifyFrontmatter(body, rulesyncFrontmatter),
      });

      const claudecodeSubagent = ClaudecodeSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        rulesyncSubagent,
        validate: true,
      }) as ClaudecodeSubagent;

      expect(claudecodeSubagent).toBeInstanceOf(ClaudecodeSubagent);

      const frontmatter = claudecodeSubagent.getFrontmatter();
      expect(frontmatter.name).toBe("test-agent");
      expect(frontmatter.description).toBe("A test agent");
      expect(frontmatter.model).toBeUndefined();

      expect(claudecodeSubagent.getBody()).toBe(body);
      expect(claudecodeSubagent.getRelativeDirPath()).toBe(".claude/agents");
      expect(claudecodeSubagent.getRelativeFilePath()).toBe("test-agent.md");
    });

    it("should convert from RulesyncSubagent with model", () => {
      const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
        targets: ["claudecode"],
        name: "test-agent",
        description: "A test agent",
        claudecode: {
          model: "haiku",
        },
      };

      const body = "Agent body content";
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test-agent.md",
        frontmatter: rulesyncFrontmatter,
        body,
        fileContent: stringifyFrontmatter(body, rulesyncFrontmatter),
      });

      const claudecodeSubagent = ClaudecodeSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        rulesyncSubagent,
        validate: true,
      }) as ClaudecodeSubagent;

      const frontmatter = claudecodeSubagent.getFrontmatter();
      expect(frontmatter.model).toBe("haiku");
    });

    it("should use default baseDir when not provided", () => {
      const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
        targets: ["claudecode"],
        name: "test-agent",
        description: "A test agent",
      };

      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test-agent.md",
        frontmatter: rulesyncFrontmatter,
        body: "Test content",
        fileContent: stringifyFrontmatter("Test content", rulesyncFrontmatter),
      });

      const claudecodeSubagent = ClaudecodeSubagent.fromRulesyncSubagent({
        relativeDirPath: ".claude/agents",
        rulesyncSubagent,
        validate: true,
      });

      expect(claudecodeSubagent.getBaseDir()).toBe(".");
    });
  });

  describe("fromFile", () => {
    it("should load subagent from file", async () => {
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "file-test-agent",
        description: "An agent loaded from file",
        model: "sonnet",
      };

      const body = "This is the agent content from file";
      const fileContent = stringifyFrontmatter(body, frontmatter);

      // Create the directory structure
      const agentsDir = join(testDir, ".claude", "agents");
      const filePath = join(agentsDir, "file-test-agent.md");

      await writeFileContent(filePath, fileContent);

      const subagent = await ClaudecodeSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "file-test-agent.md",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(ClaudecodeSubagent);
      expect(subagent.getFrontmatter()).toEqual(frontmatter);
      expect(subagent.getBody()).toBe(body);
      expect(subagent.getRelativeFilePath()).toBe("file-test-agent.md");
      expect(subagent.getRelativeDirPath()).toBe(".claude/agents");
      expect(subagent.getBaseDir()).toBe(testDir);
    });

    it("should use default baseDir when not provided", async () => {
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "default-base-agent",
        description: "An agent with default base dir",
      };

      const body = "Agent content";
      const fileContent = stringifyFrontmatter(body, frontmatter);

      // Create the file in current directory
      const agentsDir = join(".", ".claude", "agents");
      const filePath = join(agentsDir, "default-base-agent.md");

      await writeFileContent(filePath, fileContent);

      try {
        const subagent = await ClaudecodeSubagent.fromFile({
          relativeFilePath: "default-base-agent.md",
          validate: true,
        });

        expect(subagent.getBaseDir()).toBe(".");
      } finally {
        // Clean up the file in current directory
        const fs = await import("node:fs/promises");
        try {
          await fs.rm(agentsDir, { recursive: true, force: true });
        } catch {
          // Ignore errors during cleanup
        }
      }
    });

    it("should throw error for file with invalid frontmatter", async () => {
      const invalidFrontmatter = {
        name: "invalid-agent",
        description: "An agent with invalid frontmatter",
        model: "invalid-model",
      };

      const body = "Agent content";
      const fileContent = stringifyFrontmatter(body, invalidFrontmatter);

      const agentsDir = join(testDir, ".claude", "agents");
      const filePath = join(agentsDir, "invalid-agent.md");

      await writeFileContent(filePath, fileContent);

      await expect(
        ClaudecodeSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "invalid-agent.md",
          validate: true,
        }),
      ).rejects.toThrow("Invalid frontmatter");
    });

    it("should throw error for missing required frontmatter fields", async () => {
      const incompleteFrontmatter = {
        name: "incomplete-agent",
        // Missing description
      };

      const body = "Agent content";
      const fileContent = stringifyFrontmatter(body, incompleteFrontmatter);

      const agentsDir = join(testDir, ".claude", "agents");
      const filePath = join(agentsDir, "incomplete-agent.md");

      await writeFileContent(filePath, fileContent);

      await expect(
        ClaudecodeSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "incomplete-agent.md",
          validate: true,
        }),
      ).rejects.toThrow("Invalid frontmatter");
    });

    it("should trim body content", async () => {
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "trim-test-agent",
        description: "Test trimming of body content",
      };

      const bodyWithWhitespace = "\n\n  This content has whitespace  \n\n  ";
      const fileContent = stringifyFrontmatter(bodyWithWhitespace, frontmatter);

      const agentsDir = join(testDir, ".claude", "agents");
      const filePath = join(agentsDir, "trim-test-agent.md");

      await writeFileContent(filePath, fileContent);

      const subagent = await ClaudecodeSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "trim-test-agent.md",
        validate: true,
      });

      expect(subagent.getBody()).toBe("This content has whitespace");
    });
  });
});

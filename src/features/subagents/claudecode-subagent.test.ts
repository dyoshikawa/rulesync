import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
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
      model: "claude-3-5-sonnet-latest",
    };

    expect(() => ClaudecodeSubagentFrontmatterSchema.parse(frontmatterWithModel)).not.toThrow();
  });

  it("should accept optional Claude Code specific fields", () => {
    const frontmatter = {
      name: "test-agent",
      description: "A test agent",
      model: "haiku",
      tools: ["Read", "Write"],
      permissionMode: "default",
      skills: "skill-creator",
    };

    expect(() => ClaudecodeSubagentFrontmatterSchema.parse(frontmatter)).not.toThrow();
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
      model: 123,
    };

    expect(() => ClaudecodeSubagentFrontmatterSchema.parse(invalidFrontmatter)).toThrow();
  });

  it("should reject invalid tool definitions", () => {
    const invalidFrontmatter = {
      name: "test-agent",
      description: "A test agent",
      tools: 123,
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
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
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
        model: 123,
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
        model: 123,
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
        model: 123,
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
      expect(rulesyncFrontmatter.targets).toEqual(["*"]);
      expect(rulesyncFrontmatter.name).toBe("test-agent");
      expect(rulesyncFrontmatter.description).toBe("A test agent");
      expect(rulesyncFrontmatter.claudecode).toBeUndefined();

      expect(rulesyncSubagent.getBody()).toBe(body);
      expect(rulesyncSubagent.getRelativeDirPath()).toBe(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
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
      expect(rulesyncFrontmatter.targets).toEqual(["*"]);
      expect(rulesyncFrontmatter.name).toBe("test-agent");
      expect(rulesyncFrontmatter.description).toBe("A test agent");
      expect(rulesyncFrontmatter.claudecode?.model).toBe("opus");
    });

    it("should preserve relativeFilePath and use project root as baseDir", () => {
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

      // RulesyncSubagent baseDir is always the project root directory
      expect(rulesyncSubagent.getBaseDir()).toBe(".");
      expect(rulesyncSubagent.getRelativeFilePath()).toBe("custom/test-agent.md");
    });
  });

  describe("getSettablePaths with global flag", () => {
    it("should return global paths", () => {
      const paths = ClaudecodeSubagent.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".claude", "agents"));
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
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: rulesyncFrontmatter,
        body,
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
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: rulesyncFrontmatter,
        body,
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
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: rulesyncFrontmatter,
        body: "Test content",
      });

      const claudecodeSubagent = ClaudecodeSubagent.fromRulesyncSubagent({
        relativeDirPath: ".claude/agents",
        rulesyncSubagent,
        validate: true,
      });

      expect(claudecodeSubagent.getBaseDir()).toBe(testDir);
    });

    it("should use global paths when global is true", () => {
      const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
        targets: ["claudecode"],
        name: "global-agent",
        description: "A global agent",
      };

      const body = "Global agent content";
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "global-agent.md",
        frontmatter: rulesyncFrontmatter,
        body,
      });

      const claudecodeSubagent = ClaudecodeSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        rulesyncSubagent,
        validate: true,
        global: true,
      }) as ClaudecodeSubagent;

      expect(claudecodeSubagent).toBeInstanceOf(ClaudecodeSubagent);
      expect(claudecodeSubagent.getRelativeDirPath()).toBe(join(".claude", "agents"));
      expect(claudecodeSubagent.getBody()).toBe(body);
    });

    it("should use local paths when global is false", () => {
      const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
        targets: ["claudecode"],
        name: "local-agent",
        description: "A local agent",
      };

      const body = "Local agent content";
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "local-agent.md",
        frontmatter: rulesyncFrontmatter,
        body,
      });

      const claudecodeSubagent = ClaudecodeSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        rulesyncSubagent,
        validate: true,
        global: false,
      }) as ClaudecodeSubagent;

      expect(claudecodeSubagent).toBeInstanceOf(ClaudecodeSubagent);
      expect(claudecodeSubagent.getRelativeDirPath()).toBe(".claude/agents");
      expect(claudecodeSubagent.getBody()).toBe(body);
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

      const result = ClaudecodeSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
      expect(result).toBe(true);
    });

    it("should return true for rulesync subagent with claudecode target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["claudecode"], name: "Test", description: "Test" },
        body: "Body",
      });

      const result = ClaudecodeSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
      expect(result).toBe(true);
    });

    it("should return true for rulesync subagent with claudecode and other targets", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "claudecode", "cline"],
          name: "Test",
          description: "Test",
        },
        body: "Body",
      });

      const result = ClaudecodeSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
      expect(result).toBe(true);
    });

    it("should return false for rulesync subagent with different target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor"], name: "Test", description: "Test" },
        body: "Body",
      });

      const result = ClaudecodeSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
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

      const result = ClaudecodeSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
      expect(result).toBe(true);
    });
  });

  describe("tool-specific field passthrough", () => {
    it("fromRulesyncSubagent should preserve extra claudecode fields", () => {
      const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
        targets: ["claudecode"],
        name: "test-agent",
        description: "Test agent",
        claudecode: {
          model: "sonnet",
          "allowed-tools": ["Bash", "Read"],
          "max-tokens": 4096,
          tools: ["Read", "Write"],
          permissionMode: "default",
          skills: ["skill-creator"],
        },
      };

      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: rulesyncFrontmatter,
        body: "Test content",
      });

      const claudecodeSubagent = ClaudecodeSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        rulesyncSubagent,
      }) as ClaudecodeSubagent;

      const frontmatter = claudecodeSubagent.getFrontmatter();
      expect(frontmatter.model).toBe("sonnet");
      expect(frontmatter["allowed-tools"]).toEqual(["Bash", "Read"]);
      expect(frontmatter["max-tokens"]).toBe(4096);
      expect(frontmatter.tools).toEqual(["Read", "Write"]);
      expect(frontmatter.permissionMode).toBe("default");
      expect(frontmatter.skills).toEqual(["skill-creator"]);
    });

    it("toRulesyncSubagent should preserve extra fields in claudecode section", () => {
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "test-agent",
        description: "Test agent",
        model: "opus",
        "allowed-tools": ["Grep"],
        tools: ["Read", "Write"],
        permissionMode: "default",
        skills: ["skill-creator"],
        "custom-setting": true,
      };

      const subagent = new ClaudecodeSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "test-agent.md",
        frontmatter,
        body: "Test content",
        fileContent: stringifyFrontmatter("Test content", frontmatter),
        validate: false,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      const result = rulesyncSubagent.getFrontmatter();

      expect(result.claudecode?.model).toBe("opus");
      expect(result.claudecode?.["allowed-tools"]).toEqual(["Grep"]);
      expect(result.claudecode?.tools).toEqual(["Read", "Write"]);
      expect(result.claudecode?.permissionMode).toBe("default");
      expect(result.claudecode?.skills).toEqual(["skill-creator"]);
      expect(result.claudecode?.["custom-setting"]).toBe(true);
    });

    it("round-trip should preserve all fields", () => {
      const original = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "roundtrip.md",
        frontmatter: {
          targets: ["claudecode"],
          name: "roundtrip-agent",
          description: "Roundtrip test",
          claudecode: {
            model: "haiku",
            "allowed-tools": ["Read", "Write"],
            custom: { deep: { value: 42 } },
          },
        },
        body: "Body content",
      });

      const claudecode = ClaudecodeSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        rulesyncSubagent: original,
      }) as ClaudecodeSubagent;
      const backToRulesync = claudecode.toRulesyncSubagent();

      expect(backToRulesync.getFrontmatter().claudecode).toEqual({
        model: "haiku",
        "allowed-tools": ["Read", "Write"],
        custom: { deep: { value: 42 } },
      });
    });

    it("should not include claudecode section when no model or extra fields", () => {
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "test-agent",
        description: "Test agent",
      };

      const subagent = new ClaudecodeSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "test-agent.md",
        frontmatter,
        body: "Test content",
        fileContent: stringifyFrontmatter("Test content", frontmatter),
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      const result = rulesyncSubagent.getFrontmatter();

      expect(result.claudecode).toBeUndefined();
    });

    it("should handle empty claudecode fields in RulesyncSubagent", () => {
      const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
        targets: ["claudecode"],
        name: "test-agent",
        description: "Test agent",
        claudecode: {},
      };

      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "empty-test.md",
        frontmatter: rulesyncFrontmatter,
        body: "Test content",
      });

      const claudecodeSubagent = ClaudecodeSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        rulesyncSubagent,
      }) as ClaudecodeSubagent;

      const frontmatter = claudecodeSubagent.getFrontmatter();
      expect(frontmatter.name).toBe("test-agent");
      expect(frontmatter.description).toBe("Test agent");
      expect(frontmatter.model).toBeUndefined();
      // Only name and description should be present
      expect(Object.keys(frontmatter).toSorted()).toEqual(["description", "name"]);
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

      // Create the file in test directory (process.cwd() is mocked to return testDir)
      const agentsDir = join(testDir, ".claude", "agents");
      const filePath = join(agentsDir, "default-base-agent.md");

      await writeFileContent(filePath, fileContent);

      const subagent = await ClaudecodeSubagent.fromFile({
        relativeFilePath: "default-base-agent.md",
        validate: true,
      });

      expect(subagent.getBaseDir()).toBe(testDir);
    });

    it("should throw error for file with invalid frontmatter", async () => {
      const invalidFrontmatter = {
        name: "invalid-agent",
        description: "An agent with invalid frontmatter",
        model: 123,
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

    it("should load from global path when global is true", async () => {
      const agentsDir = join(testDir, ".claude", "agents");
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "global-test-agent",
        description: "A global test agent",
        model: "opus",
      };

      const body = "Global agent body";
      const fileContent = stringifyFrontmatter(body, frontmatter);

      const filePath = join(agentsDir, "global-test-agent.md");
      await writeFileContent(filePath, fileContent);

      const subagent = await ClaudecodeSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "global-test-agent.md",
        validate: true,
        global: true,
      });

      expect(subagent).toBeInstanceOf(ClaudecodeSubagent);
      expect(subagent.getBody()).toBe(body);
      expect(subagent.getFrontmatter()).toEqual(frontmatter);
      expect(subagent.getRelativeDirPath()).toBe(join(".claude", "agents"));
    });
  });
});

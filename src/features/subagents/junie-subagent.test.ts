import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import {
  JunieSubagent,
  type JunieSubagentFrontmatter,
  JunieSubagentFrontmatterSchema,
} from "./junie-subagent.js";
import { RulesyncSubagent, type RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";

describe("JunieSubagentFrontmatterSchema", () => {
  it("should accept valid frontmatter with required fields only", () => {
    const validFrontmatter = {
      name: "test-agent",
      description: "A test agent",
    };

    expect(() => JunieSubagentFrontmatterSchema.parse(validFrontmatter)).not.toThrow();
  });

  it("should accept valid frontmatter without description", () => {
    const frontmatter = {
      name: "test-agent",
    };

    expect(() => JunieSubagentFrontmatterSchema.parse(frontmatter)).not.toThrow();
    const result = JunieSubagentFrontmatterSchema.parse(frontmatter);
    expect(result.description).toBeUndefined();
  });

  it("should reject frontmatter missing name", () => {
    const missingName = {
      description: "A test agent",
    };
    expect(() => JunieSubagentFrontmatterSchema.parse(missingName)).toThrow();
  });

  it("should reject non-string name", () => {
    const invalidName = { name: 123, description: "A test agent" };
    expect(() => JunieSubagentFrontmatterSchema.parse(invalidName)).toThrow();
  });
});

describe("JunieSubagent", () => {
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

  it("should return settable paths", () => {
    expect(JunieSubagent.getSettablePaths()).toEqual({
      relativeDirPath: join(".junie", "agents"),
    });

    expect(JunieSubagent.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(".junie", "agents"),
    });
  });

  describe("constructor", () => {
    it("should create instance with valid parameters", () => {
      const frontmatter: JunieSubagentFrontmatter = {
        name: "test-agent",
        description: "A test agent",
      };

      const subagent = new JunieSubagent({
        baseDir: testDir,
        relativeDirPath: ".junie/agents",
        relativeFilePath: "test-agent.md",
        frontmatter,
        body: "Test agent body content",
        fileContent: stringifyFrontmatter("Test agent body content", frontmatter),
        validate: true,
      });

      expect(subagent).toBeInstanceOf(JunieSubagent);
      expect(subagent.getFrontmatter()).toEqual(frontmatter);
      expect(subagent.getBody()).toBe("Test agent body content");
    });

    it("should throw error with invalid frontmatter when validation enabled", () => {
      const invalidFrontmatter = { name: 123, description: "desc" } as any;

      expect(() => {
        // oxlint-disable-next-line eslint/no-new
        new JunieSubagent({
          baseDir: testDir,
          relativeDirPath: ".junie/agents",
          relativeFilePath: "test-agent.md",
          frontmatter: invalidFrontmatter,
          body: "body",
          fileContent: "",
          validate: true,
        });
      }).toThrow();
    });

    it("should not validate when validation is disabled", () => {
      const invalidFrontmatter = { name: 123, description: "desc" } as any;

      expect(() => {
        // oxlint-disable-next-line eslint/no-new
        new JunieSubagent({
          baseDir: testDir,
          relativeDirPath: ".junie/agents",
          relativeFilePath: "test-agent.md",
          frontmatter: invalidFrontmatter,
          body: "body",
          fileContent: "",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should convert to RulesyncSubagent without extra fields", () => {
      const frontmatter: JunieSubagentFrontmatter = {
        name: "test-agent",
        description: "A test agent",
      };

      const body = "Agent body content";
      const subagent = new JunieSubagent({
        baseDir: testDir,
        relativeDirPath: ".junie/agents",
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
      expect(rulesyncFrontmatter.junie).toBeUndefined();
      expect(rulesyncSubagent.getBody()).toBe(body);
      expect(rulesyncSubagent.getRelativeDirPath()).toBe(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      expect(rulesyncSubagent.getRelativeFilePath()).toBe("test-agent.md");
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should convert from RulesyncSubagent", () => {
      const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
        targets: ["junie"],
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

      const junieSubagent = JunieSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        rulesyncSubagent,
        validate: true,
      }) as JunieSubagent;

      expect(junieSubagent).toBeInstanceOf(JunieSubagent);
      expect(junieSubagent.getFrontmatter().name).toBe("test-agent");
      expect(junieSubagent.getFrontmatter().description).toBe("A test agent");
      expect(junieSubagent.getBody()).toBe(body);
      expect(junieSubagent.getRelativeDirPath()).toBe(join(".junie", "agents"));
      expect(junieSubagent.getRelativeFilePath()).toBe("test-agent.md");
    });

    it("should use default baseDir when not provided", () => {
      const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
        targets: ["junie"],
        name: "test-agent",
        description: "A test agent",
      };

      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: rulesyncFrontmatter,
        body: "content",
      });

      const junieSubagent = JunieSubagent.fromRulesyncSubagent({ rulesyncSubagent });

      expect(junieSubagent.getBaseDir()).toBe(testDir);
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should return true for wildcard target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["*"], name: "Test", description: "Test" },
        body: "Body",
      });

      expect(JunieSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return true for junie target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["junie"], name: "Test", description: "Test" },
        body: "Body",
      });

      expect(JunieSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return false for different target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["claudecode"], name: "Test", description: "Test" },
        body: "Body",
      });

      expect(JunieSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(false);
    });
  });

  describe("fromFile", () => {
    it("should load subagent from file", async () => {
      const frontmatter: JunieSubagentFrontmatter = {
        name: "file-test-agent",
        description: "An agent loaded from file",
      };

      const body = "This is the agent content from file";
      const fileContent = stringifyFrontmatter(body, frontmatter);

      const agentsDir = join(testDir, ".junie", "agents");
      const filePath = join(agentsDir, "file-test-agent.md");

      await writeFileContent(filePath, fileContent);

      const subagent = await JunieSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "file-test-agent.md",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(JunieSubagent);
      expect(subagent.getFrontmatter()).toEqual(frontmatter);
      expect(subagent.getBody()).toBe(body);
      expect(subagent.getRelativeFilePath()).toBe("file-test-agent.md");
      expect(subagent.getRelativeDirPath()).toBe(join(".junie", "agents"));
      expect(subagent.getBaseDir()).toBe(testDir);
    });

    it("should throw error for file with missing name", async () => {
      const invalidFrontmatter = { description: "no name" };
      const fileContent = stringifyFrontmatter("body", invalidFrontmatter);

      const agentsDir = join(testDir, ".junie", "agents");
      const filePath = join(agentsDir, "invalid.md");

      await writeFileContent(filePath, fileContent);

      await expect(
        JunieSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "invalid.md",
          validate: true,
        }),
      ).rejects.toThrow("Invalid frontmatter");
    });

    it("should trim body content", async () => {
      const frontmatter: JunieSubagentFrontmatter = {
        name: "trim-agent",
        description: "Test trimming",
      };

      const bodyWithWhitespace = "\n\n  body content  \n\n";
      const fileContent = stringifyFrontmatter(bodyWithWhitespace, frontmatter);

      const agentsDir = join(testDir, ".junie", "agents");
      const filePath = join(agentsDir, "trim-agent.md");

      await writeFileContent(filePath, fileContent);

      const subagent = await JunieSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "trim-agent.md",
        validate: true,
      });

      expect(subagent.getBody()).toBe("body content");
    });
  });
});

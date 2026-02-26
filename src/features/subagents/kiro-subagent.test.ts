import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { KiroSubagent } from "./kiro-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("KiroSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

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

  it("should return settable paths for project scope", () => {
    expect(KiroSubagent.getSettablePaths()).toEqual({
      relativeDirPath: join(".kiro", "agents"),
    });

    expect(KiroSubagent.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(".kiro", "agents"),
    });
  });

  describe("constructor", () => {
    it("should create instance with valid JSON body", () => {
      const json = { name: "test" };
      const subagent = new KiroSubagent({
        baseDir: testDir,
        relativeDirPath: ".kiro/agents",
        relativeFilePath: "test.json",
        body: JSON.stringify(json),
        fileContent: "",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(KiroSubagent);
      expect(subagent.getBody()).toBe(JSON.stringify(json));
    });

    it("should throw error for invalid JSON body when validate is true", () => {
      expect(() => {
        new KiroSubagent({
          baseDir: testDir,
          relativeDirPath: ".kiro/agents",
          relativeFilePath: "invalid.json",
          body: "not json",
          fileContent: "",
          validate: true,
        });
      }).toThrow(/Invalid JSON in/);
    });

    it("should throw error for invalid JSON body when validate is default (true)", () => {
      expect(() => {
        new KiroSubagent({
          baseDir: testDir,
          relativeDirPath: ".kiro/agents",
          relativeFilePath: "invalid.json",
          body: "not json",
          fileContent: "",
        });
      }).toThrow(/Invalid JSON in/);
    });

    it("should throw error for missing required name field when validate is true", () => {
      expect(() => {
        new KiroSubagent({
          baseDir: testDir,
          relativeDirPath: ".kiro/agents",
          relativeFilePath: "missing-name.json",
          body: JSON.stringify({ description: "no name" }),
          fileContent: "",
          validate: true,
        });
      }).toThrow(/Invalid JSON in/);
    });

    it("should create instance with invalid JSON body when validate is false", () => {
      const subagent = new KiroSubagent({
        baseDir: testDir,
        relativeDirPath: ".kiro/agents",
        relativeFilePath: "invalid.json",
        body: "not json",
        fileContent: "",
        validate: false,
      });

      expect(subagent).toBeInstanceOf(KiroSubagent);
      expect(subagent.validate().success).toBe(false);
    });
  });

  it("should create a RulesyncSubagent with kiro target from JSON", () => {
    const json = {
      name: "review",
      description: "Review agent",
      prompt: "Review the provided changes",
      model: "anthropic/claude-sonnet-4",
      tools: ["read", "write"],
    };
    const subagent = new KiroSubagent({
      baseDir: testDir,
      relativeDirPath: ".kiro/agents",
      relativeFilePath: "review.json",
      body: JSON.stringify(json),
      fileContent: "",
      validate: true,
    });

    const rulesyncSubagent = subagent.toRulesyncSubagent();

    expect(rulesyncSubagent).toBeInstanceOf(RulesyncSubagent);
    expect(rulesyncSubagent.getFrontmatter()).toMatchObject({
      targets: ["kiro"],
      name: "review",
      description: "Review agent",
      kiro: {
        model: "anthropic/claude-sonnet-4",
        tools: ["read", "write"],
      },
    });
    expect(rulesyncSubagent.getBody()).toBe("Review the provided changes");
    expect(rulesyncSubagent.getRelativeFilePath()).toBe("review.md");
  });

  it("should create KiroSubagent from RulesyncSubagent with frontmatter", () => {
    const rulesyncSubagent = new RulesyncSubagent({
      baseDir: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "reviewer.md",
      frontmatter: {
        targets: ["kiro"],
        name: "reviewer",
        description: "Code reviewer",
        kiro: {
          model: "anthropic/claude-sonnet-4",
          tools: ["read", "write"],
        },
      },
      body: "Review code changes",
      validate: true,
    });

    const kiroSubagent = KiroSubagent.fromRulesyncSubagent({
      baseDir: testDir,
      rulesyncSubagent,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    }) as KiroSubagent;

    expect(kiroSubagent).toBeInstanceOf(KiroSubagent);
    expect(kiroSubagent.getRelativeDirPath()).toBe(join(".kiro", "agents"));
    expect(kiroSubagent.getRelativeFilePath()).toBe("reviewer.json");
    const parsed = JSON.parse(kiroSubagent.getBody());
    expect(parsed).toMatchObject({
      name: "reviewer",
      description: "Code reviewer",
      prompt: "Review code changes",
      model: "anthropic/claude-sonnet-4",
      tools: ["read", "write"],
    });
  });

  it("should validate JSON successfully", () => {
    const json = { name: "test", prompt: "Test prompt" };
    const subagent = new KiroSubagent({
      baseDir: testDir,
      relativeDirPath: ".kiro/agents",
      relativeFilePath: "test.json",
      body: JSON.stringify(json),
      fileContent: "",
      validate: true,
    });

    expect(subagent.validate()).toEqual({ success: true, error: null });
  });

  it("should fail validation for invalid JSON", () => {
    const subagent = new KiroSubagent({
      baseDir: testDir,
      relativeDirPath: ".kiro/agents",
      relativeFilePath: "invalid.json",
      body: "not json",
      fileContent: "",
      validate: false,
    });

    const result = subagent.validate();
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("should load from JSON file", async () => {
    const agentsDir = join(testDir, ".kiro", "agents");
    const filePath = join(agentsDir, "planner.json");
    const json = {
      name: "planner",
      description: "Planning agent",
      prompt: "You are a planner agent",
    };

    await writeFileContent(filePath, JSON.stringify(json, null, 2));

    const subagent = await KiroSubagent.fromFile({
      baseDir: testDir,
      relativeFilePath: "planner.json",
    });

    expect(subagent).toBeInstanceOf(KiroSubagent);
    expect(JSON.parse(subagent.getBody())).toEqual(json);
  });

  it("should throw error when file contains invalid JSON content", async () => {
    const agentsDir = join(testDir, ".kiro", "agents");
    const filePath = join(agentsDir, "invalid.json");

    await writeFileContent(filePath, "not valid json");

    await expect(
      KiroSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "invalid.json",
        validate: true,
      }),
    ).rejects.toThrow();
  });

  it("should identify targeted rulesync subagents", () => {
    const targeted = new RulesyncSubagent({
      baseDir: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "agent.md",
      frontmatter: { targets: ["kiro"], name: "agent", description: "" },
      body: "Content",
      validate: true,
    });

    const notTargeted = new RulesyncSubagent({
      baseDir: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "other.md",
      frontmatter: { targets: ["cursor"], name: "other", description: "" },
      body: "Content",
      validate: true,
    });

    expect(KiroSubagent.isTargetedByRulesyncSubagent(targeted)).toBe(true);
    expect(KiroSubagent.isTargetedByRulesyncSubagent(notTargeted)).toBe(false);
  });

  it("should create deletable placeholder", () => {
    const subagent = KiroSubagent.forDeletion({
      baseDir: testDir,
      relativeDirPath: ".kiro/agents",
      relativeFilePath: "obsolete.json",
    });

    expect(subagent.isDeletable()).toBe(true);
    expect(subagent.getBody()).toBe("");
  });

  it("should import JSON file and convert to RulesyncSubagent with frontmatter", async () => {
    const agentsDir = join(testDir, ".kiro", "agents");
    const filePath = join(agentsDir, "test-agent.json");
    const json = {
      name: "test-agent",
      description: "Test agent for import",
      prompt: "You are a test agent",
      model: "anthropic/claude-sonnet-4",
      tools: ["read", "write"],
    };

    await writeFileContent(filePath, JSON.stringify(json, null, 2));

    const kiroSubagent = await KiroSubagent.fromFile({
      baseDir: testDir,
      relativeFilePath: "test-agent.json",
    });

    const rulesyncSubagent = kiroSubagent.toRulesyncSubagent();

    expect(rulesyncSubagent.getFrontmatter()).toMatchObject({
      targets: ["kiro"],
      name: "test-agent",
      description: "Test agent for import",
      kiro: {
        model: "anthropic/claude-sonnet-4",
        tools: ["read", "write"],
      },
    });
    expect(rulesyncSubagent.getBody()).toBe("You are a test agent");
    expect(rulesyncSubagent.getRelativeFilePath()).toBe("test-agent.md");
  });
});

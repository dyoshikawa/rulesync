import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { KiroCliSubagent } from "./kirocli-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("KiroCliSubagent", () => {
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

  const validJson = {
    name: "planner",
    description: "Plan things",
    prompt: "Plan tasks",
    tools: ["read", "write"],
  };

  const validJsonContent = JSON.stringify(validJson, null, 2);

  describe("getSettablePaths", () => {
    it("returns Kiro CLI agents directory", () => {
      expect(KiroCliSubagent.getSettablePaths()).toEqual({
        relativeDirPath: join(".kiro", "agents"),
      });
    });
  });

  describe("constructor", () => {
    it("creates instance with valid JSON", () => {
      const subagent = new KiroCliSubagent({
        baseDir: testDir,
        relativeDirPath: join(".kiro", "agents"),
        relativeFilePath: "planner.json",
        json: validJson,
        fileContent: validJsonContent,
        validate: true,
      });

      expect(subagent).toBeInstanceOf(KiroCliSubagent);
      expect(subagent.getJson()).toEqual(validJson);
      expect(subagent.getBody()).toBe("Plan tasks");
    });

    it("throws error for invalid JSON when validate is true", () => {
      expect(() => {
        new KiroCliSubagent({
          baseDir: testDir,
          relativeDirPath: join(".kiro", "agents"),
          relativeFilePath: "invalid.json",
          json: { description: "missing name" } as any,
          fileContent: "{}",
          validate: true,
        });
      }).toThrow();
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("creates KiroCliSubagent from RulesyncSubagent", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "planner.md",
        frontmatter: {
          targets: ["kirocli"],
          name: "planner",
          description: "Plan things",
          kirocli: {
            tools: ["read", "write"],
            model: "claude-sonnet-4",
          },
        },
        body: "Plan tasks",
        validate: true,
      });

      const subagent = KiroCliSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        rulesyncSubagent,
        validate: true,
      }) as KiroCliSubagent;

      expect(subagent.getJson()).toMatchObject({
        name: "planner",
        description: "Plan things",
        prompt: "Plan tasks",
        tools: ["read", "write"],
        model: "claude-sonnet-4",
      });
      expect(subagent.getRelativeDirPath()).toBe(join(".kiro", "agents"));
      expect(subagent.getRelativeFilePath()).toBe("planner.json");
    });

    it("handles empty body", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "simple.md",
        frontmatter: {
          targets: ["kirocli"],
          name: "simple",
          description: "Simple agent",
          kirocli: {},
        },
        body: "",
        validate: true,
      });

      const subagent = KiroCliSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        rulesyncSubagent,
        validate: true,
      }) as KiroCliSubagent;

      expect(subagent.getJson().prompt).toBeUndefined();
    });
  });

  describe("toRulesyncSubagent", () => {
    it("creates rulesync file with kirocli section", () => {
      const subagent = new KiroCliSubagent({
        baseDir: testDir,
        relativeDirPath: join(".kiro", "agents"),
        relativeFilePath: "planner.json",
        json: {
          name: "planner",
          description: "Plan things",
          prompt: "Plan tasks",
          tools: ["read", "write"],
          model: "claude-sonnet-4",
        },
        fileContent: validJsonContent,
        validate: true,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();

      expect(rulesyncSubagent.getFrontmatter()).toMatchObject({
        targets: ["kirocli"],
        name: "planner",
        description: "Plan things",
        kirocli: {
          tools: ["read", "write"],
          model: "claude-sonnet-4",
        },
      });
      expect(rulesyncSubagent.getBody()).toBe("Plan tasks");
      expect(rulesyncSubagent.getRelativeFilePath()).toBe("planner.md");
    });
  });

  describe("fromFile", () => {
    it("loads Kiro CLI subagent from file", async () => {
      const agentsDir = join(testDir, ".kiro", "agents");
      await writeFileContent(join(agentsDir, "planner.json"), validJsonContent);

      const subagent = await KiroCliSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "planner.json",
      });

      expect(subagent.getJson()).toEqual(validJson);
      expect(subagent.getBody()).toBe("Plan tasks");
    });

    it("throws error for invalid JSON file", async () => {
      const agentsDir = join(testDir, ".kiro", "agents");
      await writeFileContent(join(agentsDir, "invalid.json"), '{"invalid": true}');

      await expect(
        KiroCliSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "invalid.json",
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("validates required fields", () => {
      const subagent = new KiroCliSubagent({
        baseDir: testDir,
        relativeDirPath: join(".kiro", "agents"),
        relativeFilePath: "planner.json",
        json: validJson,
        fileContent: validJsonContent,
        validate: false,
      });

      expect(subagent.validate().success).toBe(true);
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("returns true for kirocli target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["kirocli"],
          name: "test",
          description: "Test",
        },
        body: "",
        validate: true,
      });

      expect(KiroCliSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("returns true for wildcard target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
          name: "test",
          description: "Test",
        },
        body: "",
        validate: true,
      });

      expect(KiroCliSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("returns false for other targets", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor"],
          name: "test",
          description: "Test",
        },
        body: "",
        validate: true,
      });

      expect(KiroCliSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("creates deletable subagent placeholder", () => {
      const subagent = KiroCliSubagent.forDeletion({
        baseDir: testDir,
        relativeDirPath: join(".kiro", "agents"),
        relativeFilePath: "obsolete.json",
      });

      expect(subagent.isDeletable()).toBe(true);
      expect(subagent.getFileContent()).toBe("{}");
    });
  });
});

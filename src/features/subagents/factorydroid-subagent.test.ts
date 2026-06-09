import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import {
  FactorydroidSubagent,
  FactorydroidSubagentFrontmatterSchema,
} from "./factorydroid-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import type { ToolSubagent } from "./tool-subagent.js";

describe("FactorydroidSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validMarkdownContent = `---
name: planner
description: Test factorydroid droid description
model: gpt-5
reasoningEffort: high
---

This is the body of the factorydroid droid.
It can be multiline.`;

  const invalidMarkdownContent = `---
# Missing required name field
description: only description
---

Body content`;

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
    it("should return correct paths for factorydroid subagents", () => {
      const paths = FactorydroidSubagent.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: join(".factory", "droids"),
      });
    });

    it("should return the same relative path in global mode", () => {
      const paths = FactorydroidSubagent.getSettablePaths({ global: true });
      expect(paths).toEqual({
        relativeDirPath: join(".factory", "droids"),
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid markdown content", () => {
      const subagent = new FactorydroidSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "droids"),
        relativeFilePath: "test-droid.md",
        frontmatter: {
          name: "planner",
          description: "Test factorydroid droid description",
        },
        body: "This is the body of the factorydroid droid.\nIt can be multiline.",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(FactorydroidSubagent);
      expect(subagent.getBody()).toBe(
        "This is the body of the factorydroid droid.\nIt can be multiline.",
      );
      expect(subagent.getFrontmatter()).toEqual({
        name: "planner",
        description: "Test factorydroid droid description",
      });
    });

    it("should throw error for invalid frontmatter when validation is enabled", () => {
      expect(
        () =>
          new FactorydroidSubagent({
            outputRoot: testDir,
            relativeDirPath: join(".factory", "droids"),
            relativeFilePath: "invalid-droid.md",
            // Missing required name field
            frontmatter: { description: "only" } as never,
            body: "Body content",
            validate: true,
          }),
      ).toThrow();
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should convert to RulesyncSubagent and preserve extra fields in factorydroid section", () => {
      const subagent = new FactorydroidSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "droids"),
        relativeFilePath: "planner.md",
        frontmatter: {
          name: "planner",
          description: "Plans tasks",
          model: "gpt-5",
          reasoningEffort: "high",
          tools: ["Read", "Edit"],
        },
        body: "Plan body",
        validate: true,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();

      expect(rulesyncSubagent).toBeInstanceOf(RulesyncSubagent);
      expect(rulesyncSubagent.getFrontmatter()).toEqual({
        targets: ["*"],
        name: "planner",
        description: "Plans tasks",
        factorydroid: {
          model: "gpt-5",
          reasoningEffort: "high",
          tools: ["Read", "Edit"],
        },
      });
      expect(rulesyncSubagent.getBody()).toBe("Plan body");
    });

    it("should not emit a factorydroid section when only name+description are present", () => {
      const subagent = new FactorydroidSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "droids"),
        relativeFilePath: "simple.md",
        frontmatter: { name: "simple", description: "Simple" },
        body: "Body",
        validate: true,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      expect(rulesyncSubagent.getFrontmatter()).toEqual({
        targets: ["*"],
        name: "simple",
        description: "Simple",
      });
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should create FactorydroidSubagent from RulesyncSubagent", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "planner.md",
        frontmatter: {
          targets: ["factorydroid"],
          name: "planner",
          description: "Test description from rulesync",
        },
        body: "Test droid content",
        validate: true,
      });

      const factorydroidSubagent = FactorydroidSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        rulesyncSubagent,
        validate: true,
      }) as FactorydroidSubagent;

      expect(factorydroidSubagent).toBeInstanceOf(FactorydroidSubagent);
      expect(factorydroidSubagent.getBody()).toBe("Test droid content");
      expect(factorydroidSubagent.getFrontmatter()).toEqual({
        name: "planner",
        description: "Test description from rulesync",
      });
      expect(factorydroidSubagent.getRelativeFilePath()).toBe("planner.md");
      expect(factorydroidSubagent.getRelativeDirPath()).toBe(join(".factory", "droids"));
    });

    it("should merge factorydroid section fields (model, reasoningEffort, tools)", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "planner.md",
        frontmatter: {
          targets: ["factorydroid"],
          name: "planner",
          description: "Plans tasks",
          factorydroid: {
            model: "gpt-5",
            reasoningEffort: "high",
            tools: ["Read", "Edit"],
          },
        },
        body: "Plan body",
        validate: true,
      });

      const factorydroidSubagent = FactorydroidSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        rulesyncSubagent,
      }) as FactorydroidSubagent;

      expect(factorydroidSubagent.getFrontmatter()).toEqual({
        name: "planner",
        description: "Plans tasks",
        model: "gpt-5",
        reasoningEffort: "high",
        tools: ["Read", "Edit"],
      });
    });

    it("should generate into the same relative path in global mode", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "planner.md",
        frontmatter: { targets: ["factorydroid"], name: "planner", description: "Global droid" },
        body: "Global body",
        validate: true,
      });

      const factorydroidSubagent = FactorydroidSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        rulesyncSubagent,
        global: true,
      }) as FactorydroidSubagent;

      expect(factorydroidSubagent.getRelativeDirPath()).toBe(join(".factory", "droids"));
      expect(factorydroidSubagent.getBody()).toBe("Global body");
    });
  });

  describe("fromFile", () => {
    it("should load FactorydroidSubagent from file", async () => {
      const droidsDir = join(testDir, ".factory", "droids");
      const filePath = join(droidsDir, "planner.md");

      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await FactorydroidSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "planner.md",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(FactorydroidSubagent);
      expect(subagent.getBody()).toBe(
        "This is the body of the factorydroid droid.\nIt can be multiline.",
      );
      expect(subagent.getFrontmatter()).toEqual({
        name: "planner",
        description: "Test factorydroid droid description",
        model: "gpt-5",
        reasoningEffort: "high",
      });
      expect(subagent.getRelativeFilePath()).toBe("planner.md");
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        FactorydroidSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "non-existent-droid.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should throw error when file contains invalid frontmatter", async () => {
      const droidsDir = join(testDir, ".factory", "droids");
      const filePath = join(droidsDir, "invalid-droid.md");

      await writeFileContent(filePath, invalidMarkdownContent);

      await expect(
        FactorydroidSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "invalid-droid.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const subagent = new FactorydroidSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "droids"),
        relativeFilePath: "valid-droid.md",
        frontmatter: {
          name: "valid",
          description: "Valid description",
        },
        body: "Valid body",
        validate: false,
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("FactorydroidSubagentFrontmatterSchema", () => {
    it("should accept rich frontmatter fields", () => {
      const result = FactorydroidSubagentFrontmatterSchema.safeParse({
        name: "planner",
        description: "Plans tasks",
        model: "gpt-5",
        reasoningEffort: "high",
        tools: ["Read"],
        mcpServers: { github: { command: "gh" } },
      });
      expect(result.success).toBe(true);
    });

    it("should reject frontmatter without name", () => {
      const result = FactorydroidSubagentFrontmatterSchema.safeParse({ description: "x" });
      expect(result.success).toBe(false);
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

      const result = FactorydroidSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
      expect(result).toBe(true);
    });

    it("should return true for rulesync subagent with factorydroid target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["factorydroid"], name: "Test", description: "Test" },
        body: "Body",
      });

      const result = FactorydroidSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
      expect(result).toBe(true);
    });

    it("should return false for rulesync subagent with different target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor"], name: "Test", description: "Test" },
        body: "Body",
      });

      const result = FactorydroidSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
      expect(result).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create deletion marker", () => {
      const subagent = FactorydroidSubagent.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "droids"),
        relativeFilePath: "to-delete.md",
      });

      expect(subagent).toBeInstanceOf(FactorydroidSubagent);
      expect(subagent.getRelativeFilePath()).toBe("to-delete.md");
      expect(subagent.isDeletable()).toBe(true);
    });
  });

  describe("integration with base classes", () => {
    it("should be assignable to ToolSubagent type", () => {
      const subagent = new FactorydroidSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "droids"),
        relativeFilePath: "test.md",
        frontmatter: {
          name: "Test",
          description: "Test",
        },
        body: "Test",
        validate: false,
      });

      const toolSubagent: ToolSubagent = subagent;
      expect(toolSubagent).toBeDefined();
    });
  });
});

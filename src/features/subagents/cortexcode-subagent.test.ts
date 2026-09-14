import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CortexcodeSubagent } from "./cortexcode-subagent.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import { ToolSubagent } from "./tool-subagent.js";

describe("CortexcodeSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const agentsDir = join(".cortex", "agents");
  const globalAgentsDir = join(".snowflake", "cortex", "agents");

  const validMarkdownContent = `---
name: code-reviewer
description: Reviews code for quality issues
tools:
  - read_file
  - grep_search
model: claude-sonnet-4-5
---

You are a senior code reviewer.
Focus on correctness first.`;

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

  describe("getSettablePaths", () => {
    it("should return .cortex/agents for project scope", () => {
      expect(CortexcodeSubagent.getSettablePaths()).toEqual({
        relativeDirPath: agentsDir,
      });
    });

    it("should return .snowflake/cortex/agents for global scope (resolved against the home dir)", () => {
      // Per https://docs.snowflake.com/en/user-guide/cortex-code/extensibility
      // user-level subagents live at ~/.snowflake/cortex/agents/*.md.
      expect(CortexcodeSubagent.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: globalAgentsDir,
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid frontmatter", () => {
      const subagent = new CortexcodeSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "test-agent",
          description: "Test agent description",
        },
        body: "Agent body.\nIt can be multiline.",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(CortexcodeSubagent);
      expect(subagent.getBody()).toBe("Agent body.\nIt can be multiline.");
      expect(subagent.getFrontmatter()).toEqual({
        name: "test-agent",
        description: "Test agent description",
      });
    });

    it("should throw on invalid frontmatter when validation is enabled", () => {
      expect(
        () =>
          new CortexcodeSubagent({
            outputRoot: testDir,
            relativeDirPath: agentsDir,
            relativeFilePath: "test-agent.md",
            // @ts-expect-error - intentionally invalid
            frontmatter: { invalid: true },
            body: "Body",
            validate: true,
          }),
      ).toThrow(/Invalid frontmatter/);
    });

    it("should reject a non-array tools value", () => {
      expect(
        () =>
          new CortexcodeSubagent({
            outputRoot: testDir,
            relativeDirPath: agentsDir,
            relativeFilePath: "test-agent.md",
            // @ts-expect-error - intentionally invalid
            frontmatter: { name: "x", description: "y", tools: "read_file" },
            body: "Body",
            validate: true,
          }),
      ).toThrow(/Invalid frontmatter/);
    });

    it("should skip validation when validate is false", () => {
      const subagent = new CortexcodeSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        relativeFilePath: "test-agent.md",
        // @ts-expect-error - intentionally invalid
        frontmatter: { invalid: true },
        body: "Body",
        validate: false,
      });
      expect(subagent).toBeInstanceOf(CortexcodeSubagent);
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should create CortexcodeSubagent from RulesyncSubagent", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["cortexcode"],
          name: "test-agent",
          description: "Test agent description",
        },
        body: "Test agent content",
        validate: true,
      });

      const cortexcodeSubagent = CortexcodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
        validate: true,
      }) as CortexcodeSubagent;

      expect(cortexcodeSubagent).toBeInstanceOf(CortexcodeSubagent);
      expect(cortexcodeSubagent.getBody()).toBe("Test agent content");
      expect(cortexcodeSubagent.getFrontmatter()).toEqual({
        name: "test-agent",
        description: "Test agent description",
      });
      expect(cortexcodeSubagent.getRelativeFilePath()).toBe("test-agent.md");
      expect(cortexcodeSubagent.getRelativeDirPath()).toBe(agentsDir);
    });

    it("should emit YAML frontmatter including cortexcode-section fields", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "rich-agent.md",
        frontmatter: {
          targets: ["cortexcode"],
          name: "rich-agent",
          description: "Rich agent description",
          cortexcode: {
            tools: ["read_file", "grep_search"],
            model: "claude-sonnet-4-5",
          },
        },
        body: "Rich agent body",
        validate: true,
      });

      const cortexcodeSubagent = CortexcodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
        validate: true,
      }) as CortexcodeSubagent;

      expect(cortexcodeSubagent.getFrontmatter()).toEqual({
        name: "rich-agent",
        description: "Rich agent description",
        tools: ["read_file", "grep_search"],
        model: "claude-sonnet-4-5",
      });

      const fileContent = cortexcodeSubagent.getFileContent();
      expect(fileContent).toContain("name: rich-agent");
      expect(fileContent).toContain("model: claude-sonnet-4-5");
      expect(fileContent).toContain("- grep_search");
      expect(fileContent).toContain("Rich agent body");
    });

    it("should let a cortexcode-section description override the shared one", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "override.md",
        frontmatter: {
          targets: ["cortexcode"],
          name: "override",
          description: "Shared description",
          cortexcode: { description: "Cortexcode-only description" },
        },
        body: "Body",
        validate: true,
      });

      const cortexcodeSubagent = CortexcodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
        validate: true,
      }) as CortexcodeSubagent;

      expect(cortexcodeSubagent.getFrontmatter().description).toBe("Cortexcode-only description");
    });

    it("should pass through unknown cortexcode-section keys", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "future.md",
        frontmatter: {
          targets: ["cortexcode"],
          name: "future",
          description: "Uses a not-yet-modelled key",
          cortexcode: { future_key: "value" },
        },
        body: "Body",
        validate: true,
      });

      const cortexcodeSubagent = CortexcodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
        validate: true,
      }) as CortexcodeSubagent;

      expect(cortexcodeSubagent.getFrontmatter()).toMatchObject({ future_key: "value" });
      expect(cortexcodeSubagent.getFileContent()).toContain("future_key: value");
    });

    it("should handle empty name and description", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: { targets: ["cortexcode"], name: "", description: "" },
        body: "Test content",
        validate: true,
      });

      const cortexcodeSubagent = CortexcodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
        validate: true,
      }) as CortexcodeSubagent;

      expect(cortexcodeSubagent.getFrontmatter()).toEqual({ name: "", description: "" });
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should convert to RulesyncSubagent and round-trip cortexcode-section fields", () => {
      const subagent = new CortexcodeSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "test-agent",
          description: "Test description",
          tools: ["read_file"],
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      expect(rulesyncSubagent).toBeInstanceOf(RulesyncSubagent);
      expect(rulesyncSubagent.getFrontmatter().name).toBe("test-agent");
      expect(rulesyncSubagent.getFrontmatter().description).toBe("Test description");
      expect(rulesyncSubagent.getFrontmatter().targets).toEqual(["*"]);
      expect(rulesyncSubagent.getFrontmatter().cortexcode).toEqual({
        tools: ["read_file"],
      });
      expect(rulesyncSubagent.getBody()).toBe("Test body");

      const roundTripped = CortexcodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
        validate: true,
      }) as CortexcodeSubagent;
      expect(roundTripped.getFrontmatter()).toEqual(subagent.getFrontmatter());
      expect(roundTripped.getBody()).toBe("Test body");
    });
  });

  describe("fromFile", () => {
    it("should load CortexcodeSubagent from file", async () => {
      const filePath = join(testDir, agentsDir, "code-reviewer.md");
      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await CortexcodeSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "code-reviewer.md",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(CortexcodeSubagent);
      expect(subagent.getRelativeDirPath()).toBe(agentsDir);
      expect(subagent.getRelativeFilePath()).toBe("code-reviewer.md");
      expect(subagent.getFrontmatter()).toEqual({
        name: "code-reviewer",
        description: "Reviews code for quality issues",
        tools: ["read_file", "grep_search"],
        model: "claude-sonnet-4-5",
      });
      expect(subagent.getBody()).toBe(
        "You are a senior code reviewer.\nFocus on correctness first.",
      );
    });

    it("should load from the home directory in global mode", async () => {
      const filePath = join(testDir, globalAgentsDir, "global-agent.md");
      await writeFileContent(
        filePath,
        "---\nname: global-agent\ndescription: Global\n---\n\nGlobal body",
      );

      const subagent = await CortexcodeSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "global-agent.md",
        validate: true,
        global: true,
      });

      expect(subagent.getFrontmatter().name).toBe("global-agent");
      expect(subagent.getBody()).toBe("Global body");
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        CortexcodeSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "missing.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should throw error when file contains invalid frontmatter", async () => {
      const filePath = join(testDir, agentsDir, "invalid.md");
      await writeFileContent(filePath, invalidMarkdownContent);

      await expect(
        CortexcodeSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "invalid.md",
          validate: true,
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });

    it("should throw error for file without frontmatter", async () => {
      const filePath = join(testDir, agentsDir, "plain.md");
      await writeFileContent(filePath, markdownWithoutFrontmatter);

      await expect(
        CortexcodeSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "plain.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const subagent = new CortexcodeSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        relativeFilePath: "test-agent.md",
        frontmatter: { name: "test-agent", description: "desc" },
        body: "Body",
        validate: true,
      });
      expect(subagent.validate()).toEqual({ success: true, error: null });
    });

    it("should return failure for invalid frontmatter", () => {
      const subagent = new CortexcodeSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        relativeFilePath: "test-agent.md",
        // @ts-expect-error - intentionally invalid
        frontmatter: { name: 1 },
        body: "Body",
        validate: false,
      });
      const result = subagent.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/Invalid frontmatter/);
    });
  });

  describe("forDeletion", () => {
    it("should create a placeholder instance without validation", () => {
      const subagent = CortexcodeSubagent.forDeletion({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        relativeFilePath: "old.md",
      });
      expect(subagent).toBeInstanceOf(CortexcodeSubagent);
      expect(subagent.getFileContent()).toBe("");
      expect(subagent.getRelativeFilePath()).toBe("old.md");
    });
  });

  describe("inheritance", () => {
    it("should be an instance of ToolSubagent", () => {
      const subagent = new CortexcodeSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        relativeFilePath: "test-agent.md",
        frontmatter: { name: "test-agent", description: "desc" },
        body: "Body",
        validate: true,
      });
      expect(subagent).toBeInstanceOf(ToolSubagent);
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    const build = (targets: RulesyncSubagentFrontmatter["targets"]) =>
      new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: { targets, name: "test-agent", description: "desc" },
        body: "Body",
        validate: true,
      });

    it("should return true when targets includes cortexcode", () => {
      expect(CortexcodeSubagent.isTargetedByRulesyncSubagent(build(["cortexcode"]))).toBe(true);
    });

    it("should return true when targets includes asterisk", () => {
      expect(CortexcodeSubagent.isTargetedByRulesyncSubagent(build(["*"]))).toBe(true);
    });

    it("should return false when targets does not include cortexcode", () => {
      expect(CortexcodeSubagent.isTargetedByRulesyncSubagent(build(["claudecode"]))).toBe(false);
    });

    it("should return false when targets array is empty", () => {
      expect(CortexcodeSubagent.isTargetedByRulesyncSubagent(build([]))).toBe(false);
    });
  });
});

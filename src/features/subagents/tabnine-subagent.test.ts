import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import { TabnineSubagent } from "./tabnine-subagent.js";
import { ToolSubagent } from "./tool-subagent.js";

describe("TabnineSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const agentsDir = join(".tabnine", "agent", "agents");

  const validMarkdownContent = `---
name: code-reviewer
description: Reviews code for quality issues
kind: local
tools:
  - read_file
  - grep_search
model: claude-sonnet-4-5
temperature: 0.2
max_turns: 10
timeout_mins: 3
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
    it("should return .tabnine/agent/agents for project scope", () => {
      expect(TabnineSubagent.getSettablePaths()).toEqual({
        relativeDirPath: agentsDir,
      });
    });

    it("should return the same relative path for global scope (resolved against the home dir)", () => {
      // Per https://docs.tabnine.com/main/getting-started/tabnine-cli/features/subagents
      // user-level subagents live at ~/.tabnine/agent/agents/*.md.
      expect(TabnineSubagent.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: agentsDir,
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid frontmatter", () => {
      const subagent = new TabnineSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "test-agent",
          description: "Test agent description",
          kind: "local",
        },
        body: "Agent body.\nIt can be multiline.",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(TabnineSubagent);
      expect(subagent.getBody()).toBe("Agent body.\nIt can be multiline.");
      expect(subagent.getFrontmatter()).toEqual({
        name: "test-agent",
        description: "Test agent description",
        kind: "local",
      });
    });

    it("should throw on invalid frontmatter when validation is enabled", () => {
      expect(
        () =>
          new TabnineSubagent({
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

    it("should reject a non-numeric temperature", () => {
      expect(
        () =>
          new TabnineSubagent({
            outputRoot: testDir,
            relativeDirPath: agentsDir,
            relativeFilePath: "test-agent.md",
            // @ts-expect-error - intentionally invalid
            frontmatter: { name: "x", description: "y", temperature: "hot" },
            body: "Body",
            validate: true,
          }),
      ).toThrow(/Invalid frontmatter/);
    });

    it("should skip validation when validate is false", () => {
      const subagent = new TabnineSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        relativeFilePath: "test-agent.md",
        // @ts-expect-error - intentionally invalid
        frontmatter: { invalid: true },
        body: "Body",
        validate: false,
      });
      expect(subagent).toBeInstanceOf(TabnineSubagent);
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should create TabnineSubagent from RulesyncSubagent", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["tabnine"],
          name: "test-agent",
          description: "Test agent description",
        },
        body: "Test agent content",
        validate: true,
      });

      const tabnineSubagent = TabnineSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
        validate: true,
      }) as TabnineSubagent;

      expect(tabnineSubagent).toBeInstanceOf(TabnineSubagent);
      expect(tabnineSubagent.getBody()).toBe("Test agent content");
      expect(tabnineSubagent.getFrontmatter()).toEqual({
        name: "test-agent",
        description: "Test agent description",
      });
      expect(tabnineSubagent.getRelativeFilePath()).toBe("test-agent.md");
      expect(tabnineSubagent.getRelativeDirPath()).toBe(agentsDir);
    });

    it("should emit YAML frontmatter including tabnine-section fields", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "rich-agent.md",
        frontmatter: {
          targets: ["tabnine"],
          name: "rich-agent",
          description: "Rich agent description",
          tabnine: {
            kind: "remote",
            tools: ["read_file", "grep_search"],
            model: "claude-sonnet-4-5",
            temperature: 0.2,
            max_turns: 10,
            timeout_mins: 3,
          },
        },
        body: "Rich agent body",
        validate: true,
      });

      const tabnineSubagent = TabnineSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
        validate: true,
      }) as TabnineSubagent;

      expect(tabnineSubagent.getFrontmatter()).toEqual({
        name: "rich-agent",
        description: "Rich agent description",
        kind: "remote",
        tools: ["read_file", "grep_search"],
        model: "claude-sonnet-4-5",
        temperature: 0.2,
        max_turns: 10,
        timeout_mins: 3,
      });

      const fileContent = tabnineSubagent.getFileContent();
      expect(fileContent).toContain("name: rich-agent");
      expect(fileContent).toContain("kind: remote");
      expect(fileContent).toContain("max_turns: 10");
      expect(fileContent).toContain("timeout_mins: 3");
      expect(fileContent).toContain("Rich agent body");
    });

    it("should let a tabnine-section description override the shared one", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "override.md",
        frontmatter: {
          targets: ["tabnine"],
          name: "override",
          description: "Shared description",
          tabnine: { description: "Tabnine-only description" },
        },
        body: "Body",
        validate: true,
      });

      const tabnineSubagent = TabnineSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
        validate: true,
      }) as TabnineSubagent;

      expect(tabnineSubagent.getFrontmatter().description).toBe("Tabnine-only description");
    });

    it("should refuse a subagent without a description, which Tabnine requires", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "no-description.md",
        frontmatter: { targets: ["tabnine"], name: "no-description" },
        body: "Body",
        validate: true,
      });

      expect(() =>
        TabnineSubagent.fromRulesyncSubagent({
          outputRoot: testDir,
          relativeDirPath: agentsDir,
          rulesyncSubagent,
          validate: true,
        }),
      ).toThrow(/Invalid tabnine subagent frontmatter in no-description\.md/);
    });

    it("should pass through unknown tabnine-section keys", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "future.md",
        frontmatter: {
          targets: ["tabnine"],
          name: "future",
          description: "Uses a not-yet-modelled key",
          tabnine: { future_key: "value" },
        },
        body: "Body",
        validate: true,
      });

      const tabnineSubagent = TabnineSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
        validate: true,
      }) as TabnineSubagent;

      expect(tabnineSubagent.getFrontmatter()).toMatchObject({ future_key: "value" });
      expect(tabnineSubagent.getFileContent()).toContain("future_key: value");
    });

    it("should handle empty name and description", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: { targets: ["tabnine"], name: "", description: "" },
        body: "Test content",
        validate: true,
      });

      const tabnineSubagent = TabnineSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
        validate: true,
      }) as TabnineSubagent;

      expect(tabnineSubagent.getFrontmatter()).toEqual({ name: "", description: "" });
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should convert to RulesyncSubagent and round-trip tabnine-section fields", () => {
      const subagent = new TabnineSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "test-agent",
          description: "Test description",
          kind: "local",
          tools: ["read_file"],
          max_turns: 7,
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      expect(rulesyncSubagent).toBeInstanceOf(RulesyncSubagent);
      expect(rulesyncSubagent.getFrontmatter().name).toBe("test-agent");
      expect(rulesyncSubagent.getFrontmatter().description).toBe("Test description");
      expect(rulesyncSubagent.getFrontmatter().targets).toEqual(["*"]);
      expect(rulesyncSubagent.getFrontmatter().tabnine).toEqual({
        kind: "local",
        tools: ["read_file"],
        max_turns: 7,
      });
      expect(rulesyncSubagent.getBody()).toBe("Test body");

      const roundTripped = TabnineSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
        validate: true,
      }) as TabnineSubagent;
      expect(roundTripped.getFrontmatter()).toEqual(subagent.getFrontmatter());
      expect(roundTripped.getBody()).toBe("Test body");
    });
  });

  describe("fromFile", () => {
    it("should load TabnineSubagent from file", async () => {
      const filePath = join(testDir, agentsDir, "code-reviewer.md");
      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await TabnineSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "code-reviewer.md",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(TabnineSubagent);
      expect(subagent.getRelativeDirPath()).toBe(agentsDir);
      expect(subagent.getRelativeFilePath()).toBe("code-reviewer.md");
      expect(subagent.getFrontmatter()).toEqual({
        name: "code-reviewer",
        description: "Reviews code for quality issues",
        kind: "local",
        tools: ["read_file", "grep_search"],
        model: "claude-sonnet-4-5",
        temperature: 0.2,
        max_turns: 10,
        timeout_mins: 3,
      });
      expect(subagent.getBody()).toBe(
        "You are a senior code reviewer.\nFocus on correctness first.",
      );
    });

    it("should load from the home directory in global mode", async () => {
      const filePath = join(testDir, agentsDir, "global-agent.md");
      await writeFileContent(
        filePath,
        "---\nname: global-agent\ndescription: Global\n---\n\nGlobal body",
      );

      const subagent = await TabnineSubagent.fromFile({
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
        TabnineSubagent.fromFile({
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
        TabnineSubagent.fromFile({
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
        TabnineSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "plain.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const subagent = new TabnineSubagent({
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
      const subagent = new TabnineSubagent({
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
      const subagent = TabnineSubagent.forDeletion({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        relativeFilePath: "old.md",
      });
      expect(subagent).toBeInstanceOf(TabnineSubagent);
      expect(subagent.getFileContent()).toBe("");
      expect(subagent.getRelativeFilePath()).toBe("old.md");
    });
  });

  describe("inheritance", () => {
    it("should be an instance of ToolSubagent", () => {
      const subagent = new TabnineSubagent({
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

    it("should return true when targets includes tabnine", () => {
      expect(TabnineSubagent.isTargetedByRulesyncSubagent(build(["tabnine"]))).toBe(true);
    });

    it("should return true when targets includes asterisk", () => {
      expect(TabnineSubagent.isTargetedByRulesyncSubagent(build(["*"]))).toBe(true);
    });

    it("should return false when targets does not include tabnine", () => {
      expect(TabnineSubagent.isTargetedByRulesyncSubagent(build(["claudecode"]))).toBe(false);
    });

    it("should return false when targets array is empty", () => {
      expect(TabnineSubagent.isTargetedByRulesyncSubagent(build([]))).toBe(false);
    });
  });
});

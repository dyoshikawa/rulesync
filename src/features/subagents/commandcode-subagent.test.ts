import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CommandcodeSubagent } from "./commandcode-subagent.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import { ToolSubagent } from "./tool-subagent.js";

describe("CommandcodeSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const agentsDir = join(".commandcode", "agents");

  const validMarkdownContent = `---
name: code-reviewer
description: Reviews code for quality issues
tools:
  - read_file
  - grep
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
    it("should return .commandcode/agents for project scope", () => {
      expect(CommandcodeSubagent.getSettablePaths()).toEqual({
        relativeDirPath: agentsDir,
      });
    });

    it("should return the same .commandcode/agents for global scope (resolved against the home dir)", () => {
      // Per https://commandcode.ai/docs/custom-agents user-level agents live at
      // ~/.commandcode/agents/*.md.
      expect(CommandcodeSubagent.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: agentsDir,
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid frontmatter", () => {
      const subagent = new CommandcodeSubagent({
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

      expect(subagent).toBeInstanceOf(CommandcodeSubagent);
      expect(subagent.getBody()).toBe("Agent body.\nIt can be multiline.");
      expect(subagent.getFrontmatter()).toEqual({
        name: "test-agent",
        description: "Test agent description",
      });
    });

    it("should throw on invalid frontmatter when validation is enabled", () => {
      expect(
        () =>
          new CommandcodeSubagent({
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

    it("should accept a comma-separated tools string", () => {
      const subagent = new CommandcodeSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        relativeFilePath: "test-agent.md",
        frontmatter: { name: "x", description: "y", tools: "read_file, grep" },
        body: "Body",
        validate: true,
      });
      expect(subagent.getFrontmatter().tools).toBe("read_file, grep");
    });

    it("should reject a non-boolean background value", () => {
      expect(
        () =>
          new CommandcodeSubagent({
            outputRoot: testDir,
            relativeDirPath: agentsDir,
            relativeFilePath: "test-agent.md",
            // @ts-expect-error - intentionally invalid
            frontmatter: { name: "x", description: "y", background: "yes" },
            body: "Body",
            validate: true,
          }),
      ).toThrow(/Invalid frontmatter/);
    });

    it("should skip validation when validate is false", () => {
      const subagent = new CommandcodeSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        relativeFilePath: "test-agent.md",
        // @ts-expect-error - intentionally invalid
        frontmatter: { invalid: true },
        body: "Body",
        validate: false,
      });
      expect(subagent).toBeInstanceOf(CommandcodeSubagent);
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should create CommandcodeSubagent from RulesyncSubagent", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["commandcode"],
          name: "test-agent",
          description: "Test agent description",
        },
        body: "Test agent content",
        validate: true,
      });

      const commandcodeSubagent = CommandcodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
        validate: true,
      }) as CommandcodeSubagent;

      expect(commandcodeSubagent).toBeInstanceOf(CommandcodeSubagent);
      expect(commandcodeSubagent.getBody()).toBe("Test agent content");
      expect(commandcodeSubagent.getFrontmatter()).toEqual({
        name: "test-agent",
        description: "Test agent description",
      });
      expect(commandcodeSubagent.getRelativeFilePath()).toBe("test-agent.md");
      expect(commandcodeSubagent.getRelativeDirPath()).toBe(agentsDir);
    });

    it.each(["review", "Explore", "plan", "general"])(
      "warns that %j is a reserved Command Code agent name (issue #3075)",
      (name) => {
        const logger = createMockLogger();
        const rulesyncSubagent = new RulesyncSubagent({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
          relativeFilePath: "reviewer.md",
          frontmatter: { targets: ["commandcode"], name, description: "Reviews code" },
          body: "Review.",
          validate: true,
        });

        const commandcodeSubagent = CommandcodeSubagent.fromRulesyncSubagent({
          outputRoot: testDir,
          relativeDirPath: agentsDir,
          rulesyncSubagent,
          validate: true,
          logger,
        }) as CommandcodeSubagent;

        // Still generated under the name — it is the user's to change — but
        // Command Code's loader drops it silently, so the warning says so.
        expect(commandcodeSubagent.getFrontmatter().name).toBe(name);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining(`reviewer.md: the name "${name}" is reserved`),
        );
      },
    );

    it("says nothing about a name Command Code does not reserve", () => {
      const logger = createMockLogger();
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "code-reviewer.md",
        frontmatter: { targets: ["commandcode"], name: "code-reviewer", description: "Reviews" },
        body: "Review.",
        validate: true,
      });

      CommandcodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
        validate: true,
        logger,
      });

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should emit YAML frontmatter including commandcode-section fields", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "rich-agent.md",
        frontmatter: {
          targets: ["commandcode"],
          name: "rich-agent",
          description: "Rich agent description",
          commandcode: {
            tools: ["read_file", "grep"],
            model: "claude-sonnet-4-5",
          },
        },
        body: "Rich agent body",
        validate: true,
      });

      const commandcodeSubagent = CommandcodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
        validate: true,
      }) as CommandcodeSubagent;

      expect(commandcodeSubagent.getFrontmatter()).toEqual({
        name: "rich-agent",
        description: "Rich agent description",
        tools: ["read_file", "grep"],
        model: "claude-sonnet-4-5",
      });

      const fileContent = commandcodeSubagent.getFileContent();
      expect(fileContent).toContain("name: rich-agent");
      expect(fileContent).toContain("model: claude-sonnet-4-5");
      expect(fileContent).toContain("- grep");
      expect(fileContent).toContain("Rich agent body");
    });

    it("should let a commandcode-section description override the shared one", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "override.md",
        frontmatter: {
          targets: ["commandcode"],
          name: "override",
          description: "Shared description",
          commandcode: { description: "Command Code-only description" },
        },
        body: "Body",
        validate: true,
      });

      const commandcodeSubagent = CommandcodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
        validate: true,
      }) as CommandcodeSubagent;

      expect(commandcodeSubagent.getFrontmatter().description).toBe(
        "Command Code-only description",
      );
    });

    it("should pass through unknown commandcode-section keys", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "future.md",
        frontmatter: {
          targets: ["commandcode"],
          name: "future",
          description: "Uses a not-yet-modelled key",
          commandcode: { future_key: "value" },
        },
        body: "Body",
        validate: true,
      });

      const commandcodeSubagent = CommandcodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
        validate: true,
      }) as CommandcodeSubagent;

      expect(commandcodeSubagent.getFrontmatter()).toMatchObject({ future_key: "value" });
      expect(commandcodeSubagent.getFileContent()).toContain("future_key: value");
    });

    it("should handle empty name and description", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: { targets: ["commandcode"], name: "", description: "" },
        body: "Test content",
        validate: true,
      });

      const commandcodeSubagent = CommandcodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
        validate: true,
      }) as CommandcodeSubagent;

      expect(commandcodeSubagent.getFrontmatter()).toEqual({ name: "", description: "" });
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should convert to RulesyncSubagent and round-trip commandcode-section fields", () => {
      const subagent = new CommandcodeSubagent({
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
      expect(rulesyncSubagent.getFrontmatter().commandcode).toEqual({
        tools: ["read_file"],
      });
      expect(rulesyncSubagent.getBody()).toBe("Test body");

      const roundTripped = CommandcodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
        validate: true,
      }) as CommandcodeSubagent;
      expect(roundTripped.getFrontmatter()).toEqual(subagent.getFrontmatter());
      expect(roundTripped.getBody()).toBe("Test body");
    });
  });

  describe("fromFile", () => {
    it("should load CommandcodeSubagent from file", async () => {
      const filePath = join(testDir, agentsDir, "code-reviewer.md");
      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await CommandcodeSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "code-reviewer.md",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(CommandcodeSubagent);
      expect(subagent.getRelativeDirPath()).toBe(agentsDir);
      expect(subagent.getRelativeFilePath()).toBe("code-reviewer.md");
      expect(subagent.getFrontmatter()).toEqual({
        name: "code-reviewer",
        description: "Reviews code for quality issues",
        tools: ["read_file", "grep"],
        model: "claude-sonnet-4-5",
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

      const subagent = await CommandcodeSubagent.fromFile({
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
        CommandcodeSubagent.fromFile({
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
        CommandcodeSubagent.fromFile({
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
        CommandcodeSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "plain.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const subagent = new CommandcodeSubagent({
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
      const subagent = new CommandcodeSubagent({
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
      const subagent = CommandcodeSubagent.forDeletion({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        relativeFilePath: "old.md",
      });
      expect(subagent).toBeInstanceOf(CommandcodeSubagent);
      expect(subagent.getFileContent()).toBe("");
      expect(subagent.getRelativeFilePath()).toBe("old.md");
    });
  });

  describe("inheritance", () => {
    it("should be an instance of ToolSubagent", () => {
      const subagent = new CommandcodeSubagent({
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

    it("should return true when targets includes commandcode", () => {
      expect(CommandcodeSubagent.isTargetedByRulesyncSubagent(build(["commandcode"]))).toBe(true);
    });

    it("should return true when targets includes asterisk", () => {
      expect(CommandcodeSubagent.isTargetedByRulesyncSubagent(build(["*"]))).toBe(true);
    });

    it("should return false when targets does not include commandcode", () => {
      expect(CommandcodeSubagent.isTargetedByRulesyncSubagent(build(["claudecode"]))).toBe(false);
    });

    it("should return false when targets array is empty", () => {
      expect(CommandcodeSubagent.isTargetedByRulesyncSubagent(build([]))).toBe(false);
    });
  });
});

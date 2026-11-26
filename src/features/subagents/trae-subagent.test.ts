import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncSubagent, type RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import { ToolSubagent } from "./tool-subagent.js";
import { TraeSubagent } from "./trae-subagent.js";

describe("TraeSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const agentsDir = join(".trae", "agents");

  const createRulesyncSubagent = (
    frontmatter: RulesyncSubagentFrontmatter,
    body = "You are a code reviewer.",
  ) =>
    new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "code-reviewer.md",
      frontmatter,
      body,
      validate: true,
    });

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
    it("should return .trae/agents", () => {
      expect(TraeSubagent.getSettablePaths()).toEqual({ relativeDirPath: agentsDir });
    });
  });

  describe("constructor", () => {
    it("should throw when a required field is missing", () => {
      expect(
        () =>
          new TraeSubagent({
            outputRoot: testDir,
            relativeDirPath: agentsDir,
            relativeFilePath: "x.md",
            // oxlint-disable-next-line no-unsafe-type-assertion -- deliberately invalid
            frontmatter: { name: "x" } as never,
            body: "",
            validate: true,
          }),
      ).toThrow();
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should write name, description and the trae section to .trae/agents", () => {
      const subagent = TraeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        rulesyncSubagent: createRulesyncSubagent({
          targets: ["*"],
          name: "code-reviewer",
          description: "Reviews code",
          trae: {
            model: "GPT-5",
            tools: ["Read", "Grep"],
            disallowedTools: "RunCommand",
            mcpServers: ["github"],
          },
        }),
      }) as TraeSubagent;

      expect(subagent.getRelativeDirPath()).toBe(agentsDir);
      expect(subagent.getRelativeFilePath()).toBe("code-reviewer.md");
      expect(subagent.getFrontmatter()).toEqual({
        name: "code-reviewer",
        description: "Reviews code",
        model: "GPT-5",
        tools: ["Read", "Grep"],
        disallowedTools: "RunCommand",
        mcpServers: ["github"],
      });
      const content = subagent.getFileContent();
      expect(content).toContain("name: code-reviewer");
      expect(content).toContain("disallowedTools: RunCommand");
      expect(content).toContain("You are a code reviewer.");
    });

    it("should let a trae-section description override the shared one", () => {
      const subagent = TraeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        rulesyncSubagent: createRulesyncSubagent({
          targets: ["*"],
          name: "code-reviewer",
          description: "Shared",
          trae: { description: "Trae only" },
        }),
      }) as TraeSubagent;

      expect(subagent.getFrontmatter().description).toBe("Trae only");
    });

    it("should fill in a placeholder description, which Trae requires, and warn", () => {
      const logger = createMockLogger();
      const subagent = TraeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        rulesyncSubagent: createRulesyncSubagent({ targets: ["*"], name: "code-reviewer" }),
        logger,
      }) as TraeSubagent;

      expect(subagent.getFrontmatter().description).toBe("code-reviewer subagent");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("no description"));
    });

    it("should not warn for a valid 50-character name", () => {
      const logger = createMockLogger();
      const name = `a${"b".repeat(49)}`;
      TraeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        rulesyncSubagent: createRulesyncSubagent({ targets: ["*"], name, description: "d" }),
        logger,
      });

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it.each([
      { case: "longer than 50 characters", name: `a${"b".repeat(50)}` },
      { case: "starting with a digit", name: "1-reviewer" },
      { case: "ending with a hyphen", name: "reviewer-" },
      { case: "holding an underscore", name: "code_reviewer" },
    ])("should keep but warn about a name $case", ({ name }) => {
      const logger = createMockLogger();
      const subagent = TraeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        rulesyncSubagent: createRulesyncSubagent({ targets: ["*"], name, description: "d" }),
        logger,
      }) as TraeSubagent;

      expect(subagent.getFrontmatter().name).toBe(name);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("which Trae rejects"));
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should round-trip the trae-specific fields through the trae section", () => {
      const subagent = new TraeSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        relativeFilePath: "code-reviewer.md",
        frontmatter: {
          name: "code-reviewer",
          description: "Reviews code",
          tools: "Read, Grep",
          mcpServers: ["github"],
        },
        body: "Body",
        validate: true,
      });

      const rulesync = subagent.toRulesyncSubagent();
      expect(rulesync.getFrontmatter()).toEqual({
        targets: ["*"],
        name: "code-reviewer",
        description: "Reviews code",
        trae: { tools: "Read, Grep", mcpServers: ["github"] },
      });
      expect(rulesync.getBody()).toBe("Body");
    });
  });

  describe("fromFile", () => {
    it("should load a subagent from .trae/agents", async () => {
      await writeFileContent(
        join(testDir, agentsDir, "code-reviewer.md"),
        `---
name: code-reviewer
description: Reviews code
model: GPT-5
---

You are a code reviewer.`,
      );

      const subagent = await TraeSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "code-reviewer.md",
      });

      expect(subagent).toBeInstanceOf(TraeSubagent);
      expect(subagent.getFrontmatter()).toEqual({
        name: "code-reviewer",
        description: "Reviews code",
        model: "GPT-5",
      });
      expect(subagent.getBody()).toBe("You are a code reviewer.");
    });

    it("should throw for a file whose frontmatter lacks the description", async () => {
      await writeFileContent(
        join(testDir, agentsDir, "bad.md"),
        `---
name: bad
---

Body`,
      );

      await expect(
        TraeSubagent.fromFile({ outputRoot: testDir, relativeFilePath: "bad.md" }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });
  });

  describe("forDeletion", () => {
    it("should create a placeholder instance without validation", () => {
      const subagent = TraeSubagent.forDeletion({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        relativeFilePath: "old.md",
      });

      expect(subagent).toBeInstanceOf(ToolSubagent);
      expect(subagent.getRelativeFilePath()).toBe("old.md");
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it.each([
      { targets: ["trae"], expected: true },
      { targets: ["*"], expected: true },
      { targets: ["cursor"], expected: false },
    ])("should return $expected for targets $targets", ({ targets, expected }) => {
      const rulesyncSubagent = createRulesyncSubagent({
        // oxlint-disable-next-line no-unsafe-type-assertion -- test fixture
        targets: targets as RulesyncSubagentFrontmatter["targets"],
        name: "code-reviewer",
        description: "d",
      });
      expect(TraeSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(expected);
    });
  });
});

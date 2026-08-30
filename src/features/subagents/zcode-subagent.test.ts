import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ZCODE_AGENTS_DIR_PATH } from "../../constants/zcode-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { SubagentsProcessor, toolSubagentFactories } from "./subagents-processor.js";
import { ToolSubagent } from "./tool-subagent.js";
import { ZcodeSubagent } from "./zcode-subagent.js";

describe("ZcodeSubagent", () => {
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

  describe("getSettablePaths", () => {
    it("should return .zcode/agents for both modes", () => {
      expect(ZcodeSubagent.getSettablePaths()).toEqual({
        relativeDirPath: join(".zcode", "agents"),
      });
      expect(ZcodeSubagent.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".zcode", "agents"),
      });
    });
  });

  describe("scope registration", () => {
    it("should be offered for global mode only", () => {
      expect(toolSubagentFactories.get("zcode")?.meta).toEqual({
        supportsProject: false,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
      });
      expect(SubagentsProcessor.getToolTargets({ global: true })).toContain("zcode");
      expect(SubagentsProcessor.getToolTargets()).not.toContain("zcode");
      expect(SubagentsProcessor.getToolTargets({ includeSimulated: true })).not.toContain("zcode");
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should map name/description and round-trip zcode-specific fields", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "reviewer.md",
        frontmatter: {
          targets: ["zcode"],
          name: "reviewer",
          description: "Reviews code",
          zcode: {
            model: "glm-4.6",
            thoughtLevel: "high",
            color: "blue",
            tools: ["Read", "Edit"],
            disallowedTools: ["Bash"],
            maxTurns: 10,
            injectAgentsMd: false,
            mcpServers: ["context7"],
          },
        },
        body: "Review the code carefully.",
        validate: true,
      });

      const subagent = ZcodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ZCODE_AGENTS_DIR_PATH,
        rulesyncSubagent,
        global: true,
        validate: true,
      }) as ZcodeSubagent;

      expect(subagent).toBeInstanceOf(ZcodeSubagent);
      expect(subagent.getFrontmatter()).toEqual({
        name: "reviewer",
        description: "Reviews code",
        model: "glm-4.6",
        thoughtLevel: "high",
        color: "blue",
        tools: ["Read", "Edit"],
        disallowedTools: ["Bash"],
        maxTurns: 10,
        injectAgentsMd: false,
        mcpServers: ["context7"],
      });
      expect(subagent.getBody()).toBe("Review the code carefully.");
      expect(subagent.getRelativeDirPath()).toBe(join(".zcode", "agents"));
      expect(subagent.getFileContent()).toContain("thoughtLevel: high");
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should round-trip tool-specific fields into the zcode section", () => {
      const subagent = new ZcodeSubagent({
        outputRoot: testDir,
        relativeDirPath: ZCODE_AGENTS_DIR_PATH,
        relativeFilePath: "reviewer.md",
        frontmatter: {
          name: "reviewer",
          description: "Reviews code",
          model: "glm-4.6",
          maxTurns: 3,
        },
        body: "Body",
        validate: true,
      });

      const frontmatter = subagent.toRulesyncSubagent().getFrontmatter();
      expect(frontmatter.name).toBe("reviewer");
      expect(frontmatter.description).toBe("Reviews code");
      expect(frontmatter.zcode).toEqual({ model: "glm-4.6", maxTurns: 3 });
    });

    it("should omit the zcode section when there are no extra fields", () => {
      const subagent = new ZcodeSubagent({
        outputRoot: testDir,
        relativeDirPath: ZCODE_AGENTS_DIR_PATH,
        relativeFilePath: "plain.md",
        frontmatter: { name: "plain", description: "Plain agent" },
        body: "Body",
        validate: true,
      });

      expect(subagent.toRulesyncSubagent().getFrontmatter().zcode).toBeUndefined();
    });
  });

  describe("fromFile", () => {
    it("should load a subagent from .zcode/agents", async () => {
      const fileContent = `---
name: reviewer
description: Reviews code
color: red
tools:
  - Read
disallowedTools:
  - Bash
maxTurns: 5
injectAgentsMd: false
---

Review carefully.`;
      await writeFileContent(join(testDir, ".zcode", "agents", "reviewer.md"), fileContent);

      const subagent = await ZcodeSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "reviewer.md",
        global: true,
        validate: true,
      });

      expect(subagent.getFrontmatter()).toEqual({
        name: "reviewer",
        description: "Reviews code",
        color: "red",
        tools: ["Read"],
        disallowedTools: ["Bash"],
        maxTurns: 5,
        injectAgentsMd: false,
      });
      expect(subagent.getBody()).toBe("Review carefully.");
    });

    it("should throw for invalid frontmatter", async () => {
      await writeFileContent(
        join(testDir, ".zcode", "agents", "bad.md"),
        `---\ninvalid: true\n---\n\nBody`,
      );
      await expect(
        ZcodeSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "bad.md",
          global: true,
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should return true for zcode and wildcard targets", () => {
      const make = (targets: string[]) =>
        new RulesyncSubagent({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
          relativeFilePath: "a.md",
          frontmatter: { targets: targets as never, name: "a", description: "d" },
          body: "b",
          validate: false,
        });

      expect(ZcodeSubagent.isTargetedByRulesyncSubagent(make(["zcode"]))).toBe(true);
      expect(ZcodeSubagent.isTargetedByRulesyncSubagent(make(["*"]))).toBe(true);
      expect(ZcodeSubagent.isTargetedByRulesyncSubagent(make(["cursor"]))).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create a deletable instance", () => {
      const subagent = ZcodeSubagent.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ZCODE_AGENTS_DIR_PATH,
        relativeFilePath: "reviewer.md",
      });
      expect(subagent).toBeInstanceOf(ToolSubagent);
      expect(subagent.isDeletable()).toBe(true);
    });
  });
});

import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CopilotSubagent } from "./copilot-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("CopilotSubagent", () => {
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

  const validContent = `---
name: planner
description: Plan things
tools:
  - web/fetch
---

Plan tasks`;

  describe("getSettablePaths", () => {
    it("returns Copilot agents directory", () => {
      expect(CopilotSubagent.getSettablePaths()).toEqual({
        relativeDirPath: ".github/agents",
      });
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("merges user tools with required agent/runSubagent", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "planner.agent.md",
        frontmatter: {
          targets: ["copilot"],
          name: "planner",
          description: "Plan things",
          copilot: {
            tools: ["web/fetch", "agent/runSubagent"],
            permissions: "workspace",
          },
        },
        body: "Plan tasks",
        validate: true,
      });

      const subagent = CopilotSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        rulesyncSubagent,
        validate: true,
      }) as CopilotSubagent;

      expect(subagent.getFrontmatter().tools).toEqual(["agent/runSubagent", "web/fetch"]);
      expect(subagent.getFrontmatter()).toMatchObject({ permissions: "workspace" });
      expect(subagent.getRelativeDirPath()).toBe(".github/agents");
    });

    it("adds required tool when user tools are missing", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "planner.md",
        frontmatter: {
          targets: ["copilot"],
          name: "planner",
          description: "Plan things",
          copilot: {},
        },
        body: "Plan tasks",
        validate: true,
      });

      const subagent = CopilotSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        rulesyncSubagent,
        validate: true,
      }) as CopilotSubagent;

      expect(subagent.getFrontmatter().tools).toEqual(["agent/runSubagent"]);
    });
  });

  describe("toRulesyncSubagent", () => {
    it("creates rulesync file with copilot section", () => {
      const subagent = new CopilotSubagent({
        baseDir: testDir,
        relativeDirPath: ".github/agents",
        relativeFilePath: "planner.agent.md",
        frontmatter: {
          name: "planner",
          description: "Plan things",
          tools: ["agent/runSubagent", "web/fetch"],
        },
        body: "Plan tasks",
        fileContent: validContent,
        validate: true,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();

      expect(rulesyncSubagent.getFrontmatter()).toMatchObject({
        targets: ["*"],
        name: "planner",
        description: "Plan things",
        copilot: { tools: ["agent/runSubagent", "web/fetch"] },
      });
      expect(rulesyncSubagent.getBody()).toBe("Plan tasks");
    });
  });

  describe("fromFile", () => {
    it("loads Copilot subagent from file", async () => {
      const agentsDir = join(testDir, ".github", "agents");
      await writeFileContent(join(agentsDir, "planner.agent.md"), validContent);

      const subagent = await CopilotSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "planner.agent.md",
      });

      expect(subagent.getFrontmatter()).toMatchObject({
        name: "planner",
        description: "Plan things",
        tools: ["web/fetch"],
      });
      expect(subagent.getBody()).toBe("Plan tasks");
    });
  });

  describe("validate", () => {
    it("validates required fields", () => {
      const subagent = new CopilotSubagent({
        baseDir: testDir,
        relativeDirPath: ".github/agents",
        relativeFilePath: "planner.agent.md",
        frontmatter: {
          name: "planner",
          description: "Plan things",
        },
        body: "Plan tasks",
        fileContent: validContent,
        validate: false,
      });

      expect(subagent.validate().success).toBe(true);
    });

    it("fails for invalid frontmatter", () => {
      expect(
        () =>
          new CopilotSubagent({
            baseDir: testDir,
            relativeDirPath: ".github/agents",
            relativeFilePath: "invalid.agent.md",
            frontmatter: { description: "missing name" } as any,
            body: "",
            fileContent: "",
            validate: true,
          }),
      ).toThrow();
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("returns true for copilot target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "planner.md",
        frontmatter: { targets: ["copilot"], name: "planner", description: "Plan" },
        body: "Plan",
      });

      expect(CopilotSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("returns false for other target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "planner.md",
        frontmatter: { targets: ["cursor"], name: "planner", description: "Plan" },
        body: "Plan",
      });

      expect(CopilotSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(false);
    });
  });
});

import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CopilotcliSubagent } from "./copilotcli-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("CopilotcliSubagent", () => {
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

  describe("getSettablePaths", () => {
    it("should return .github/agents in project mode", () => {
      const paths = CopilotcliSubagent.getSettablePaths();
      expect(paths).toEqual({ relativeDirPath: join(".github", "agents") });
    });

    it("should return .copilot/agents in global mode", () => {
      const paths = CopilotcliSubagent.getSettablePaths({ global: true });
      expect(paths).toEqual({ relativeDirPath: join(".copilot", "agents") });
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should generate <stem>.agent.md under .github/agents in project mode", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "planner.md",
        frontmatter: {
          targets: ["copilotcli"],
          name: "planner",
          description: "Plans changes carefully",
        },
        body: "Plan thoroughly before editing.",
        validate: false,
      });

      const subagent = CopilotcliSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".github", "agents"),
        rulesyncSubagent,
        validate: false,
      });

      expect(subagent.getRelativeDirPath()).toBe(join(".github", "agents"));
      expect(subagent.getRelativeFilePath()).toBe("planner.agent.md");
      expect(subagent.getFileContent()).toContain("description: Plans changes carefully");
      expect(subagent.getFileContent()).toContain("name: planner");
    });

    it("should write to .copilot/agents when global=true", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "planner.md",
        frontmatter: {
          targets: ["copilotcli"],
          name: "planner",
          description: "Plans changes carefully",
        },
        body: "Plan thoroughly before editing.",
        validate: false,
      });

      const subagent = CopilotcliSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".copilot", "agents"),
        rulesyncSubagent,
        validate: false,
        global: true,
      });

      expect(subagent.getRelativeDirPath()).toBe(join(".copilot", "agents"));
      expect(subagent.getRelativeFilePath()).toBe("planner.agent.md");
    });

    it("should let copilotcli-specific frontmatter override rulesync defaults", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "security.md",
        frontmatter: {
          targets: ["copilotcli"],
          name: "security",
          description: "rulesync description",
          copilotcli: {
            description: "Copilot CLI description",
            model: "claude-3-5-sonnet-20241022",
            tools: ["read", "edit"],
          },
        },
        body: "Find vulnerabilities.",
        validate: false,
      });

      const subagent = CopilotcliSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".github", "agents"),
        rulesyncSubagent,
        validate: false,
      }) as CopilotcliSubagent;

      const fm = subagent.getFrontmatter();
      expect(fm.description).toBe("Copilot CLI description");
      expect(fm.model).toBe("claude-3-5-sonnet-20241022");
      expect(fm.tools).toEqual(["read", "edit"]);
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should preserve description and round-trip via copilotcli section", () => {
      const subagent = new CopilotcliSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".github", "agents"),
        relativeFilePath: "planner.agent.md",
        frontmatter: {
          name: "planner",
          description: "Plans changes",
          model: "claude-3-5-sonnet-20241022",
        },
        body: "Body",
        fileContent: "",
        validate: false,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      const fm = rulesyncSubagent.getFrontmatter();
      expect(fm.name).toBe("planner");
      expect(fm.description).toBe("Plans changes");
      expect(fm.copilotcli).toMatchObject({
        model: "claude-3-5-sonnet-20241022",
      });
      expect(rulesyncSubagent.getRelativeFilePath()).toBe("planner.md");
    });

    it("should derive name from filename when frontmatter omits it", () => {
      const subagent = new CopilotcliSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".github", "agents"),
        relativeFilePath: "fallback-name.agent.md",
        frontmatter: { description: "Any" },
        body: "Body",
        fileContent: "",
        validate: false,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      expect(rulesyncSubagent.getFrontmatter().name).toBe("fallback-name");
    });
  });

  describe("fromFile", () => {
    it("should load <stem>.agent.md from project .github/agents", async () => {
      const dir = join(testDir, ".github", "agents");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "planner.agent.md"),
        `---\nname: planner\ndescription: Plans changes\n---\n\nBody content.\n`,
      );

      const subagent = await CopilotcliSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "planner.agent.md",
        validate: false,
      });

      expect(subagent).toBeInstanceOf(CopilotcliSubagent);
      expect(subagent.getRelativeDirPath()).toBe(join(".github", "agents"));
      expect(subagent.getFrontmatter().description).toBe("Plans changes");
    });

    it("should load <stem>.agent.md from global .copilot/agents when global=true", async () => {
      const dir = join(testDir, ".copilot", "agents");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "global.agent.md"),
        `---\nname: global\ndescription: Global one\n---\n\nBody.\n`,
      );

      const subagent = await CopilotcliSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "global.agent.md",
        validate: false,
        global: true,
      });

      expect(subagent.getRelativeDirPath()).toBe(join(".copilot", "agents"));
      expect(subagent.getFrontmatter().description).toBe("Global one");
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should target rulesync subagents that include copilotcli", () => {
      const targeted = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "x.md",
        frontmatter: {
          targets: ["copilotcli"],
          name: "x",
          description: "x",
        },
        body: "body",
        validate: false,
      });
      expect(CopilotcliSubagent.isTargetedByRulesyncSubagent(targeted)).toBe(true);

      const notTargeted = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "x.md",
        frontmatter: {
          targets: ["claudecode"],
          name: "x",
          description: "x",
        },
        body: "body",
        validate: false,
      });
      expect(CopilotcliSubagent.isTargetedByRulesyncSubagent(notTargeted)).toBe(false);
    });
  });
});

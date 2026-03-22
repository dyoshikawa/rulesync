import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { DeepagentsSubagent } from "./deepagents-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("DeepagentsSubagent", () => {
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
    it("should return .deepagents/agents", () => {
      const paths = DeepagentsSubagent.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".deepagents", "agents"));
    });
  });

  describe("constructor", () => {
    it("should create with name and description", () => {
      const subagent = new DeepagentsSubagent({
        baseDir: testDir,
        relativeDirPath: join(".deepagents", "agents"),
        relativeFilePath: "my-agent.md",
        frontmatter: { name: "My Agent", description: "Does useful things." },
        body: "You are a helpful agent.",
        fileContent: "",
      });

      expect(subagent.getFrontmatter().name).toBe("My Agent");
      expect(subagent.getBody()).toBe("You are a helpful agent.");
    });

    it("should create with optional model field", () => {
      const subagent = new DeepagentsSubagent({
        baseDir: testDir,
        relativeDirPath: join(".deepagents", "agents"),
        relativeFilePath: "my-agent.md",
        frontmatter: { name: "Agent", description: "Desc.", model: "claude-sonnet-4-6" },
        body: "System prompt.",
        fileContent: "",
      });

      expect(subagent.getFrontmatter().model).toBe("claude-sonnet-4-6");
    });
  });

  describe("fromFile", () => {
    it("should read subagent from .deepagents/agents/<name>.md", async () => {
      const agentsDir = join(testDir, ".deepagents", "agents");
      await ensureDir(agentsDir);
      const content = `---
name: Test Agent
description: A test agent.
model: claude-haiku-4-5-20251001
---

You are a test agent.`;
      await writeFileContent(join(agentsDir, "test-agent.md"), content);

      const subagent = await DeepagentsSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-agent.md",
      });

      expect(subagent.getFrontmatter().name).toBe("Test Agent");
      expect(subagent.getFrontmatter().model).toBe("claude-haiku-4-5-20251001");
      expect(subagent.getBody()).toBe("You are a test agent.");
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should map name and description", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "my-agent.md",
        frontmatter: { name: "My Agent", description: "Does things.", targets: ["deepagents"] },
        body: "You are an agent.",
      });

      const subagent = DeepagentsSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: join(".deepagents", "agents"),
        rulesyncSubagent,
      }) as DeepagentsSubagent;

      expect(subagent.getFrontmatter().name).toBe("My Agent");
      expect(subagent.getFrontmatter().description).toBe("Does things.");
    });

    it("should pull model from deepagents tool-specific section", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "my-agent.md",
        frontmatter: {
          name: "Agent",
          description: "Desc.",
          targets: ["deepagents"],
          deepagents: { model: "claude-sonnet-4-6" },
        },
        body: "System prompt.",
      });

      const subagent = DeepagentsSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: join(".deepagents", "agents"),
        rulesyncSubagent,
      }) as DeepagentsSubagent;

      expect(subagent.getFrontmatter().model).toBe("claude-sonnet-4-6");
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should return true for deepagents target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "agent.md",
        frontmatter: { name: "Agent", targets: ["deepagents"] },
        body: "",
      });

      expect(DeepagentsSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return true for wildcard target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "agent.md",
        frontmatter: { name: "Agent", targets: ["*"] },
        body: "",
      });

      expect(DeepagentsSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return false for different tool", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "agent.md",
        frontmatter: { name: "Agent", targets: ["claudecode"] },
        body: "",
      });

      expect(DeepagentsSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(false);
    });
  });
});

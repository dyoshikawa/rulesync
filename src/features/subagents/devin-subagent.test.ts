import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { DevinSubagent } from "./devin-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("DevinSubagent", () => {
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
    it("should return .devin/agents for project mode", () => {
      const paths = DevinSubagent.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".devin", "agents"));
    });

    it("should return ~/.config/devin/agents for global mode", () => {
      const paths = DevinSubagent.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".config", "devin", "agents"));
    });
  });

  describe("constructor", () => {
    it("should create with name and description", () => {
      const subagent = new DevinSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "agents"),
        relativeFilePath: join("my-agent", "AGENT.md"),
        frontmatter: { name: "My Agent", description: "Does useful things." },
        body: "You are a helpful agent.",
      });

      expect(subagent.getFrontmatter().name).toBe("My Agent");
      expect(subagent.getBody()).toBe("You are a helpful agent.");
    });

    it("should create with Devin-specific optional fields", () => {
      const subagent = new DevinSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "agents"),
        relativeFilePath: join("my-agent", "AGENT.md"),
        frontmatter: {
          name: "Agent",
          description: "Desc.",
          model: "claude-sonnet-4-6",
          "allowed-tools": ["read", "search"],
          permissions: { allow: ["read"], deny: ["write"] },
          "max-nesting": 2,
        },
        body: "System prompt.",
      });

      expect(subagent.getFrontmatter().model).toBe("claude-sonnet-4-6");
      expect(subagent.getFrontmatter()["allowed-tools"]).toEqual(["read", "search"]);
      expect(subagent.getFrontmatter().permissions).toEqual({
        allow: ["read"],
        deny: ["write"],
      });
      expect(subagent.getFrontmatter()["max-nesting"]).toBe(2);
    });
  });

  describe("fromFile", () => {
    it("should read subagent from .devin/agents/<name>/AGENT.md", async () => {
      const agentDir = join(testDir, ".devin", "agents", "test-agent");
      await ensureDir(agentDir);
      const content = `---
name: Test Agent
description: A test agent.
model: claude-haiku-4-5-20251001
---

You are a test agent.`;
      await writeFileContent(join(agentDir, "AGENT.md"), content);

      const subagent = await DevinSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: join("test-agent", "AGENT.md"),
      });

      expect(subagent.getFrontmatter().name).toBe("Test Agent");
      expect(subagent.getFrontmatter().model).toBe("claude-haiku-4-5-20251001");
      expect(subagent.getBody()).toBe("You are a test agent.");
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should map name and description and emit <name>/AGENT.md", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "my-agent.md",
        frontmatter: { name: "My Agent", description: "Does things.", targets: ["devin"] },
        body: "You are an agent.",
      });

      const subagent = DevinSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "agents"),
        rulesyncSubagent,
      }) as DevinSubagent;

      expect(subagent.getFrontmatter().name).toBe("My Agent");
      expect(subagent.getFrontmatter().description).toBe("Does things.");
      expect(subagent.getRelativeDirPath()).toBe(join(".devin", "agents"));
      expect(subagent.getRelativeFilePath()).toBe(join("my-agent", "AGENT.md"));
    });

    it("should pull Devin-specific fields from the devin tool-specific section", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "my-agent.md",
        frontmatter: {
          name: "Agent",
          description: "Desc.",
          targets: ["devin"],
          devin: {
            model: "claude-sonnet-4-6",
            "allowed-tools": ["read"],
            "max-nesting": 1,
          },
        },
        body: "System prompt.",
      });

      const subagent = DevinSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "agents"),
        rulesyncSubagent,
      }) as DevinSubagent;

      expect(subagent.getFrontmatter().model).toBe("claude-sonnet-4-6");
      expect(subagent.getFrontmatter()["allowed-tools"]).toEqual(["read"]);
      expect(subagent.getFrontmatter()["max-nesting"]).toBe(1);
    });

    it("should emit <name>/AGENT.md in global mode", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "my-agent.md",
        frontmatter: { name: "My Agent", description: "Does things.", targets: ["devin"] },
        body: "You are an agent.",
      });

      const subagent = DevinSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "agents"),
        rulesyncSubagent,
        global: true,
      }) as DevinSubagent;

      expect(subagent.getRelativeDirPath()).toBe(join(".config", "devin", "agents"));
      expect(subagent.getRelativeFilePath()).toBe(join("my-agent", "AGENT.md"));
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should convert back to rulesync subagent preserving name and body", () => {
      const subagent = new DevinSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "agents"),
        relativeFilePath: join("my-agent", "AGENT.md"),
        frontmatter: { name: "My Agent", description: "Does things.", model: "claude-sonnet-4-6" },
        body: "You are an agent.",
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      const frontmatter = rulesyncSubagent.getFrontmatter();

      expect(frontmatter.name).toBe("My Agent");
      expect(frontmatter.description).toBe("Does things.");
      expect(rulesyncSubagent.getBody()).toBe("You are an agent.");
      // The directory name (not the AGENT.md filename) becomes the flat rulesync file.
      expect(rulesyncSubagent.getRelativeFilePath()).toBe("my-agent.md");
    });

    it("should store Devin-specific fields in the devin tool-specific section", () => {
      const subagent = new DevinSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "agents"),
        relativeFilePath: join("my-agent", "AGENT.md"),
        frontmatter: {
          name: "Agent",
          description: "Desc.",
          model: "claude-haiku-4-5-20251001",
          "max-nesting": 3,
        },
        body: "System prompt.",
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      const devinSection = rulesyncSubagent.getFrontmatter().devin as Record<string, unknown>;

      expect(devinSection?.model).toBe("claude-haiku-4-5-20251001");
      expect(devinSection?.["max-nesting"]).toBe(3);
    });
  });

  describe("forDeletion", () => {
    it("should create a deletable placeholder for <name>/AGENT.md", () => {
      const subagent = DevinSubagent.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "agents"),
        relativeFilePath: join("orphan", "AGENT.md"),
      });

      expect(subagent.getRelativeDirPath()).toBe(join(".devin", "agents"));
      expect(subagent.getRelativeFilePath()).toBe(join("orphan", "AGENT.md"));
      expect(subagent.getBody()).toBe("");
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should return true for devin target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "agent.md",
        frontmatter: { name: "Agent", targets: ["devin"] },
        body: "",
      });

      expect(DevinSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return true for wildcard target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "agent.md",
        frontmatter: { name: "Agent", targets: ["*"] },
        body: "",
      });

      expect(DevinSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return false for different tool", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "agent.md",
        frontmatter: { name: "Agent", targets: ["claudecode"] },
        body: "",
      });

      expect(DevinSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(false);
    });
  });
});

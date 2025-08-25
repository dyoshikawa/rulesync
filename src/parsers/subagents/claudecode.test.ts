import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { ClaudeCodeSubagentParser } from "./claudecode.js";

describe("ClaudeCodeSubagentParser", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let parser: ClaudeCodeSubagentParser;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    parser = new ClaudeCodeSubagentParser();
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("getToolName", () => {
    it("should return 'claudecode'", () => {
      expect(parser.getToolName()).toBe("claudecode");
    });
  });

  describe("getAgentsDirectory", () => {
    it("should return '.claude/agents'", () => {
      expect(parser.getAgentsDirectory()).toBe(".claude/agents");
    });
  });

  describe("parseSubagents", () => {
    it("should return empty array when agents directory does not exist", async () => {
      const result = await parser.parseSubagents(testDir);
      expect(result).toEqual([]);
    });

    it("should parse subagents from .claude/agents directory", async () => {
      const agentsDir = join(testDir, ".claude", "agents");
      await mkdir(agentsDir, { recursive: true });

      const subagentContent = `---
name: "claude-agent"
description: "Claude Code test agent"
targets: ["claudecode"]
---

# Claude Agent

This is a Claude Code specific agent.`;

      await writeFile(join(agentsDir, "claude-agent.md"), subagentContent);

      const result = await parser.parseSubagents(testDir);

      expect(result).toHaveLength(1);
      expect(result[0]?.frontmatter.name).toBe("claude-agent");
      expect(result[0]?.frontmatter.targets).toEqual(["claudecode"]);
    });

    it("should parse multiple subagents from agents directory", async () => {
      const agentsDir = join(testDir, ".claude", "agents");
      await mkdir(agentsDir, { recursive: true });

      const agent1 = `---
name: "agent-1"
description: "First Claude agent"
---

# Agent 1`;

      const agent2 = `---
name: "agent-2"
description: "Second Claude agent"
---

# Agent 2`;

      await writeFile(join(agentsDir, "agent1.md"), agent1);
      await writeFile(join(agentsDir, "agent2.md"), agent2);

      const result = await parser.parseSubagents(testDir);

      expect(result).toHaveLength(2);
      expect(result.map((a) => a.frontmatter.name)).toContain("agent-1");
      expect(result.map((a) => a.frontmatter.name)).toContain("agent-2");
    });
  });
});

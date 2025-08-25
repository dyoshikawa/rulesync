import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { parseSubagentFile, parseSubagentsFromDirectory } from "./subagent-parser.js";

describe("subagent-parser", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("parseSubagentFile", () => {
    it("should parse valid subagent file", async () => {
      const subagentContent = `---
name: "test-agent"
description: "A test subagent"
targets: ["claudecode"]
---

# Test Agent

This is a test subagent for code analysis.

## Features
- Code review
- Bug detection
- Performance analysis`;

      const filepath = join(testDir, "test-agent.md");
      await writeFile(filepath, subagentContent);

      const result = await parseSubagentFile(filepath);

      expect(result).toMatchObject({
        frontmatter: {
          name: "test-agent",
          description: "A test subagent",
          targets: ["claudecode"],
        },
        content: expect.stringContaining("# Test Agent"),
        filename: "test-agent",
        filepath,
      });
    });

    it("should set default targets when not specified", async () => {
      const subagentContent = `---
name: "default-agent"
description: "Agent with default targets"
---

# Default Agent

This agent has default targets.`;

      const filepath = join(testDir, "default-agent.md");
      await writeFile(filepath, subagentContent);

      const result = await parseSubagentFile(filepath);

      expect(result?.frontmatter.targets).toEqual(["*"]);
    });

    it("should handle invalid frontmatter", async () => {
      const invalidContent = `---
invalid: frontmatter
missing: required fields
---

# Invalid Agent`;

      const filepath = join(testDir, "invalid-agent.md");
      await writeFile(filepath, invalidContent);

      const result = await parseSubagentFile(filepath);

      expect(result).toBeNull();
    });

    it("should handle missing frontmatter", async () => {
      const noFrontmatter = `# No Frontmatter

This file has no frontmatter.`;

      const filepath = join(testDir, "no-frontmatter.md");
      await writeFile(filepath, noFrontmatter);

      const result = await parseSubagentFile(filepath);

      expect(result).toBeNull();
    });

    it("should handle file read errors", async () => {
      const nonExistentFile = join(testDir, "nonexistent.md");

      const result = await parseSubagentFile(nonExistentFile);

      expect(result).toBeNull();
    });

    it("should trim content", async () => {
      const subagentContent = `---
name: "trim-agent"
description: "Agent with whitespace"
---

   # Trimmed Agent   

Content with whitespace.   

`;

      const filepath = join(testDir, "trim-agent.md");
      await writeFile(filepath, subagentContent);

      const result = await parseSubagentFile(filepath);

      expect(result?.content).toBe("# Trimmed Agent   \n\nContent with whitespace.");
    });

    it("should handle complex frontmatter", async () => {
      const complexContent = `---
name: "complex-agent"
description: "Agent with complex frontmatter"
targets: ["claudecode", "cursor", "cline"]
metadata:
  version: "1.0.0"
  author: "test"
tags:
  - "code-review"
  - "analysis"
---

# Complex Agent

This agent has complex frontmatter.`;

      const filepath = join(testDir, "complex-agent.md");
      await writeFile(filepath, complexContent);

      const result = await parseSubagentFile(filepath);

      expect(result).toMatchObject({
        frontmatter: {
          name: "complex-agent",
          description: "Agent with complex frontmatter",
          targets: ["claudecode", "cursor", "cline"],
        },
        filename: "complex-agent",
      });
    });
  });

  describe("parseSubagentsFromDirectory", () => {
    it("should return empty array for non-existent directory", async () => {
      const nonExistentDir = join(testDir, "nonexistent");

      const result = await parseSubagentsFromDirectory(nonExistentDir);

      expect(result).toEqual([]);
    });

    it("should return empty array for empty directory", async () => {
      const emptyDir = join(testDir, "empty");
      await mkdir(emptyDir, { recursive: true });

      const result = await parseSubagentsFromDirectory(emptyDir);

      expect(result).toEqual([]);
    });

    it("should return empty array for directory with no markdown files", async () => {
      const noMdDir = join(testDir, "no-md");
      await mkdir(noMdDir, { recursive: true });

      await writeFile(join(noMdDir, "text.txt"), "Not a markdown file");
      await writeFile(join(noMdDir, "config.json"), "{}");

      const result = await parseSubagentsFromDirectory(noMdDir);

      expect(result).toEqual([]);
    });

    it("should parse single subagent file", async () => {
      const agentsDir = join(testDir, "agents");
      await mkdir(agentsDir, { recursive: true });

      const subagentContent = `---
name: "single-agent"
description: "Single test agent"
---

# Single Agent

A single test agent.`;

      await writeFile(join(agentsDir, "single.md"), subagentContent);

      const result = await parseSubagentsFromDirectory(agentsDir);

      expect(result).toHaveLength(1);
      expect(result[0]?.frontmatter.name).toBe("single-agent");
    });

    it("should parse multiple subagent files", async () => {
      const agentsDir = join(testDir, "agents");
      await mkdir(agentsDir, { recursive: true });

      const agent1 = `---
name: "agent-1"
description: "First agent"
---

# Agent 1`;

      const agent2 = `---
name: "agent-2"
description: "Second agent"
---

# Agent 2`;

      const agent3 = `---
name: "agent-3"
description: "Third agent"
---

# Agent 3`;

      await writeFile(join(agentsDir, "agent1.md"), agent1);
      await writeFile(join(agentsDir, "agent2.md"), agent2);
      await writeFile(join(agentsDir, "agent3.md"), agent3);

      const result = await parseSubagentsFromDirectory(agentsDir);

      expect(result).toHaveLength(3);
      expect(result.map((a) => a.frontmatter.name)).toContain("agent-1");
      expect(result.map((a) => a.frontmatter.name)).toContain("agent-2");
      expect(result.map((a) => a.frontmatter.name)).toContain("agent-3");
    });

    it("should filter out failed parses", async () => {
      const agentsDir = join(testDir, "agents");
      await mkdir(agentsDir, { recursive: true });

      const validAgent = `---
name: "valid-agent"
description: "Valid agent"
---

# Valid Agent`;

      const invalidAgent = `---
invalid: frontmatter
---

# Invalid Agent`;

      const noFrontmatterAgent = `# No Frontmatter Agent`;

      await writeFile(join(agentsDir, "valid.md"), validAgent);
      await writeFile(join(agentsDir, "invalid.md"), invalidAgent);
      await writeFile(join(agentsDir, "no-frontmatter.md"), noFrontmatterAgent);

      const result = await parseSubagentsFromDirectory(agentsDir);

      expect(result).toHaveLength(1);
      expect(result[0]?.frontmatter.name).toBe("valid-agent");
    });

    it("should handle mixed file types", async () => {
      const agentsDir = join(testDir, "agents");
      await mkdir(agentsDir, { recursive: true });

      const validAgent = `---
name: "mixed-agent"
description: "Agent in mixed directory"
---

# Mixed Agent`;

      await writeFile(join(agentsDir, "agent.md"), validAgent);
      await writeFile(join(agentsDir, "readme.txt"), "Text file");
      await writeFile(join(agentsDir, "config.json"), "{}");

      const result = await parseSubagentsFromDirectory(agentsDir);

      expect(result).toHaveLength(1);
      expect(result[0]?.frontmatter.name).toBe("mixed-agent");
    });

    it("should handle directory read errors gracefully", async () => {
      // Mock a directory that will cause read error (invalid path)
      const invalidDir = "\0invalid";

      const result = await parseSubagentsFromDirectory(invalidDir);

      expect(result).toEqual([]);
    });
  });
});

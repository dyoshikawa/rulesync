import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { generateSubagents } from "./subagent-generator.js";

describe("generateSubagents", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should return empty array when subagents directory does not exist", async () => {
    const result = await generateSubagents(testDir, undefined, ["claudecode"]);
    expect(result).toEqual([]);
  });

  it("should return empty array when subagents directory is empty", async () => {
    const subagentsDir = join(testDir, ".rulesync", "subagents");
    await mkdir(subagentsDir, { recursive: true });

    const result = await generateSubagents(testDir, undefined, ["claudecode"]);
    expect(result).toEqual([]);
  });

  it("should generate subagents for claudecode", async () => {
    const subagentsDir = join(testDir, ".rulesync", "subagents");
    await mkdir(subagentsDir, { recursive: true });

    // Create a test subagent file
    const subagentContent = `---
description: "Code reviewer specialist"
targets: ["claudecode"]
---

You are an expert code reviewer. Please analyze code for:
1. Best practices
2. Security issues
3. Performance optimizations`;

    await writeFile(join(subagentsDir, "code-reviewer.md"), subagentContent);

    const result = await generateSubagents(testDir, undefined, ["claudecode"]);

    expect(result).toHaveLength(1);
    expect(result[0]!.tool).toBe("claudecode");
    expect(result[0]!.filepath).toBe(join(testDir, ".claude", "agents", "code-reviewer.yaml"));
    expect(result[0]!.content).toContain('description: "Code reviewer specialist"');
    expect(result[0]!.content).toContain("You are an expert code reviewer");
  });

  it("should handle multiple subagents", async () => {
    const subagentsDir = join(testDir, ".rulesync", "subagents");
    await mkdir(subagentsDir, { recursive: true });

    // Create multiple test subagent files
    const subagent1 = `---
description: "Security auditor"
---

You are a security expert.`;

    const subagent2 = `---
description: "Performance optimizer"
---

You are a performance specialist.`;

    await writeFile(join(subagentsDir, "security-auditor.md"), subagent1);
    await writeFile(join(subagentsDir, "performance-optimizer.md"), subagent2);

    const result = await generateSubagents(testDir, undefined, ["claudecode"]);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.filepath).sort()).toEqual([
      join(testDir, ".claude", "agents", "performance-optimizer.yaml"),
      join(testDir, ".claude", "agents", "security-auditor.yaml"),
    ]);
  });

  it("should filter unsupported tools", async () => {
    const subagentsDir = join(testDir, ".rulesync", "subagents");
    await mkdir(subagentsDir, { recursive: true });

    await writeFile(
      join(subagentsDir, "test.md"),
      `---
description: "Test subagent"
---

Test content`,
    );

    // Test with unsupported tool
    const result = await generateSubagents(testDir, undefined, ["cursor"]);
    expect(result).toEqual([]);
  });

  it("should use custom base directory", async () => {
    const subagentsDir = join(testDir, ".rulesync", "subagents");
    await mkdir(subagentsDir, { recursive: true });

    await writeFile(
      join(subagentsDir, "test.md"),
      `---
description: "Test subagent"
---

Test content`,
    );

    const customBaseDir = join(testDir, "output");
    const result = await generateSubagents(testDir, customBaseDir, ["claudecode"]);

    expect(result).toHaveLength(1);
    expect(result[0]!.filepath).toBe(join(customBaseDir, ".claude", "agents", "test.yaml"));
  });
});

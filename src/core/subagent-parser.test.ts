import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { parseSubagentsFromDirectory } from "./subagent-parser.js";

describe("parseSubagentsFromDirectory", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should parse subagent files with frontmatter", async () => {
    const subagentsDir = join(testDir, "subagents");
    await mkdir(subagentsDir, { recursive: true });

    const subagentContent = `---
description: "Code reviewer specialist"
targets: ["claudecode"]
---

You are an expert code reviewer. Please analyze code for:
1. Best practices
2. Security issues
3. Performance optimizations`;

    await writeFile(join(subagentsDir, "code-reviewer.md"), subagentContent);

    const result = await parseSubagentsFromDirectory(subagentsDir);

    expect(result).toHaveLength(1);
    expect(result[0]!.frontmatter.description).toBe("Code reviewer specialist");
    expect(result[0]!.content).toContain("You are an expert code reviewer");
    expect(result[0]!.filename).toBe("code-reviewer");
    expect(result[0]!.filepath).toBe(join(subagentsDir, "code-reviewer.md"));
  });

  it("should parse subagent files without frontmatter", async () => {
    const subagentsDir = join(testDir, "subagents");
    await mkdir(subagentsDir, { recursive: true });

    const subagentContent = "You are a helpful AI assistant.";

    await writeFile(join(subagentsDir, "helper.md"), subagentContent);

    const result = await parseSubagentsFromDirectory(subagentsDir);

    expect(result).toHaveLength(1);
    expect(result[0]!.frontmatter).toEqual({});
    expect(result[0]!.content).toBe("You are a helpful AI assistant.");
    expect(result[0]!.filename).toBe("helper");
  });

  it("should parse multiple subagent files", async () => {
    const subagentsDir = join(testDir, "subagents");
    await mkdir(subagentsDir, { recursive: true });

    const subagent1 = `---
description: "Security auditor"
---

You are a security expert.`;

    const subagent2 = `---
description: "Performance optimizer"
---

You are a performance specialist.`;

    await writeFile(join(subagentsDir, "security.md"), subagent1);
    await writeFile(join(subagentsDir, "performance.md"), subagent2);

    const result = await parseSubagentsFromDirectory(subagentsDir);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.frontmatter.description).sort()).toEqual([
      "Performance optimizer",
      "Security auditor",
    ]);
  });

  it("should return empty array for non-existent directory", async () => {
    const nonExistentDir = join(testDir, "nonexistent");

    const result = await parseSubagentsFromDirectory(nonExistentDir);
    expect(result).toEqual([]);
  });

  it("should handle empty directory", async () => {
    const emptyDir = join(testDir, "empty");
    await mkdir(emptyDir, { recursive: true });

    const result = await parseSubagentsFromDirectory(emptyDir);
    expect(result).toEqual([]);
  });
});

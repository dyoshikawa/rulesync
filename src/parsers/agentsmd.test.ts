import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { parseAgentsMdConfiguration } from "./agentsmd.js";

describe("parseAgentsMdConfiguration", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should parse AGENTS.md in project root", async () => {
    const agentsContent = "# Project Guidelines\n\nThis is the main project documentation.";
    await writeFile(join(testDir, "AGENTS.md"), agentsContent);

    const result = await parseAgentsMdConfiguration(testDir);

    expect(result.errors).toHaveLength(0);
    expect(result.rules).toHaveLength(1);

    const rule = result.rules[0]!;
    expect(rule.frontmatter.root).toBe(true);
    expect(rule.frontmatter.targets).toEqual(["agentsmd"]);
    expect(rule.frontmatter.description).toBe("Project-level AGENTS.md instructions");
    expect(rule.content).toBe(agentsContent);
    expect(rule.filename).toBe("project-instructions");
  });

  it("should parse memory files from .agents/memories/", async () => {
    const memoriesDir = join(testDir, ".agents", "memories");
    await mkdir(memoriesDir, { recursive: true });

    const codingStandardsContent = "# Coding Standards\n\nUse TypeScript strict mode.";
    const securityContent = "# Security\n\nNever commit secrets.";

    await writeFile(join(memoriesDir, "coding-standards.md"), codingStandardsContent);
    await writeFile(join(memoriesDir, "security.md"), securityContent);

    const result = await parseAgentsMdConfiguration(testDir);

    expect(result.errors).toHaveLength(0);
    expect(result.rules).toHaveLength(2);

    const codingRule = result.rules.find((r) => r.filename === "coding-standards");
    expect(codingRule).toBeDefined();
    expect(codingRule?.frontmatter.root).toBe(false);
    expect(codingRule?.frontmatter.targets).toEqual(["agentsmd"]);
    expect(codingRule?.content).toBe(codingStandardsContent);

    const securityRule = result.rules.find((r) => r.filename === "security");
    expect(securityRule).toBeDefined();
    expect(securityRule?.frontmatter.root).toBe(false);
    expect(securityRule?.content).toBe(securityContent);
  });

  it("should parse both AGENTS.md and memory files", async () => {
    // Create AGENTS.md
    const agentsContent = "# Main Project\n\nThis is the main documentation.";
    await writeFile(join(testDir, "AGENTS.md"), agentsContent);

    // Create memory files
    const memoriesDir = join(testDir, ".agents", "memories");
    await mkdir(memoriesDir, { recursive: true });
    const memoryContent = "# Memory\n\nThis is a memory file.";
    await writeFile(join(memoriesDir, "test-memory.md"), memoryContent);

    const result = await parseAgentsMdConfiguration(testDir);

    expect(result.errors).toHaveLength(0);
    expect(result.rules).toHaveLength(2);

    const rootRule = result.rules.find((r) => r.frontmatter.root === true);
    expect(rootRule).toBeDefined();
    expect(rootRule?.content).toBe(agentsContent);

    const memoryRule = result.rules.find((r) => r.frontmatter.root === false);
    expect(memoryRule).toBeDefined();
    expect(memoryRule?.content).toBe(memoryContent);
    expect(memoryRule?.filename).toBe("test-memory");
  });

  it("should find subdirectory AGENTS.md files", async () => {
    // Create subdirectory with AGENTS.md
    const subDir = join(testDir, "backend");
    await mkdir(subDir, { recursive: true });
    const subAgentsContent = "# Backend Guidelines\n\nBackend-specific rules.";
    await writeFile(join(subDir, "AGENTS.md"), subAgentsContent);

    const result = await parseAgentsMdConfiguration(testDir);

    expect(result.errors).toHaveLength(0);
    expect(result.rules).toHaveLength(1);

    const rule = result.rules[0]!;
    expect(rule.frontmatter.root).toBe(false);
    expect(rule.frontmatter.globs).toEqual(["backend/**/*"]);
    expect(rule.content).toBe(subAgentsContent);
    expect(rule.filename).toBe("backend-agents");
  });

  it("should find additional instruction files", async () => {
    const instructionsContent = "# Additional Instructions\n\nExtra guidelines.";
    await writeFile(join(testDir, "coding-guidelines.md"), instructionsContent);

    const result = await parseAgentsMdConfiguration(testDir);

    expect(result.errors).toHaveLength(0);
    expect(result.rules).toHaveLength(1);

    const rule = result.rules[0]!;
    expect(rule.frontmatter.root).toBe(false);
    expect(rule.content).toBe(instructionsContent);
    expect(rule.filename).toBe("coding-guidelines");
  });

  it("should handle missing files gracefully", async () => {
    const result = await parseAgentsMdConfiguration(testDir);

    expect(result.rules).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("No AGENTS.md configuration files found");
  });

  it("should skip empty files", async () => {
    await writeFile(join(testDir, "AGENTS.md"), "");

    const memoriesDir = join(testDir, ".agents", "memories");
    await mkdir(memoriesDir, { recursive: true });
    await writeFile(join(memoriesDir, "empty.md"), "   ");

    const result = await parseAgentsMdConfiguration(testDir);

    expect(result.rules).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("No AGENTS.md configuration files found");
  });

  it("should handle file read errors", async () => {
    // Create a directory instead of a file to cause read error
    await mkdir(join(testDir, "AGENTS.md"));

    const result = await parseAgentsMdConfiguration(testDir);

    expect(result.rules).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((error) => error.includes("Failed to parse AGENTS.md"))).toBe(true);
  });
});

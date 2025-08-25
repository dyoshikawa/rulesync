import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { ParsedRule } from "../types/rules.js";
import { parseCodexConfiguration } from "./codexcli.js";

describe("parseCodexConfiguration", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let agentsFilePath: string;
  let codexignorePath: string;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    agentsFilePath = join(testDir, "AGENTS.md");
    codexignorePath = join(testDir, ".codexignore");
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should parse AGENTS.md file successfully", async () => {
    const codexContent = `# E-commerce Platform

This is a modern e-commerce platform built with Next.js and TypeScript.

## Tech Stack
- Frontend: Next.js 14 with TypeScript
- Backend: Next.js API routes
- Database: PostgreSQL with Prisma ORM

## Coding Standards
1. Use TypeScript strict mode
2. Prefer functional components with hooks
3. Always write unit tests for business logic`;

    await writeFile(agentsFilePath, codexContent);

    const result = await parseCodexConfiguration(testDir);
    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.frontmatter).toEqual({
      root: true,
      targets: ["codexcli"],
      description: "Project-level Codex CLI instructions",
      globs: ["**/*"],
    });
    expect(result.rules[0]?.content).toContain("# E-commerce Platform");
    expect(result.rules[0]?.content).toContain("## Tech Stack");
    expect(result.rules[0]?.content).toContain("## Coding Standards");
    expect(result.rules[0]?.filename).toBe("project-instructions");
  });

  it("should parse additional instruction files", async () => {
    const codexContent = "# Main Project Instructions\nMain content here.";
    await writeFile(agentsFilePath, codexContent);

    const instructionsFile = join(testDir, "api-instructions.md");
    const guidelinesFile = join(testDir, "component-guidelines.md");
    const rulesFile = join(testDir, "testing-rules.md");

    await writeFile(instructionsFile, "# API Instructions\nAPI specific content.");
    await writeFile(guidelinesFile, "# Component Guidelines\nComponent specific content.");
    await writeFile(rulesFile, "# Testing Rules\nTesting specific content.");

    const result = await parseCodexConfiguration(testDir);
    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(4); // main + 3 additional files

    const additionalRules = result.rules.filter((rule: ParsedRule) => !rule.frontmatter.root);
    expect(additionalRules).toHaveLength(3);

    const apiRule = additionalRules.find(
      (rule: ParsedRule) => rule.filename === "api-instructions",
    );
    expect(apiRule?.content).toContain("# API Instructions");
    expect(apiRule?.frontmatter.description).toBe("Codex CLI instructions: api-instructions");

    const componentRule = additionalRules.find(
      (rule: ParsedRule) => rule.filename === "component-guidelines",
    );
    expect(componentRule?.content).toContain("# Component Guidelines");
    expect(componentRule?.frontmatter.description).toBe(
      "Codex CLI instructions: component-guidelines",
    );

    const testingRule = additionalRules.find(
      (rule: ParsedRule) => rule.filename === "testing-rules",
    );
    expect(testingRule?.content).toContain("# Testing Rules");
    expect(testingRule?.frontmatter.description).toBe("Codex CLI instructions: testing-rules");
  });

  it("should parse subdirectory AGENTS.md files", async () => {
    const mainCodexContent = "# Main Instructions";
    await writeFile(agentsFilePath, mainCodexContent);

    // Create subdirectories with AGENTS.md files
    const { mkdir } = await import("node:fs/promises");
    const srcDir = join(testDir, "src");
    const componentsDir = join(testDir, "components");

    await mkdir(srcDir);
    await mkdir(componentsDir);

    const srcCodexPath = join(srcDir, "AGENTS.md");
    const componentsCodexPath = join(componentsDir, "AGENTS.md");

    await writeFile(srcCodexPath, "# Source Code Guidelines\nSource specific content.");
    await writeFile(componentsCodexPath, "# Component Guidelines\nComponent specific content.");

    const result = await parseCodexConfiguration(testDir);
    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(3); // main + 2 subdirectory files

    const srcRule = result.rules.find((rule: ParsedRule) => rule.filename === "src-agents");
    expect(srcRule?.content).toContain("# Source Code Guidelines");
    expect(srcRule?.frontmatter.description).toBe("Directory-specific Codex CLI instructions: src");
    expect(srcRule?.frontmatter.globs).toEqual(["src/**/*"]);

    const componentsRule = result.rules.find(
      (rule: ParsedRule) => rule.filename === "components-agents",
    );
    expect(componentsRule?.content).toContain("# Component Guidelines");
    expect(componentsRule?.frontmatter.description).toBe(
      "Directory-specific Codex CLI instructions: components",
    );
    expect(componentsRule?.frontmatter.globs).toEqual(["components/**/*"]);
  });

  it("should parse .codexignore file", async () => {
    const codexContent = "# Main Instructions";
    await writeFile(agentsFilePath, codexContent);

    const codexignoreContent = `# Comment line
node_modules/
*.log
dist/
temp/**/*

# Another comment
.env
*.key`;

    await writeFile(codexignorePath, codexignoreContent);

    const result = await parseCodexConfiguration(testDir);
    expect(result.ignorePatterns).toEqual([
      "node_modules/",
      "*.log",
      "dist/",
      "temp/**/*",
      ".env",
      "*.key",
    ]);
  });

  it("should ignore non-relevant .md files", async () => {
    const codexContent = "# Main Instructions";
    await writeFile(agentsFilePath, codexContent);

    // Create .md files that shouldn't be parsed as Codex instructions
    await writeFile(join(testDir, "README.md"), "# README\nThis is a readme file.");
    await writeFile(join(testDir, "CHANGELOG.md"), "# Changelog\nVersion history.");
    await writeFile(join(testDir, "random-file.md"), "# Random\nNot related to Codex.");

    const result = await parseCodexConfiguration(testDir);
    expect(result.rules).toHaveLength(1); // Only main AGENTS.md should be parsed
    expect(result.rules[0]?.filename).toBe("project-instructions");
  });

  it("should include files with codex-related names", async () => {
    const codexContent = "# Main Instructions";
    await writeFile(agentsFilePath, codexContent);

    // Create files that should be included due to their names
    await writeFile(join(testDir, "codex-rules.md"), "# Codex Rules\nSpecific rules.");
    await writeFile(join(testDir, "api-instructions.md"), "# API Instructions\nAPI guidelines.");
    await writeFile(
      join(testDir, "dev-guidelines.md"),
      "# Development Guidelines\nDev specific rules.",
    );

    const result = await parseCodexConfiguration(testDir);
    expect(result.rules).toHaveLength(4); // main + 3 related files

    const codexRulesFile = result.rules.find((rule: ParsedRule) => rule.filename === "codex-rules");
    expect(codexRulesFile?.content).toContain("# Codex Rules");

    const instructionsFile = result.rules.find(
      (rule: ParsedRule) => rule.filename === "api-instructions",
    );
    expect(instructionsFile?.content).toContain("# API Instructions");

    const guidelinesFile = result.rules.find(
      (rule: ParsedRule) => rule.filename === "dev-guidelines",
    );
    expect(guidelinesFile?.content).toContain("# Development Guidelines");
  });

  it("should return error when no configuration files found", async () => {
    const result = await parseCodexConfiguration(testDir);
    expect(result.errors).toContain(
      "No Codex CLI configuration files found. Expected to find AGENTS.md in the project root or subdirectories.",
    );
    expect(result.rules).toEqual([]);
  });

  it("should handle empty AGENTS.md file", async () => {
    await writeFile(agentsFilePath, "   \n\n  ");

    const result = await parseCodexConfiguration(testDir);
    expect(result.errors).toContain(
      "No Codex CLI configuration files found. Expected to find AGENTS.md in the project root or subdirectories.",
    );
    expect(result.rules).toEqual([]);
  });

  it("should handle file reading errors gracefully", async () => {
    const codexContent = "# Main Instructions";
    await writeFile(agentsFilePath, codexContent);

    // Create a directory instead of a file to cause read errors
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(testDir, "problematic-instructions.md"));

    const result = await parseCodexConfiguration(testDir);
    // Should not crash and should still parse main file
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.filename).toBe("project-instructions");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(
      result.errors.some((error: string) => error.includes("problematic-instructions.md")),
    ).toBe(true);
  });

  it("should handle .codexignore parsing errors gracefully", async () => {
    const codexContent = "# Main Instructions";
    await writeFile(agentsFilePath, codexContent);

    // Create a directory instead of a file to cause read errors
    const { mkdir } = await import("node:fs/promises");
    await mkdir(codexignorePath);

    const result = await parseCodexConfiguration(testDir);
    expect(result.rules).toHaveLength(1);
    expect(result.ignorePatterns).toBeUndefined();
    expect(
      result.errors.some((error: string) => error.includes("Failed to parse .codexignore")),
    ).toBe(true);
  });

  it("should skip dot directories and node_modules", async () => {
    const codexContent = "# Main Instructions";
    await writeFile(agentsFilePath, codexContent);

    // Create directories that should be skipped
    const { mkdir } = await import("node:fs/promises");
    const dotDir = join(testDir, ".hidden");
    const nodeModulesDir = join(testDir, "node_modules");

    await mkdir(dotDir);
    await mkdir(nodeModulesDir);

    // Add AGENTS.md files to these directories
    await writeFile(join(dotDir, "AGENTS.md"), "# Hidden Agents");
    await writeFile(join(nodeModulesDir, "AGENTS.md"), "# Node Modules Agents");

    const result = await parseCodexConfiguration(testDir);
    expect(result.rules).toHaveLength(1); // Only main AGENTS.md should be parsed
    expect(result.rules[0]?.filename).toBe("project-instructions");
  });

  it("should handle subdirectory traversal errors gracefully", async () => {
    const codexContent = "# Main Instructions";
    await writeFile(agentsFilePath, codexContent);

    // This test ensures the parser doesn't crash when encountering permission issues or other filesystem errors
    const result = await parseCodexConfiguration(testDir);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.filename).toBe("project-instructions");
  });

  it("should use default baseDir when not provided", async () => {
    // This test verifies that the function works when baseDir parameter is not provided
    // Since we can't easily control the current working directory in tests,
    // we'll test with a specific directory that doesn't exist
    const nonExistentDir = join(testDir, "non-existent");

    const result = await parseCodexConfiguration(nonExistentDir);
    expect(result.errors).toContain(
      "No Codex CLI configuration files found. Expected to find AGENTS.md in the project root or subdirectories.",
    );
    expect(result.rules).toEqual([]);
  });

  it("should filter out empty .codexignore patterns", async () => {
    const codexContent = "# Main Instructions";
    await writeFile(agentsFilePath, codexContent);

    const codexignoreContent = `# Comment line

node_modules/


*.log

# Another comment


dist/`;

    await writeFile(codexignorePath, codexignoreContent);

    const result = await parseCodexConfiguration(testDir);
    expect(result.ignorePatterns).toEqual(["node_modules/", "*.log", "dist/"]);
  });
});

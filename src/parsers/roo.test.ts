import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../utils/test-helpers.js";
import { parseRooConfiguration } from "./roo.js";

describe("parseRooConfiguration", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let rooInstructionsPath: string;
  let rooRulesDir: string;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    rooInstructionsPath = join(testDir, ".roo", "instructions.md");
    rooRulesDir = join(testDir, ".roo", "rules");

    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(testDir, ".roo"), { recursive: true });
    await mkdir(rooRulesDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should return error when no configuration files found", async () => {
    const result = await parseRooConfiguration(testDir);
    expect(result.errors).toContain(
      "No Roo Code configuration files found (.roo/instructions.md or .roo/rules/*.md)",
    );
    expect(result.rules).toEqual([]);
  });

  it("should parse .roo/instructions.md file", async () => {
    const content = `# Roo Code Instructions

## Project Overview
This is a React TypeScript project.

## Best Practices
- Use functional components
- Implement proper error boundaries`;

    await writeFile(rooInstructionsPath, content);

    const result = await parseRooConfiguration(testDir);
    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.frontmatter).toEqual({
      root: false,
      targets: ["roo"],
      description: "Roo Code instructions",
      globs: ["**/*"],
    });
    expect(result.rules[0]?.content).toContain("This is a React TypeScript project");
  });

  it("should parse .roo/rules directory files", async () => {
    await writeFile(
      join(rooRulesDir, "react-patterns.md"),
      "# React Patterns\n\nUse custom hooks for state logic",
    );
    await writeFile(
      join(rooRulesDir, "performance.md"),
      "# Performance Guidelines\n\nMemoize expensive computations",
    );
    await writeFile(join(rooRulesDir, "notes.txt"), "This should be ignored");

    const result = await parseRooConfiguration(testDir);
    expect(result.rules).toHaveLength(2);

    const filenames = result.rules.map((r) => r.filename);
    expect(filenames).toContain("react-patterns");
    expect(filenames).toContain("performance");
  });

  it("should parse both instructions and rules", async () => {
    await writeFile(rooInstructionsPath, "# Main Instructions");
    await writeFile(join(rooRulesDir, "additional.md"), "# Additional Rules");

    const result = await parseRooConfiguration(testDir);
    expect(result.rules).toHaveLength(2);
  });

  it("should skip empty files", async () => {
    await writeFile(rooInstructionsPath, "");
    await writeFile(join(rooRulesDir, "empty.md"), "   \n\t  ");
    await writeFile(join(rooRulesDir, "valid.md"), "# Valid content\n\nSome rules here");

    const result = await parseRooConfiguration(testDir);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.content).toContain("Some rules here");
  });

  it("should handle file read errors gracefully", async () => {
    await writeFile(rooInstructionsPath, "# Valid instructions");

    // Create a directory with rule file name to cause read error
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(rooRulesDir, "test.md"));

    const result = await parseRooConfiguration(testDir);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Failed to parse");
    // Should still parse the valid file
    expect(result.rules).toHaveLength(1);
  });

  it("should handle missing rules directory", async () => {
    const { rm } = await import("node:fs/promises");
    await rm(rooRulesDir, { recursive: true, force: true });

    await writeFile(rooInstructionsPath, "# Main Instructions");

    const result = await parseRooConfiguration(testDir);
    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(1);
  });

  it("should handle missing .roo directory entirely", async () => {
    const { rm } = await import("node:fs/promises");
    await rm(join(testDir, ".roo"), { recursive: true, force: true });

    const result = await parseRooConfiguration(testDir);
    expect(result.errors).toContain(
      "No Roo Code configuration files found (.roo/instructions.md or .roo/rules/*.md)",
    );
    expect(result.rules).toEqual([]);
  });

  it("should generate correct frontmatter for rule files", async () => {
    await writeFile(join(rooRulesDir, "state-management.md"), "# State Management Guidelines");

    const result = await parseRooConfiguration(testDir);
    expect(result.rules[0]?.frontmatter).toEqual({
      root: false,
      targets: ["roo"],
      description: "Roo rule: state-management",
      globs: ["**/*"],
    });
    expect(result.rules[0]?.filename).toBe("state-management");
  });

  it("should handle special characters in filenames", async () => {
    await writeFile(join(rooRulesDir, "api-integration.md"), "# API Integration");
    await writeFile(join(rooRulesDir, "ui_components.md"), "# UI Components");

    const result = await parseRooConfiguration(testDir);
    expect(result.rules).toHaveLength(2);
    expect(result.rules[0]?.filename).toBe("api-integration");
    expect(result.rules[1]?.filename).toBe("ui_components");
  });
});

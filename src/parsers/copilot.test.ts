import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCopilotConfiguration } from "./copilot.js";

describe("parseCopilotConfiguration", () => {
  const testDir = join(__dirname, "test-temp-copilot");
  const copilotPath = join(testDir, ".github", "copilot-instructions.md");
  const instructionsDir = join(testDir, ".github", "instructions");

  beforeEach(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(testDir, ".github"), { recursive: true });
    await mkdir(instructionsDir, { recursive: true });
  });

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(testDir, { recursive: true, force: true });
  });

  it("should return error when no configuration files found", async () => {
    const result = await parseCopilotConfiguration(testDir);
    expect(result.errors).toContain(
      "No Copilot configuration files found (.github/copilot-instructions.md or .github/instructions/*.instructions.md)",
    );
    expect(result.rules).toEqual([]);
  });

  it("should parse copilot-instructions.md file", async () => {
    const content = `# GitHub Copilot Instructions

## Project Overview
This is a TypeScript project.

## Coding Standards
- Use functional programming
- Prefer const over let`;

    await writeFile(copilotPath, content);

    const result = await parseCopilotConfiguration(testDir);
    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]!.frontmatter).toEqual({
      root: false,
      targets: ["copilot"],
      description: "GitHub Copilot instructions",
      globs: ["**/*"],
    });
    expect(result.rules[0]!.content).toContain("This is a TypeScript project");
  });

  it("should parse instructions directory files", async () => {
    await writeFile(
      join(instructionsDir, "typescript.instructions.md"),
      "# TypeScript Rules\n\nUse strict mode",
    );
    await writeFile(
      join(instructionsDir, "testing.instructions.md"),
      "# Testing Guidelines\n\nWrite unit tests",
    );
    await writeFile(join(instructionsDir, "not-instructions.md"), "This should be ignored");

    const result = await parseCopilotConfiguration(testDir);
    expect(result.rules).toHaveLength(2);

    const filenames = result.rules.map((r) => r.filename);
    expect(filenames).toContain("copilot-typescript");
    expect(filenames).toContain("copilot-testing");
    expect(filenames).not.toContain("copilot-not-instructions");
  });

  it("should parse both main file and instructions", async () => {
    await writeFile(copilotPath, "# Main Instructions");
    await writeFile(join(instructionsDir, "extra.instructions.md"), "# Extra Instructions");

    const result = await parseCopilotConfiguration(testDir);
    expect(result.rules).toHaveLength(2);
  });

  it("should skip empty files", async () => {
    await writeFile(copilotPath, "");
    await writeFile(join(instructionsDir, "empty.instructions.md"), "   \n\t  ");
    await writeFile(join(instructionsDir, "valid.instructions.md"), "# Valid content");

    const result = await parseCopilotConfiguration(testDir);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]!.content).toContain("Valid content");
  });

  it("should handle file read errors gracefully", async () => {
    // Create a directory with instruction file name to cause read error
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(instructionsDir, "test.instructions.md"));

    const result = await parseCopilotConfiguration(testDir);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("Failed to parse"))).toBe(true);
  });

  it("should handle missing instructions directory", async () => {
    const { rm } = await import("node:fs/promises");
    await rm(instructionsDir, { recursive: true, force: true });

    await writeFile(copilotPath, "# Main Instructions");

    const result = await parseCopilotConfiguration(testDir);
    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(1);
  });

  it("should generate correct frontmatter for instruction files", async () => {
    await writeFile(join(instructionsDir, "api-design.instructions.md"), "# API Design Guidelines");

    const result = await parseCopilotConfiguration(testDir);
    expect(result.rules[0]!.frontmatter).toEqual({
      root: false,
      targets: ["copilot"],
      description: "Copilot instruction: api-design",
      globs: ["**/*"],
    });
    expect(result.rules[0]!.filename).toBe("copilot-api-design");
  });
});

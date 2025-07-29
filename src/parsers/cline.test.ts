import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseClineConfiguration } from "./cline.js";

describe("parseClineConfiguration", () => {
  const testDir = join(__dirname, "test-temp-cline");
  const clineInstructionsPath = join(testDir, ".cline", "instructions.md");
  const clinerulesDirPath = join(testDir, ".clinerules");

  beforeEach(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(testDir, ".cline"), { recursive: true });
    await mkdir(clinerulesDirPath, { recursive: true });
  });

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(testDir, { recursive: true, force: true });
  });

  it("should return error when no configuration files found", async () => {
    const result = await parseClineConfiguration(testDir);
    expect(result.errors).toContain(
      "No Cline configuration files found (.cline/instructions.md or .clinerules/*.md)",
    );
    expect(result.rules).toEqual([]);
  });

  it("should parse .cline/instructions.md file", async () => {
    const content = `# Cline Instructions

## Project Context
This is a Node.js application.

## Development Guidelines
- Follow TDD practices
- Use ESM modules`;

    await writeFile(clineInstructionsPath, content);

    const result = await parseClineConfiguration(testDir);
    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.frontmatter).toEqual({
      root: false,
      targets: ["cline"],
      description: "Cline instructions",
      globs: ["**/*"],
    });
    expect(result.rules[0]?.content).toContain("This is a Node.js application");
  });

  it("should parse .clinerules directory files", async () => {
    await writeFile(
      join(clinerulesDirPath, "coding-style.md"),
      "# Coding Style\n\nUse 2 spaces for indentation",
    );
    await writeFile(
      join(clinerulesDirPath, "testing.md"),
      "# Testing Rules\n\nAim for 80% coverage",
    );
    await writeFile(join(clinerulesDirPath, "readme.txt"), "This should be ignored");

    const result = await parseClineConfiguration(testDir);
    expect(result.rules).toHaveLength(2);

    const filenames = result.rules.map((r) => r.filename);
    expect(filenames).toContain("coding-style");
    expect(filenames).toContain("testing");
  });

  it("should parse both instructions and rules", async () => {
    await writeFile(clineInstructionsPath, "# Main Instructions");
    await writeFile(join(clinerulesDirPath, "extra-rules.md"), "# Extra Rules");

    const result = await parseClineConfiguration(testDir);
    expect(result.rules).toHaveLength(2);
  });

  it("should skip empty files", async () => {
    await writeFile(clineInstructionsPath, "");
    await writeFile(join(clinerulesDirPath, "empty.md"), "   \n\t  ");
    await writeFile(join(clinerulesDirPath, "valid.md"), "# Valid content");

    const result = await parseClineConfiguration(testDir);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.content).toContain("Valid content");
  });

  it("should handle file read errors gracefully", async () => {
    await writeFile(clineInstructionsPath, "# Valid instructions");

    // Create a directory with rule file name to cause read error
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(clinerulesDirPath, "test.md"));

    const result = await parseClineConfiguration(testDir);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Failed to parse");
    // Should still parse the valid file
    expect(result.rules).toHaveLength(1);
  });

  it("should handle missing .clinerules directory", async () => {
    const { rm } = await import("node:fs/promises");
    await rm(clinerulesDirPath, { recursive: true, force: true });

    await writeFile(clineInstructionsPath, "# Main Instructions");

    const result = await parseClineConfiguration(testDir);
    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(1);
  });

  it("should handle missing .cline directory", async () => {
    const { rm } = await import("node:fs/promises");
    await rm(join(testDir, ".cline"), { recursive: true, force: true });

    await writeFile(join(clinerulesDirPath, "rules.md"), "# Some Rules");

    const result = await parseClineConfiguration(testDir);
    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(1);
  });

  it("should generate correct frontmatter for rule files", async () => {
    await writeFile(join(clinerulesDirPath, "architecture.md"), "# Architecture Guidelines");

    const result = await parseClineConfiguration(testDir);
    expect(result.rules[0]?.frontmatter).toEqual({
      root: false,
      targets: ["cline"],
      description: "Cline rule: architecture",
      globs: ["**/*"],
    });
    expect(result.rules[0]?.filename).toBe("architecture");
  });
});

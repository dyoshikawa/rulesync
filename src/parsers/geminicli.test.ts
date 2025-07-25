import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ParsedRule } from "../types/rules.js";
import { parseGeminiConfiguration } from "./geminicli.js";

describe("parseGeminiConfiguration", () => {
  const testDir = join(__dirname, "test-temp-gemini");
  const geminiFilePath = join(testDir, "GEMINI.md");
  const memoryDir = join(testDir, ".gemini", "memories");
  const settingsPath = join(testDir, ".gemini", "settings.json");
  const aiexcludePath = join(testDir, ".aiexclude");

  beforeEach(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(testDir, { recursive: true });
    await mkdir(memoryDir, { recursive: true });
  });

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(testDir, { recursive: true, force: true });
  });

  it("should return error when GEMINI.md is not found", async () => {
    const result = await parseGeminiConfiguration(testDir);
    expect(result.errors).toContain("GEMINI.md file not found");
    expect(result.rules).toEqual([]);
  });

  it("should parse GEMINI.md file successfully", async () => {
    const geminiContent = `# Project Guidelines

This is the main Gemini CLI configuration.

## Code Style
- Use TypeScript
- Follow ESLint rules`;

    await writeFile(geminiFilePath, geminiContent);

    const result = await parseGeminiConfiguration(testDir);
    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.frontmatter).toEqual({
      root: false,
      targets: ["geminicli"],
      description: "Main Gemini CLI configuration",
      globs: ["**/*"],
    });
    expect(result.rules[0]?.content).toContain("This is the main Gemini CLI configuration");
    expect(result.rules[0]?.filename).toBe("gemini-main");
  });

  it("should skip reference table when parsing main file", async () => {
    const geminiContent = `| Document | Description | File Patterns |
|----------|-------------|---------------|
| @spec1.md | Test spec | *.ts |
| @spec2.md | Another spec | *.js |

# Main Content

This is the actual content after the table.`;

    await writeFile(geminiFilePath, geminiContent);

    const result = await parseGeminiConfiguration(testDir);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.content).toBe(
      "# Main Content\n\nThis is the actual content after the table.",
    );
  });

  it("should parse memory files", async () => {
    const geminiContent = "# Main Config\nMain content here.";
    await writeFile(geminiFilePath, geminiContent);

    const memoryFile1 = join(memoryDir, "memory1.md");
    const memoryFile2 = join(memoryDir, "memory2.md");

    await writeFile(memoryFile1, "Memory content 1");
    await writeFile(memoryFile2, "Memory content 2");

    const result = await parseGeminiConfiguration(testDir);
    expect(result.rules).toHaveLength(3); // main + 2 memory files

    const memoryRules = result.rules.filter((rule: ParsedRule) =>
      rule.filename.startsWith("gemini-memory-"),
    );
    expect(memoryRules).toHaveLength(2);
    expect(memoryRules[0]?.frontmatter.description).toContain("Memory file:");
    expect(memoryRules[0]?.content).toContain("Memory content");
  });

  it("should parse settings.json with MCP servers", async () => {
    const geminiContent = "# Main Config";
    await writeFile(geminiFilePath, geminiContent);

    const settings = {
      mcpServers: {
        "test-server": {
          command: "test-command",
          args: ["--test"],
          targets: ["geminicli"],
        },
      },
    };
    await writeFile(settingsPath, JSON.stringify(settings, null, 2));

    const result = await parseGeminiConfiguration(testDir);
    expect(result.mcpServers).toBeDefined();
    expect(result.mcpServers!["test-server"]).toEqual({
      command: "test-command",
      args: ["--test"],
      targets: ["geminicli"],
    });
  });

  it("should parse .aiexclude file", async () => {
    const geminiContent = "# Main Config";
    await writeFile(geminiFilePath, geminiContent);

    const aiexcludeContent = `# Comment line
node_modules/
*.log
dist/

# Another comment
.env`;

    await writeFile(aiexcludePath, aiexcludeContent);

    const result = await parseGeminiConfiguration(testDir);
    expect(result.ignorePatterns).toEqual(["node_modules/", "*.log", "dist/", ".env"]);
  });

  it("should combine ignore patterns from .aiexclude", async () => {
    const geminiContent = "# Main Config";
    await writeFile(geminiFilePath, geminiContent);

    const aiexcludeContent = "node_modules/\n*.log";
    await writeFile(aiexcludePath, aiexcludeContent);

    const result = await parseGeminiConfiguration(testDir);
    expect(result.ignorePatterns).toContain("node_modules/");
    expect(result.ignorePatterns).toContain("*.log");
  });

  it("should handle invalid settings.json gracefully", async () => {
    const geminiContent = "# Main Config";
    await writeFile(geminiFilePath, geminiContent);

    await writeFile(settingsPath, "invalid json content");

    const result = await parseGeminiConfiguration(testDir);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(
      result.errors.some((error: string) => error.includes("Failed to parse settings.json")),
    ).toBe(true);
  });

  it("should handle empty content gracefully", async () => {
    await writeFile(geminiFilePath, "");

    const result = await parseGeminiConfiguration(testDir);
    expect(result.rules).toEqual([]);
  });

  it("should skip empty memory files", async () => {
    const geminiContent = "# Main Config";
    await writeFile(geminiFilePath, geminiContent);

    const emptyMemoryFile = join(memoryDir, "empty.md");
    const validMemoryFile = join(memoryDir, "valid.md");

    await writeFile(emptyMemoryFile, "   \n\n  ");
    await writeFile(validMemoryFile, "Valid content");

    const result = await parseGeminiConfiguration(testDir);
    expect(result.rules).toHaveLength(2); // main + 1 valid memory file

    const memoryRules = result.rules.filter((rule: ParsedRule) =>
      rule.filename.startsWith("gemini-memory-"),
    );
    expect(memoryRules).toHaveLength(1);
    expect(memoryRules[0]?.filename).toBe("gemini-memory-valid");
  });

  it("should handle file reading errors gracefully", async () => {
    const geminiContent = "# Main Config";
    await writeFile(geminiFilePath, geminiContent);

    // Create a directory instead of a file to cause read errors
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(memoryDir, "invalid.md"));

    const result = await parseGeminiConfiguration(testDir);
    // Should not crash and should still parse main file
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.filename).toBe("gemini-main");
  });

  it("should use default baseDir when not provided", async () => {
    // Create a temporary directory that doesn't have GEMINI.md
    const emptyDir = join(testDir, "empty-subdir");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(emptyDir);

    const result = await parseGeminiConfiguration(emptyDir);
    expect(result.errors).toEqual(["GEMINI.md file not found"]);
    expect(result.rules).toEqual([]);
  });
});

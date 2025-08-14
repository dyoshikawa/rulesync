import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as parsers from "../parsers/index.js";
import { setupTestDirectory } from "../test-utils/index.js";
import type { ToolTarget } from "../types/index.js";
import { importConfiguration } from "./importer.js";

vi.mock("../parsers");

describe("importConfiguration", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let rulesDir: string;
  let commandsDir: string;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    rulesDir = join(testDir, ".rulesync", "rules");
    commandsDir = join(testDir, ".rulesync", "commands");

    const { mkdir } = await import("node:fs/promises");
    await mkdir(rulesDir, { recursive: true });
    await mkdir(commandsDir, { recursive: true });
    vi.resetAllMocks();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should import Claude Code configuration successfully", async () => {
    const mockRules = [
      {
        frontmatter: {
          root: false,
          targets: ["claudecode"] satisfies ToolTarget[],
          description: "Main config",
          globs: ["**/*"],
        },
        content: "# Main content",
        filename: "main",
        filepath: "/test/CLAUDE.md",
      },
    ];

    vi.spyOn(parsers, "parseClaudeConfiguration").mockResolvedValueOnce({
      rules: mockRules,
      errors: [],
      ignorePatterns: [],
      mcpServers: {},
    });

    const result = await importConfiguration({
      tool: "claudecode",
      baseDir: testDir,
    });

    expect(result.success).toBe(true);
    expect(result.rulesCreated).toBe(1);
    expect(result.errors).toEqual([]);

    const createdFile = await readFile(join(rulesDir, "main.md"), "utf-8");
    expect(createdFile).toContain("root: false");
    expect(createdFile).toContain("# Main content");
  });

  it("should overwrite files with same filename", async () => {
    const mockRules = [
      {
        frontmatter: {
          root: false,
          targets: ["cursor"] satisfies ToolTarget[],
          description: "Rule 1",
          globs: ["**/*"],
        },
        content: "Content 1",
        filename: "rules",
        filepath: "/test/rule1.md",
      },
      {
        frontmatter: {
          root: false,
          targets: ["cursor"] satisfies ToolTarget[],
          description: "Rule 2",
          globs: ["**/*"],
        },
        content: "Content 2",
        filename: "rules",
        filepath: "/test/rule2.md",
      },
    ];

    vi.spyOn(parsers, "parseCursorConfiguration").mockResolvedValueOnce({
      rules: mockRules,
      errors: [],
    });

    const result = await importConfiguration({
      tool: "cursor",
      baseDir: testDir,
    });

    expect(result.rulesCreated).toBe(2);

    // The last rule with the same filename should overwrite the previous one
    const file = await readFile(join(rulesDir, "rules.md"), "utf-8");
    expect(file).toContain("Content 2");
    expect(file).not.toContain("Content 1");
  });

  it("should create .rulesyncignore file when ignore patterns exist", async () => {
    vi.spyOn(parsers, "parseClaudeConfiguration").mockResolvedValueOnce({
      rules: [],
      errors: [],
      ignorePatterns: ["node_modules/**", "*.env", "dist/**"],
    });

    const result = await importConfiguration({
      tool: "claudecode",
      baseDir: testDir,
    });

    expect(result.ignoreFileCreated).toBe(true);

    const ignoreContent = await readFile(join(testDir, ".rulesyncignore"), "utf-8");
    expect(ignoreContent).toBe("node_modules/**\n*.env\ndist/**\n");
  });

  it("should create .mcp.json file when MCP servers exist", async () => {
    const mcpServers = {
      "test-server": {
        command: "test-server",
        args: ["--stdio"],
      },
    };

    vi.spyOn(parsers, "parseClaudeConfiguration").mockResolvedValueOnce({
      rules: [],
      errors: [],
      mcpServers,
    });

    const result = await importConfiguration({
      tool: "claudecode",
      baseDir: testDir,
    });

    expect(result.mcpFileCreated).toBe(true);

    const mcpContent = await readFile(join(testDir, ".rulesync", ".mcp.json"), "utf-8");
    const parsed = JSON.parse(mcpContent);
    expect(parsed.mcpServers).toEqual(mcpServers);
  });

  it("should handle parser errors", async () => {
    vi.spyOn(parsers, "parseCopilotConfiguration").mockResolvedValueOnce({
      rules: [],
      errors: ["File not found", "Invalid format"],
    });

    const result = await importConfiguration({
      tool: "copilot",
      baseDir: testDir,
    });

    expect(result.success).toBe(false);
    expect(result.rulesCreated).toBe(0);
    expect(result.errors).toEqual(["File not found", "Invalid format"]);
  });

  it("should handle verbose mode", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    vi.spyOn(parsers, "parseClineConfiguration").mockResolvedValueOnce({
      rules: [
        {
          frontmatter: {
            root: false,
            targets: ["cline"] as const,
            description: "Test",
            globs: ["**/*"],
          },
          content: "Test content",
          filename: "test",
          filepath: "/test/test.md",
        },
      ],
      errors: [],
    });

    await importConfiguration({
      tool: "cline",
      baseDir: testDir,
      verbose: true,
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Importing cline configuration from"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("✅ Created rule file:"));

    consoleSpy.mockRestore();
  });

  it("should handle parser exceptions", async () => {
    vi.spyOn(parsers, "parseRooConfiguration").mockRejectedValueOnce(new Error("Parser crashed"));

    const result = await importConfiguration({
      tool: "roo",
      baseDir: testDir,
    });

    expect(result.success).toBe(false);
    expect(result.rulesCreated).toBe(0);
    expect(result.errors).toContain("Failed to parse roo configuration: Parser crashed");
  });

  it("should handle unsupported tools", async () => {
    const result = await importConfiguration({
      tool: "unknown" as any,
      baseDir: testDir,
    });

    expect(result.success).toBe(false);
    expect(result.rulesCreated).toBe(0);
    expect(result.errors).toContain("Unsupported tool: unknown");
  });

  it("should handle file write errors", async () => {
    vi.spyOn(parsers, "parseClaudeConfiguration").mockResolvedValueOnce({
      rules: [
        {
          frontmatter: {
            root: false,
            targets: ["claudecode"] satisfies ToolTarget[],
            description: "Test",
            globs: ["**/*"],
          },
          content: "Test content",
          filename: "test",
          filepath: "/test/test.md",
        },
      ],
      errors: [],
    });

    // Mock writeFileContent to throw an error
    vi.spyOn(await import("../utils/index.js"), "writeFileContent").mockRejectedValueOnce(
      new Error("Permission denied"),
    );

    const result = await importConfiguration({
      tool: "claudecode",
      baseDir: testDir,
    });

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Failed to create rule file");
  });

  it("should return success when only ignore file is created", async () => {
    vi.spyOn(parsers, "parseClaudeConfiguration").mockResolvedValueOnce({
      rules: [],
      errors: [],
      ignorePatterns: ["*.log"],
    });

    const result = await importConfiguration({
      tool: "claudecode",
      baseDir: testDir,
    });

    expect(result.success).toBe(true);
    expect(result.rulesCreated).toBe(0);
    expect(result.ignoreFileCreated).toBe(true);
  });

  it("should return success when only MCP file is created", async () => {
    vi.spyOn(parsers, "parseClaudeConfiguration").mockResolvedValueOnce({
      rules: [],
      errors: [],
      mcpServers: { server: { command: "test" } },
    });

    const result = await importConfiguration({
      tool: "claudecode",
      baseDir: testDir,
    });

    expect(result.success).toBe(true);
    expect(result.rulesCreated).toBe(0);
    expect(result.mcpFileCreated).toBe(true);
  });

  it("should handle error creating .rulesyncignore", async () => {
    vi.spyOn(parsers, "parseClaudeConfiguration").mockResolvedValueOnce({
      rules: [],
      errors: [],
      ignorePatterns: ["*.log"],
    });

    // Mock writeFileContent to throw an error for .rulesyncignore
    vi.spyOn(await import("../utils/index.js"), "writeFileContent").mockRejectedValueOnce(
      new Error("Permission denied"),
    );

    const result = await importConfiguration({
      tool: "claudecode",
      baseDir: testDir,
    });

    expect(result.ignoreFileCreated).toBe(false);
    expect(result.errors.some((e) => e.includes("Failed to create .rulesyncignore"))).toBe(true);
  });

  it("should handle error creating .mcp.json", async () => {
    vi.spyOn(parsers, "parseClaudeConfiguration").mockResolvedValueOnce({
      rules: [],
      errors: [],
      mcpServers: { server: { command: "test" } },
    });

    // Mock writeFileContent to throw an error for .mcp.json
    vi.spyOn(await import("../utils/index.js"), "writeFileContent").mockRejectedValueOnce(
      new Error("Permission denied"),
    );

    const result = await importConfiguration({
      tool: "claudecode",
      baseDir: testDir,
    });

    expect(result.mcpFileCreated).toBe(false);
    expect(result.errors.some((e) => e.includes("Failed to create .mcp.json"))).toBe(true);
  });

  it("should handle verbose mode for ignore and MCP files", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    vi.spyOn(parsers, "parseClaudeConfiguration").mockResolvedValueOnce({
      rules: [],
      errors: [],
      ignorePatterns: ["*.log", "temp/*"],
      mcpServers: {
        server1: { command: "test1" },
        server2: { command: "test2" },
      },
    });

    await importConfiguration({
      tool: "claudecode",
      baseDir: testDir,
      verbose: true,
    });

    // Check that verbose log was called for importing
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Importing claudecode configuration from"),
    );

    // Check that the ignore and MCP creation logs were called
    const calls = consoleSpy.mock.calls.map((call) => call[0]);
    expect(calls.some((msg) => msg.includes("Created .rulesyncignore with 2 patterns"))).toBe(true);
    expect(calls.some((msg) => msg.includes("Created .mcp.json with 2 servers"))).toBe(true);

    consoleSpy.mockRestore();
  });

  it("should import commands files from Claude Code", async () => {
    const mockRules = [
      {
        frontmatter: {
          description: "Command: fix-issue",
          targets: ["claudecode"] satisfies ToolTarget[],
          root: false,
          globs: ["**/*"],
        },
        content: "Fix GitHub issue #$ARGUMENTS by following these steps:",
        filename: "fix-issue",
        filepath: "/test/.claude/commands/fix-issue.md",
        type: "command" as const,
      },
    ];

    vi.spyOn(parsers, "parseClaudeConfiguration").mockResolvedValueOnce({
      rules: mockRules,
      errors: [],
    });

    const result = await importConfiguration({
      tool: "claudecode",
      baseDir: testDir,
    });

    expect(result.rulesCreated).toBe(1);
    expect(result.success).toBe(true);

    const createdFile = await readFile(join(testDir, ".rulesync", "commands", "fix-issue.md"), "utf-8");
    expect(createdFile).toContain("description: 'Command: fix-issue'");
    expect(createdFile).toContain("targets:");
    expect(createdFile).toContain("- claudecode");
    expect(createdFile).not.toContain("root:");
    expect(createdFile).not.toContain("globs:");
    expect(createdFile).toContain("Fix GitHub issue #$ARGUMENTS");
  });

  it("should import commands files from Gemini CLI", async () => {
    const mockRules = [
      {
        frontmatter: {
          description: "Command: optimize",
          targets: ["geminicli"] satisfies ToolTarget[],
          root: false,
          globs: ["**/*"],
        },
        content: "Optimize the code by following these steps:",
        filename: "optimize",
        filepath: "/test/.gemini/commands/optimize.md",
        type: "command" as const,
      },
    ];

    vi.spyOn(parsers, "parseGeminiConfiguration").mockResolvedValueOnce({
      rules: mockRules,
      errors: [],
    });

    const result = await importConfiguration({
      tool: "geminicli",
      baseDir: testDir,
    });

    expect(result.rulesCreated).toBe(1);
    expect(result.success).toBe(true);

    const createdFile = await readFile(join(testDir, ".rulesync", "commands", "optimize.md"), "utf-8");
    expect(createdFile).toContain("description: 'Command: optimize'");
    expect(createdFile).toContain("targets:");
    expect(createdFile).toContain("- geminicli");
    expect(createdFile).not.toContain("root:");
    expect(createdFile).not.toContain("globs:");
    expect(createdFile).toContain("Optimize the code by following");
  });
});

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IgnoreProcessor } from "../ignore/ignore-processor.js";
import * as parsers from "../parsers/index.js";
// import { RulesProcessor } from "../rules/rules-processor.js"; // Not used in this version
import { setupTestDirectory } from "../test-utils/index.js";
import type { ToolTarget } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { importConfiguration } from "./importer.js";

vi.mock("../parsers");
vi.mock("../ignore/ignore-processor.js", () => ({
  IgnoreProcessor: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("../commands/commands-processor.js", () => {
  const MockCommandsProcessor: any = vi.fn().mockImplementation(() => ({
    loadToolFiles: vi.fn().mockResolvedValue([]),
    convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([]),
    writeAiFiles: vi.fn().mockResolvedValue(0),
  }));
  MockCommandsProcessor.getToolTargets = vi.fn();
  return { CommandsProcessor: MockCommandsProcessor };
});
// vi.mock("../rules/rules-processor"); // Not used in this version

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

    // Set up default IgnoreProcessor mock
    const defaultIgnoreProcessor = {
      loadToolFiles: vi.fn().mockResolvedValue([]),
      convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([]),
      writeAiFiles: vi.fn().mockResolvedValue(0),
    };
    vi.mocked(IgnoreProcessor).mockImplementation(() => defaultIgnoreProcessor as any);

    // Mock IgnoreProcessor.getToolTargets static method
    (IgnoreProcessor as any).getToolTargets = vi
      .fn()
      .mockReturnValue([
        "augmentcode",
        "claudecode",
        "cline",
        "codexcli",
        "copilot",
        "cursor",
        "geminicli",
        "junie",
        "kiro",
        "opencode",
        "qwencode",
        "roo",
        "windsurf",
      ]);

    // Mock CommandsProcessor.getToolTargets static method
    const { CommandsProcessor } = await import("../commands/commands-processor.js");
    vi.mocked(CommandsProcessor.getToolTargets).mockReturnValue(["claudecode", "geminicli", "roo"]);
    // Mock RulesProcessor to return null for all tools by default (not used in this version)
    // vi.spyOn(RulesProcessor, "create").mockReturnValue(null);
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
      mcpServers: {},
    });

    // Mock CommandsProcessor to avoid interference
    const mockCommandsProcessor = {
      loadToolFiles: vi.fn().mockResolvedValue([]),
      convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue(undefined),
    };
    const { CommandsProcessor } = await import("../commands/commands-processor.js");
    vi.mocked(CommandsProcessor).mockImplementationOnce(() => mockCommandsProcessor as any);

    const result = await importConfiguration({
      tool: "claudecode",
      baseDir: testDir,
      features: ["rules"],
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

  it("should process ignore files when ignore feature is enabled", async () => {
    vi.spyOn(parsers, "parseClaudeConfiguration").mockResolvedValueOnce({
      rules: [],
      errors: [],
    });

    const mockIgnoreProcessor = {
      loadToolFiles: vi.fn().mockResolvedValue([
        {
          toRulesyncIgnore: vi.fn(),
        },
      ]),
      convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([
        {
          getFilePath: vi.fn().mockReturnValue("test-ignore.md"),
          getFileContent: vi.fn().mockReturnValue("test content"),
        },
      ]),
      writeAiFiles: vi.fn().mockResolvedValue(1),
    };

    vi.mocked(IgnoreProcessor).mockImplementation(() => mockIgnoreProcessor as any);

    const result = await importConfiguration({
      tool: "claudecode",
      baseDir: testDir,
    });

    expect(result.ignoreFileCreated).toBe(true);
    expect(IgnoreProcessor).toHaveBeenCalledWith({
      baseDir: testDir,
      toolTarget: "claudecode",
    });
    expect(mockIgnoreProcessor.loadToolFiles).toHaveBeenCalled();
    expect(mockIgnoreProcessor.convertToolFilesToRulesyncFiles).toHaveBeenCalled();
    expect(mockIgnoreProcessor.writeAiFiles).toHaveBeenCalled();
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
      features: ["rules"], // Exclude commands feature for unsupported tool
    });

    expect(result.success).toBe(false);
    expect(result.rulesCreated).toBe(0);
    expect(result.errors).toEqual(["File not found", "Invalid format"]);
  });

  it("should handle verbose mode", async () => {
    const loggerSpy = vi.spyOn(logger, "log").mockImplementation(() => {});
    const loggerSuccessSpy = vi.spyOn(logger, "success").mockImplementation(() => {});

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

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining("Importing cline configuration from"),
    );
    expect(loggerSuccessSpy).toHaveBeenCalledWith(expect.stringContaining("Created rule file:"));

    loggerSpy.mockRestore();
    loggerSuccessSpy.mockRestore();
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
    });

    const mockIgnoreProcessor = {
      loadToolFiles: vi.fn().mockResolvedValue([{ toRulesyncIgnore: vi.fn() }]),
      convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([
        {
          getFilePath: vi.fn().mockReturnValue("test-ignore.md"),
          getFileContent: vi.fn().mockReturnValue("test content"),
        },
      ]),
      writeAiFiles: vi.fn().mockResolvedValue(1),
    };

    vi.mocked(IgnoreProcessor).mockImplementation(() => mockIgnoreProcessor as any);

    const result = await importConfiguration({
      tool: "claudecode",
      baseDir: testDir,
      features: ["ignore"],
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
      features: ["mcp"],
    });

    expect(result.success).toBe(true);
    expect(result.rulesCreated).toBe(0);
    expect(result.mcpFileCreated).toBe(true);
  });

  it("should handle error processing ignore files", async () => {
    vi.spyOn(parsers, "parseClaudeConfiguration").mockResolvedValueOnce({
      rules: [],
      errors: [],
    });

    const mockIgnoreProcessor = {
      loadToolIgnores: vi.fn().mockRejectedValue(new Error("Permission denied")),
      writeRulesyncIgnoresFromToolIgnores: vi.fn(),
    };

    vi.mocked(IgnoreProcessor).mockImplementation(() => mockIgnoreProcessor as any);

    const result = await importConfiguration({
      tool: "claudecode",
      baseDir: testDir,
    });

    expect(result.ignoreFileCreated).toBe(false);
    expect(result.errors.some((e) => e.includes("Failed to process ignore files"))).toBe(true);
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
    const loggerSpy = vi.spyOn(logger, "log").mockImplementation(() => {});
    const loggerSuccessSpy = vi.spyOn(logger, "success").mockImplementation(() => {});

    vi.spyOn(parsers, "parseClaudeConfiguration").mockResolvedValueOnce({
      rules: [],
      errors: [],
      mcpServers: {
        server1: { command: "test1" },
        server2: { command: "test2" },
      },
    });

    const mockIgnoreProcessor = {
      loadToolFiles: vi
        .fn()
        .mockResolvedValue([{ toRulesyncIgnore: vi.fn() }, { toRulesyncIgnore: vi.fn() }]),
      convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([
        {
          getFilePath: vi.fn().mockReturnValue("test-ignore1.md"),
          getFileContent: vi.fn().mockReturnValue("test content 1"),
        },
        {
          getFilePath: vi.fn().mockReturnValue("test-ignore2.md"),
          getFileContent: vi.fn().mockReturnValue("test content 2"),
        },
      ]),
      writeAiFiles: vi.fn().mockResolvedValue(2),
    };

    vi.mocked(IgnoreProcessor).mockImplementation(() => mockIgnoreProcessor as any);

    await importConfiguration({
      tool: "claudecode",
      baseDir: testDir,
      verbose: true,
    });

    // Check that verbose log was called for importing
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining("Importing claudecode configuration from"),
    );

    // Check that the ignore and MCP creation logs were called
    const successCalls = loggerSuccessSpy.mock.calls.map((call) => call[0]);
    expect(
      successCalls.some((msg) =>
        msg.includes("Created ignore files from 2 tool ignore configurations"),
      ),
    ).toBe(true);
    expect(successCalls.some((msg) => msg.includes("Created .mcp.json with 2 servers"))).toBe(true);

    loggerSpy.mockRestore();
    loggerSuccessSpy.mockRestore();
  });

  it("should handle CommandsProcessor integration for Claude Code", async () => {
    const loggerSuccessSpy = vi.spyOn(logger, "success").mockImplementation(() => {});

    // Mock CommandsProcessor constructor and methods
    const mockCommandsProcessor = {
      loadToolFiles: vi.fn().mockResolvedValue([
        { name: "fix-issue", description: "Fix GitHub issues" },
        { name: "optimize", description: "Optimize code" },
      ]),
      convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([
        { name: "fix-issue", description: "Fix GitHub issues" },
        { name: "optimize", description: "Optimize code" },
      ]),
      writeAiFiles: vi.fn().mockResolvedValue(2),
    };

    const { CommandsProcessor } = await import("../commands/commands-processor.js");
    vi.mocked(CommandsProcessor).mockImplementationOnce(() => mockCommandsProcessor as any);

    vi.spyOn(parsers, "parseClaudeConfiguration").mockResolvedValueOnce({
      rules: [],
      errors: [],
    });

    const result = await importConfiguration({
      tool: "claudecode",
      baseDir: testDir,
      verbose: true,
      features: ["commands"],
    });

    expect(result.success).toBe(true);
    expect(result.commandsCreated).toBe(2);
    expect(mockCommandsProcessor.loadToolFiles).toHaveBeenCalled();
    expect(mockCommandsProcessor.convertToolFilesToRulesyncFiles).toHaveBeenCalled();
    expect(mockCommandsProcessor.writeAiFiles).toHaveBeenCalled();
    expect(loggerSuccessSpy).toHaveBeenCalledWith("Created 2 command files");

    loggerSuccessSpy.mockRestore();
  });

  it("should handle CommandsProcessor integration for Gemini CLI", async () => {
    const mockCommandsProcessor = {
      loadToolFiles: vi
        .fn()
        .mockResolvedValue([{ name: "plan", description: "Create implementation plan" }]),
      convertToolFilesToRulesyncFiles: vi
        .fn()
        .mockResolvedValue([{ name: "plan", description: "Create implementation plan" }]),
      writeAiFiles: vi.fn().mockResolvedValue(1),
    };

    const { CommandsProcessor } = await import("../commands/commands-processor.js");
    vi.mocked(CommandsProcessor).mockImplementationOnce(() => mockCommandsProcessor as any);

    vi.spyOn(parsers, "parseGeminiConfiguration").mockResolvedValueOnce({
      rules: [],
      errors: [],
    });

    const result = await importConfiguration({
      tool: "geminicli",
      baseDir: testDir,
      features: ["commands"],
    });

    expect(result.success).toBe(true);
    expect(result.commandsCreated).toBe(1);
    expect(mockCommandsProcessor.loadToolFiles).toHaveBeenCalled();
    expect(mockCommandsProcessor.convertToolFilesToRulesyncFiles).toHaveBeenCalled();
    expect(mockCommandsProcessor.writeAiFiles).toHaveBeenCalled();
  });

  it("should handle CommandsProcessor errors", async () => {
    const mockCommandsProcessor = {
      loadToolFiles: vi.fn().mockRejectedValue(new Error("Commands directory not found")),
      convertToolFilesToRulesyncFiles: vi.fn(),
      writeAiFiles: vi.fn(),
    };

    const { CommandsProcessor } = await import("../commands/commands-processor.js");
    vi.mocked(CommandsProcessor).mockImplementationOnce(() => mockCommandsProcessor as any);

    vi.spyOn(parsers, "parseClaudeConfiguration").mockResolvedValueOnce({
      rules: [],
      errors: [],
    });

    const result = await importConfiguration({
      tool: "claudecode",
      baseDir: testDir,
      features: ["commands"],
    });

    expect(result.success).toBe(false);
    expect(result.commandsCreated).toBeUndefined();
    expect(result.errors).toContain(
      "Failed to create commands directory: Commands directory not found",
    );
  });

  it("should skip CommandsProcessor for unsupported tools", async () => {
    const mockCommandsProcessor = {
      loadToolFiles: vi.fn(),
      convertToolFilesToRulesyncFiles: vi.fn(),
      writeAiFiles: vi.fn(),
    };

    const { CommandsProcessor } = await import("../commands/commands-processor.js");
    vi.mocked(CommandsProcessor).mockImplementationOnce(() => mockCommandsProcessor as any);

    vi.spyOn(parsers, "parseJunieConfiguration").mockResolvedValueOnce({
      rules: [],
      errors: [],
    });

    const result = await importConfiguration({
      tool: "junie",
      baseDir: testDir,
    });

    expect(result.commandsCreated).toBeUndefined();
    expect(mockCommandsProcessor.loadToolFiles).not.toHaveBeenCalled();
  });

  it("should filter out commands from regular rules processing", async () => {
    const mockRules = [
      {
        frontmatter: {
          root: false,
          targets: ["claudecode"] satisfies ToolTarget[],
          description: "Regular rule",
          globs: ["**/*"],
        },
        content: "Regular rule content",
        filename: "regular-rule",
        filepath: "/test/regular.md",
      },
      {
        frontmatter: {
          root: false,
          description: "Command: fix-issue",
          targets: ["claudecode"] satisfies ToolTarget[],
          globs: ["**/*"],
        },
        content: "Fix GitHub issue",
        filename: "fix-issue",
        filepath: "/test/.claude/commands/fix-issue.md",
        type: "command" as const,
      },
    ];

    vi.spyOn(parsers, "parseClaudeConfiguration").mockResolvedValueOnce({
      rules: mockRules,
      errors: [],
    });

    // Mock CommandsProcessor to return empty
    const mockCommandsProcessor = {
      loadToolFiles: vi.fn().mockResolvedValue([]),
      convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([]),
      writeAiFiles: vi.fn().mockResolvedValue(0),
    };
    const { CommandsProcessor } = await import("../commands/commands-processor.js");
    vi.mocked(CommandsProcessor).mockImplementationOnce(() => mockCommandsProcessor as any);

    const result = await importConfiguration({
      tool: "claudecode",
      baseDir: testDir,
      features: ["rules"], // Only enable rules feature
    });

    expect(result.success).toBe(true);
    expect(result.rulesCreated).toBe(1); // Only the regular rule
    expect(result.commandsCreated).toBeUndefined(); // No commands from CommandsProcessor

    // Only regular rule file should be created
    const createdFile = await readFile(join(rulesDir, "regular-rule.md"), "utf-8");
    expect(createdFile).toContain("Regular rule content");
  });

  it("should not create ignore files when no tool ignores are found", async () => {
    vi.spyOn(parsers, "parseClaudeConfiguration").mockResolvedValueOnce({
      rules: [],
      errors: [],
    });

    const mockIgnoreProcessor = {
      loadToolFiles: vi.fn().mockResolvedValue([]), // Empty array
      convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([]),
      writeAiFiles: vi.fn().mockResolvedValue(0),
    };

    vi.mocked(IgnoreProcessor).mockImplementation(() => mockIgnoreProcessor as any);

    const result = await importConfiguration({
      tool: "claudecode",
      baseDir: testDir,
    });

    expect(result.ignoreFileCreated).toBe(false);
    expect(mockIgnoreProcessor.loadToolFiles).toHaveBeenCalled();
    expect(mockIgnoreProcessor.writeAiFiles).not.toHaveBeenCalled();
  });

  // it("should use RulesProcessor when available", async () => {
  //   // RulesProcessor functionality has been replaced by CommandsProcessor and direct rule processing
  // });

  // it("should handle RulesProcessor errors gracefully", async () => {
  //   // RulesProcessor functionality has been replaced by CommandsProcessor and direct rule processing
  // });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigResolver } from "./config/config-resolver.js";
import type { Config } from "./config/config.js";
import { generate, importFromTool } from "./index.js";
import type { GenerateResult } from "./lib/generate.js";
import { checkRulesyncDirExists, generate as coreGenerate } from "./lib/generate.js";
import type { ImportResult } from "./lib/import.js";
import { importFromTool as coreImportFromTool } from "./lib/import.js";
import { ConsoleLogger } from "./utils/logger.js";

vi.mock("./config/config-resolver.js");
vi.mock("./lib/generate.js");
vi.mock("./lib/import.js");
vi.mock("./utils/logger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils/logger.js")>();
  const MockConsoleLogger = vi.fn().mockImplementation(function () {
    return {
      configure: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });
  return {
    ...actual,
    ConsoleLogger: MockConsoleLogger,
  };
});

const mockConfig = {
  getBaseDirs: () => ["/project"],
} as unknown as Config;

const mockGenerateResult: GenerateResult = {
  rulesCount: 1,
  rulesPaths: ["/project/.cursorrules"],
  ignoreCount: 0,
  ignorePaths: [],
  mcpCount: 0,
  mcpPaths: [],
  commandsCount: 0,
  commandsPaths: [],
  subagentsCount: 0,
  subagentsPaths: [],
  skillsCount: 0,
  skillsPaths: [],
  scheduledTasksCount: 0,
  scheduledTasksPaths: [],
  hooksCount: 0,
  hooksPaths: [],
  permissionsCount: 0,
  permissionsPaths: [],
  skills: [],
  hasDiff: false,
};

const mockImportResult: ImportResult = {
  rulesCount: 1,
  ignoreCount: 0,
  mcpCount: 0,
  commandsCount: 0,
  subagentsCount: 0,
  skillsCount: 0,
  scheduledTasksCount: 0,
  hooksCount: 0,
  permissionsCount: 0,
};

beforeEach(() => {
  vi.mocked(ConfigResolver.resolve).mockResolvedValue(mockConfig as never);
  vi.mocked(checkRulesyncDirExists).mockResolvedValue(true);
  vi.mocked(coreGenerate).mockResolvedValue(mockGenerateResult);
  vi.mocked(coreImportFromTool).mockResolvedValue(mockImportResult);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("generate", () => {
  it("should default silent to true", async () => {
    await generate();

    expect(ConsoleLogger).toHaveBeenCalledWith({ verbose: false, silent: true });
  });

  it("should allow overriding silent to false", async () => {
    await generate({ silent: false });

    expect(ConsoleLogger).toHaveBeenCalledWith({ verbose: false, silent: false });
  });

  it("should pass options to ConfigResolver.resolve", async () => {
    await generate({
      targets: ["claudecode", "cursor"],
      features: ["rules", "mcp"],
      verbose: true,
      silent: false,
    });

    expect(ConfigResolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: ["claudecode", "cursor"],
        features: ["rules", "mcp"],
        verbose: true,
        silent: false,
      }),
    );
  });

  it("should throw if .rulesync directory does not exist", async () => {
    vi.mocked(checkRulesyncDirExists).mockResolvedValue(false);

    await expect(generate()).rejects.toThrow(".rulesync directory not found");
  });

  it("should call core generate and return result", async () => {
    const result = await generate();

    expect(coreGenerate).toHaveBeenCalledWith(expect.objectContaining({ config: mockConfig }));
    expect(result).toEqual(mockGenerateResult);
  });
});

describe("importFromTool", () => {
  it("should default silent to true", async () => {
    await importFromTool({ target: "claudecode" });

    expect(ConsoleLogger).toHaveBeenCalledWith({ verbose: false, silent: true });
  });

  it("should wrap target in array for ConfigResolver", async () => {
    await importFromTool({ target: "cursor" });

    expect(ConfigResolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: ["cursor"],
      }),
    );
  });

  it("should call core importFromTool with correct tool", async () => {
    const result = await importFromTool({ target: "claudecode" });

    expect(coreImportFromTool).toHaveBeenCalledWith(
      expect.objectContaining({ config: mockConfig, tool: "claudecode" }),
    );
    expect(result).toEqual(mockImportResult);
  });

  it("should pass features and other options through", async () => {
    await importFromTool({
      target: "claudecode",
      features: ["rules", "commands"],
      verbose: true,
      silent: false,
    });

    expect(ConfigResolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: ["claudecode"],
        features: ["rules", "commands"],
        verbose: true,
        silent: false,
      }),
    );
  });
});

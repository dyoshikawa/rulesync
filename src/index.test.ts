import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Config } from "./config/config.js";
import type { GenerateResult } from "./lib/generate.js";
import type { ImportResult } from "./lib/import.js";

import { ConfigResolver } from "./config/config-resolver.js";
import { generate, importFromTool } from "./index.js";
import { checkRulesyncDirExists, generate as coreGenerate } from "./lib/generate.js";
import { importFromTool as coreImportFromTool } from "./lib/import.js";
import { logger } from "./utils/logger.js";

vi.mock("./config/config-resolver.js");
vi.mock("./lib/generate.js");
vi.mock("./lib/import.js");
vi.mock("./utils/logger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils/logger.js")>();
  return {
    ...actual,
    logger: {
      configure: vi.fn(),
    },
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
  hooksCount: 0,
  hooksPaths: [],
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
  hooksCount: 0,
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

    expect(logger.configure).toHaveBeenCalledWith({ verbose: false, silent: true });
  });

  it("should allow overriding silent to false", async () => {
    await generate({ silent: false });

    expect(logger.configure).toHaveBeenCalledWith({ verbose: false, silent: false });
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

    expect(coreGenerate).toHaveBeenCalledWith({ config: mockConfig });
    expect(result).toEqual(mockGenerateResult);
  });
});

describe("importFromTool", () => {
  it("should default silent to true", async () => {
    await importFromTool({ target: "claudecode" });

    expect(logger.configure).toHaveBeenCalledWith({ verbose: false, silent: true });
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

    expect(coreImportFromTool).toHaveBeenCalledWith({ config: mockConfig, tool: "claudecode" });
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

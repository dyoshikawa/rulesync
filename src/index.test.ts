import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigResolver } from "./config/config-resolver.js";
import type { Config } from "./config/config.js";
import { convertFromTool, generate, importFromTool } from "./index.js";
import type { ConvertResult } from "./lib/convert.js";
import { convertFromTool as coreConvertFromTool } from "./lib/convert.js";
import type { GenerateResult } from "./lib/generate.js";
import { checkRulesyncDirExists, generate as coreGenerate } from "./lib/generate.js";
import type { ImportResult } from "./lib/import.js";
import { importFromTool as coreImportFromTool } from "./lib/import.js";
import { ConsoleLogger } from "./utils/logger.js";

vi.mock("./config/config-resolver.js");
vi.mock("./lib/generate.js");
vi.mock("./lib/import.js");
vi.mock("./lib/convert.js");
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
  getInputRoot: () => process.cwd(),
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
  hooksCount: 0,
  permissionsCount: 0,
};

const mockConvertResult: ConvertResult = {
  rulesCount: 1,
  ignoreCount: 0,
  mcpCount: 0,
  commandsCount: 0,
  subagentsCount: 0,
  skillsCount: 0,
  hooksCount: 0,
  permissionsCount: 0,
};

beforeEach(() => {
  vi.mocked(ConfigResolver.resolve).mockResolvedValue(mockConfig as never);
  vi.mocked(checkRulesyncDirExists).mockResolvedValue(true);
  vi.mocked(coreGenerate).mockResolvedValue(mockGenerateResult);
  vi.mocked(coreImportFromTool).mockResolvedValue(mockImportResult);
  vi.mocked(coreConvertFromTool).mockResolvedValue(mockConvertResult);
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

  it("should probe checkRulesyncDirExists against config.getInputRoot() rather than each baseDir", async () => {
    const inputRootMock = "/some/input-root";
    vi.mocked(ConfigResolver.resolve).mockResolvedValue({
      getBaseDirs: () => ["/project-a", "/project-b"],
      getInputRoot: () => inputRootMock,
    } as unknown as Config as never);

    await generate();

    // Single check, scoped to the input root, not per baseDir.
    expect(checkRulesyncDirExists).toHaveBeenCalledTimes(1);
    expect(checkRulesyncDirExists).toHaveBeenCalledWith({ baseDir: inputRootMock });
  });

  it("should forward inputRoot to ConfigResolver.resolve", async () => {
    await generate({ inputRoot: "./central-rules" });

    expect(ConfigResolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ inputRoot: "./central-rules" }),
    );
  });

  it("should mention the input root path in the not-found error", async () => {
    const inputRootMock = "/some/input-root";
    vi.mocked(ConfigResolver.resolve).mockResolvedValue({
      getBaseDirs: () => ["/project"],
      getInputRoot: () => inputRootMock,
    } as unknown as Config as never);
    vi.mocked(checkRulesyncDirExists).mockResolvedValue(false);

    await expect(generate()).rejects.toThrow(
      `.rulesync directory not found in '${inputRootMock}'.`,
    );
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

describe("convertFromTool", () => {
  it("should throw when from is empty", async () => {
    await expect(
      convertFromTool({ from: "" as unknown as "claudecode", to: ["cursor"] }),
    ).rejects.toThrow("from is required");
  });

  it("should throw when to is empty", async () => {
    await expect(convertFromTool({ from: "claudecode", to: [] })).rejects.toThrow("to is required");
  });

  it("should throw when to includes from (self-conversion)", async () => {
    await expect(
      convertFromTool({ from: "claudecode", to: ["cursor", "claudecode"] }),
    ).rejects.toThrow("Destination tools must not include the source tool 'claudecode'");
  });

  it("should deduplicate to array before forwarding to core convertFromTool", async () => {
    await convertFromTool({
      from: "claudecode",
      to: ["cursor", "cursor", "copilot", "cursor"],
    });

    expect(coreConvertFromTool).toHaveBeenCalledWith(
      expect.objectContaining({
        fromTool: "claudecode",
        toTools: ["cursor", "copilot"],
      }),
    );
  });

  it("should default silent to true", async () => {
    await convertFromTool({ from: "claudecode", to: ["cursor"] });

    expect(ConsoleLogger).toHaveBeenCalledWith({ verbose: false, silent: true });
  });

  it("should pass from as a single-element targets array to ConfigResolver", async () => {
    await convertFromTool({ from: "claudecode", to: ["cursor"] });

    expect(ConfigResolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: ["claudecode"],
      }),
    );
  });

  it("should default features to ['*'] when not provided (matches CLI behavior)", async () => {
    await convertFromTool({ from: "claudecode", to: ["cursor"] });

    expect(ConfigResolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        features: ["*"],
      }),
    );
  });

  it("should call core convertFromTool with correct arguments and return result", async () => {
    const result = await convertFromTool({
      from: "claudecode",
      to: ["cursor", "copilot"],
    });

    expect(coreConvertFromTool).toHaveBeenCalledWith(
      expect.objectContaining({
        config: mockConfig,
        fromTool: "claudecode",
        toTools: ["cursor", "copilot"],
      }),
    );
    expect(result).toEqual(mockConvertResult);
  });

  it("should pass features and other options through", async () => {
    await convertFromTool({
      from: "claudecode",
      to: ["cursor"],
      features: ["rules", "commands"],
      verbose: true,
      silent: false,
      dryRun: true,
    });

    expect(ConfigResolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: ["claudecode"],
        features: ["rules", "commands"],
        verbose: true,
        silent: false,
        dryRun: true,
      }),
    );
  });
});

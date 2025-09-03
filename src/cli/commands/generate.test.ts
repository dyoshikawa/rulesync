import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configResolver from "../../config/config-resolver.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import * as fileUtils from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import { generateCommand } from "./generate.js";

vi.mock("../../config/config-resolver.js");
vi.mock("../../utils/file.js");
vi.mock("../../utils/logger.js");
vi.mock("../../commands/commands-processor.js");
vi.mock("../../ignore/ignore-processor.js");
vi.mock("../../mcp/mcp-processor.js");
vi.mock("../../rules/rules-processor.js");
vi.mock("../../subagents/subagents-processor.js");

describe("generateCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let mockConfig: any;
  let mockProcessor: any;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());

    mockProcessor = {
      loadToolFiles: vi.fn().mockResolvedValue([]),
      removeAiFiles: vi.fn().mockResolvedValue(undefined),
      loadRulesyncFiles: vi.fn().mockResolvedValue([]),
      loadLegacyRulesyncFiles: vi.fn().mockResolvedValue([]),
      convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([]),
      writeAiFiles: vi.fn().mockResolvedValue(2),
    };

    mockConfig = {
      getVerbose: vi.fn().mockReturnValue(false),
      getBaseDirs: vi.fn().mockReturnValue([testDir]),
      getTargets: vi.fn().mockReturnValue(["cursor", "copilot"]),
      getFeatures: vi.fn().mockReturnValue(["rules", "ignore", "mcp", "commands", "subagents"]),
      getDelete: vi.fn().mockReturnValue(false),
    };

    vi.mocked(configResolver.ConfigResolver.resolve).mockResolvedValue(mockConfig);
    vi.mocked(fileUtils.fileExists).mockResolvedValue(true);
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  it("should exit if .rulesync directory does not exist", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.mocked(fileUtils.fileExists).mockResolvedValue(false);

    await generateCommand({});

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      "❌ .rulesync directory not found. Run 'rulesync init' first.",
    );

    exitSpy.mockRestore();
  });

  it("should set logger verbosity based on config", async () => {
    mockConfig.getVerbose.mockReturnValue(true);

    await generateCommand({});

    expect(logger.setVerbose).toHaveBeenCalledWith(true);
  });

  it("should skip rules generation when not in features", async () => {
    mockConfig.getFeatures.mockReturnValue([]);

    await generateCommand({});

    expect(logger.info).toHaveBeenCalledWith("Skipping rule generation (not in --features)");
  });

  it("should skip MCP generation when not in features", async () => {
    mockConfig.getFeatures.mockReturnValue([]);

    await generateCommand({});

    expect(logger.info).toHaveBeenCalledWith(
      "Skipping MCP configuration generation (not in --features)",
    );
  });

  it("should skip commands generation when not in features", async () => {
    mockConfig.getFeatures.mockReturnValue([]);

    await generateCommand({});

    expect(logger.info).toHaveBeenCalledWith(
      "Skipping command file generation (not in --features)",
    );
  });

  it("should warn when no files are generated", async () => {
    mockConfig.getFeatures.mockReturnValue(["rules"]);
    mockProcessor.writeAiFiles.mockResolvedValue(0);

    // Mock processor constructors to return mockProcessor
    const { RulesProcessor } = await import("../../rules/rules-processor.js");
    vi.mocked(RulesProcessor).mockImplementation(() => mockProcessor as any);
    vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["cursor", "copilot"]);

    await generateCommand({});

    expect(logger.warn).toHaveBeenCalledWith("⚠️  No files generated for enabled features: rules");
  });

  it("should show success message when files are generated", async () => {
    mockConfig.getFeatures.mockReturnValue(["rules"]);
    mockProcessor.writeAiFiles.mockResolvedValue(3);

    // Mock processor constructors to return mockProcessor
    const { RulesProcessor } = await import("../../rules/rules-processor.js");
    vi.mocked(RulesProcessor).mockImplementation(() => mockProcessor as any);
    vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["cursor", "copilot"]);

    await generateCommand({});

    expect(logger.success).toHaveBeenCalledWith("🎉 All done! Generated 6 file(s) total (6 rules)");
  });

  it("should handle delete option correctly", async () => {
    mockConfig.getDelete.mockReturnValue(true);
    mockConfig.getFeatures.mockReturnValue(["rules"]);
    const oldToolFiles = [{ filePath: "test.md", content: "old" }];
    mockProcessor.loadToolFiles.mockResolvedValue(oldToolFiles);

    // Mock processor constructors to return mockProcessor
    const { RulesProcessor } = await import("../../rules/rules-processor.js");
    vi.mocked(RulesProcessor).mockImplementation(() => mockProcessor as any);
    vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["cursor", "copilot"]);

    await generateCommand({});

    expect(mockProcessor.removeAiFiles).toHaveBeenCalledWith(oldToolFiles);
  });

  it("should handle ignore files with error handling", async () => {
    mockConfig.getFeatures.mockReturnValue(["ignore"]);

    // Mock processor to throw error for ignore processing
    const errorProcessor = {
      ...mockProcessor,
      loadRulesyncFiles: vi.fn().mockRejectedValue(new Error("Test error")),
    };

    const { IgnoreProcessor } = await import("../../ignore/ignore-processor.js");
    vi.mocked(IgnoreProcessor).mockImplementation(() => errorProcessor as any);
    vi.mocked(IgnoreProcessor.getToolTargets).mockReturnValue(["cursor"]);

    await generateCommand({});

    expect(logger.warn).toHaveBeenCalledWith(
      `Failed to generate cursor ignore files for ${testDir}:`,
      "Test error",
    );
  });
});

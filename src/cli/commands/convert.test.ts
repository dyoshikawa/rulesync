import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigResolver } from "../../config/config-resolver.js";
import { RulesProcessor } from "../../features/rules/rules-processor.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import type { ConvertOptions } from "./convert.js";
import { convertCommand } from "./convert.js";

vi.mock("../../config/config-resolver.js");
vi.mock("../../features/rules/rules-processor.js");
vi.mock("../../features/ignore/ignore-processor.js");
vi.mock("../../features/mcp/mcp-processor.js");
vi.mock("../../features/subagents/subagents-processor.js");
vi.mock("../../features/commands/commands-processor.js");
vi.mock("../../features/skills/skills-processor.js");
vi.mock("../../features/hooks/hooks-processor.js");
vi.mock("../../features/permissions/permissions-processor.js");

describe("convertCommand", () => {
  let mockConfig: {
    getVerbose: ReturnType<typeof vi.fn>;
    getSilent: ReturnType<typeof vi.fn>;
    getBaseDirs: ReturnType<typeof vi.fn>;
    getFeatures: ReturnType<typeof vi.fn>;
    getFeatureOptions: ReturnType<typeof vi.fn>;
    getGlobal: ReturnType<typeof vi.fn>;
    getDryRun: ReturnType<typeof vi.fn>;
    isPreviewMode: ReturnType<typeof vi.fn>;
  };
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockConfig = {
      getVerbose: vi.fn().mockReturnValue(false),
      getSilent: vi.fn().mockReturnValue(false),
      getBaseDirs: vi.fn().mockReturnValue(["."]),
      getFeatures: vi.fn().mockReturnValue(["rules"]),
      getFeatureOptions: vi.fn().mockReturnValue(undefined),
      getGlobal: vi.fn().mockReturnValue(false),
      getDryRun: vi.fn().mockReturnValue(false),
      isPreviewMode: vi.fn().mockReturnValue(false),
    };

    vi.mocked(ConfigResolver.resolve).mockResolvedValue(mockConfig as never);
    mockLogger = createMockLogger();

    vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["cursor", "claudecode", "copilot"]);
    vi.mocked(RulesProcessor).mockImplementation(function () {
      return {
        loadToolFiles: vi.fn().mockResolvedValue([{ file: "source" }]),
        convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([{ file: "rulesync" }]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ file: "dest" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
      } as never;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("validation", () => {
    // Presence of --from / --to is enforced by commander's requiredOption in
    // src/cli/index.ts, so convertCommand itself only validates tool names.
    it("should throw on invalid source tool", async () => {
      const options: ConvertOptions = { from: "not-a-tool", to: ["claudecode"] };
      await expect(convertCommand(mockLogger, options)).rejects.toThrow(/Invalid source tool/);
    });

    it("should throw on invalid destination tool", async () => {
      const options: ConvertOptions = { from: "cursor", to: ["claudecode", "bogus"] };
      await expect(convertCommand(mockLogger, options)).rejects.toThrow(/Invalid destination tool/);
    });

    it("should throw when destinations include the source tool", async () => {
      const options: ConvertOptions = { from: "cursor", to: ["claudecode", "cursor"] };
      await expect(convertCommand(mockLogger, options)).rejects.toThrow(
        /Destination tools must not include the source tool/,
      );
    });

    it("should deduplicate duplicated destination tools", async () => {
      const options: ConvertOptions = { from: "cursor", to: ["claudecode", "claudecode"] };

      await convertCommand(mockLogger, options);

      expect(ConfigResolver.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ targets: ["cursor", "claudecode"] }),
      );
    });
  });

  describe("successful convert", () => {
    it("should convert rules from cursor to claudecode", async () => {
      const options: ConvertOptions = { from: "cursor", to: ["claudecode"] };

      await convertCommand(mockLogger, options);

      expect(ConfigResolver.resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          targets: ["cursor", "claudecode"],
          features: ["*"],
        }),
      );

      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({ toolTarget: "cursor" }),
      );
      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({ toolTarget: "claudecode" }),
      );
      expect(mockLogger.success).toHaveBeenCalledWith(expect.stringContaining("Converted"));
    });

    it("should pass user-supplied features to ConfigResolver", async () => {
      const options: ConvertOptions = {
        from: "cursor",
        to: ["claudecode"],
        features: ["rules", "mcp"],
      };

      await convertCommand(mockLogger, options);

      expect(ConfigResolver.resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          features: ["rules", "mcp"],
        }),
      );
    });

    it("should log with [DRY RUN] prefix and use info in preview mode", async () => {
      mockConfig.isPreviewMode.mockReturnValue(true);

      const options: ConvertOptions = { from: "cursor", to: ["claudecode"] };

      await convertCommand(mockLogger, options);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/^\[DRY RUN\] Would convert/),
      );
      expect(mockLogger.success).not.toHaveBeenCalled();
    });

    it("should warn and return when nothing was converted", async () => {
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return {
          loadToolFiles: vi.fn().mockResolvedValue([]),
          convertToolFilesToRulesyncFiles: vi.fn(),
          convertRulesyncFilesToToolFiles: vi.fn(),
          writeAiFiles: vi.fn(),
        } as never;
      });

      const options: ConvertOptions = { from: "cursor", to: ["claudecode"] };

      await convertCommand(mockLogger, options);

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("No files converted"));
      expect(mockLogger.success).not.toHaveBeenCalled();
    });
  });

  describe("global mode", () => {
    it("should pass global=true to ConfigResolver when requested", async () => {
      const options: ConvertOptions = {
        from: "cursor",
        to: ["claudecode"],
        global: true,
      };

      await convertCommand(mockLogger, options);

      expect(ConfigResolver.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ global: true }),
      );
    });
  });
});

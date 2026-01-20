import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GenerateOptions } from "./generate.js";

import { generate } from "../../core/generate.js";
import { formatError } from "../../utils/error.js";
import { logger } from "../../utils/logger.js";
import { generateCommand } from "./generate.js";

// Mock dependencies
vi.mock("../../core/generate.js");
vi.mock("../../utils/error.js");
vi.mock("../../utils/logger.js");

describe("generateCommand", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Mock process.exit
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("Process exit");
    }) as unknown as (code?: string | number | null) => never);

    // Setup logger mocks
    vi.mocked(logger.setVerbose).mockImplementation(() => {});
    vi.mocked(logger.info).mockImplementation(() => {});
    vi.mocked(logger.error).mockImplementation(() => {});
    vi.mocked(logger.success).mockImplementation(() => {});
    vi.mocked(logger.warn).mockImplementation(() => {});

    // Setup default mocks
    vi.mocked(generate).mockResolvedValue(5);
    vi.mocked(formatError).mockImplementation((error) =>
      error instanceof Error ? error.message : String(error),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("initial setup", () => {
    it("should set verbose to false by default", async () => {
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.setVerbose).toHaveBeenCalledWith(false);
    });

    it("should set verbose to true when options.verbose is true", async () => {
      const options: GenerateOptions = { verbose: true };

      await generateCommand(options);

      expect(logger.setVerbose).toHaveBeenCalledWith(true);
    });

    it("should log generating files message", async () => {
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.info).toHaveBeenCalledWith("Generating files...");
    });
  });

  describe("calling core generate function", () => {
    it("should call generate with provided options", async () => {
      const options: GenerateOptions = {
        targets: ["claudecode", "cursor"],
        features: ["rules", "mcp"],
        verbose: true,
      };

      await generateCommand(options);

      expect(generate).toHaveBeenCalledWith(options);
    });
  });

  describe("success handling", () => {
    it("should log success message with total count", async () => {
      vi.mocked(generate).mockResolvedValue(10);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.success).toHaveBeenCalledWith("🎉 All done! Generated 10 file(s) total");
    });

    it("should log warning when no files generated", async () => {
      vi.mocked(generate).mockResolvedValue(0);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.warn).toHaveBeenCalledWith("⚠️  No files generated for enabled features");
      expect(logger.success).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should log error and exit with code 1 when generate throws", async () => {
      vi.mocked(generate).mockRejectedValue(
        new Error(".rulesync directory not found. Run 'rulesync init' first."),
      );
      const options: GenerateOptions = {};

      await expect(generateCommand(options)).rejects.toThrow("Process exit");

      expect(logger.error).toHaveBeenCalledWith(
        "❌ .rulesync directory not found. Run 'rulesync init' first.",
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should format error message using formatError", async () => {
      const error = new Error("Test error");
      vi.mocked(generate).mockRejectedValue(error);
      vi.mocked(formatError).mockReturnValue("Formatted: Test error");
      const options: GenerateOptions = {};

      await expect(generateCommand(options)).rejects.toThrow("Process exit");

      expect(formatError).toHaveBeenCalledWith(error);
      expect(logger.error).toHaveBeenCalledWith("❌ Formatted: Test error");
    });
  });
});

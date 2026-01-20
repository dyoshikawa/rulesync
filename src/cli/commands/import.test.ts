import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ImportOptions } from "./import.js";

import { importFrom } from "../../core/import.js";
import { formatError } from "../../utils/error.js";
import { logger } from "../../utils/logger.js";
import { importCommand } from "./import.js";

// Mock dependencies
vi.mock("../../core/import.js");
vi.mock("../../utils/error.js");
vi.mock("../../utils/logger.js");

describe("importCommand", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Mock process.exit
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("Process exit");
    }) as unknown as (code?: string | number | null) => never);

    // Setup logger mocks
    vi.mocked(logger.setVerbose).mockImplementation(() => {});
    vi.mocked(logger.error).mockImplementation(() => {});
    vi.mocked(logger.success).mockImplementation(() => {});

    // Setup default mocks
    vi.mocked(importFrom).mockResolvedValue(5);
    vi.mocked(formatError).mockImplementation((error) =>
      error instanceof Error ? error.message : String(error),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("initial setup", () => {
    it("should set verbose to false by default", async () => {
      const options: ImportOptions = { targets: ["claudecode"] };

      await importCommand(options);

      expect(logger.setVerbose).toHaveBeenCalledWith(false);
    });

    it("should set verbose to true when options.verbose is true", async () => {
      const options: ImportOptions = { targets: ["claudecode"], verbose: true };

      await importCommand(options);

      expect(logger.setVerbose).toHaveBeenCalledWith(true);
    });
  });

  describe("calling core importFrom function", () => {
    it("should call importFrom with provided options", async () => {
      const options: ImportOptions = {
        targets: ["claudecode"],
        features: ["rules", "commands"],
        verbose: true,
      };

      await importCommand(options);

      expect(importFrom).toHaveBeenCalledWith(options);
    });
  });

  describe("success handling", () => {
    it("should log success message with total count when files imported", async () => {
      vi.mocked(importFrom).mockResolvedValue(10);
      const options: ImportOptions = { targets: ["claudecode"] };

      await importCommand(options);

      expect(logger.success).toHaveBeenCalledWith("Imported 10 file(s)");
    });

    it("should not log success when no files imported", async () => {
      vi.mocked(importFrom).mockResolvedValue(0);
      const options: ImportOptions = { targets: ["claudecode"] };

      await importCommand(options);

      expect(logger.success).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should log error and exit with code 1 when no targets provided", async () => {
      vi.mocked(importFrom).mockRejectedValue(new Error("No tools found in targets"));
      const options: ImportOptions = {};

      await expect(importCommand(options)).rejects.toThrow("Process exit");

      expect(logger.error).toHaveBeenCalledWith("❌ No tools found in targets");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should log error and exit with code 1 when multiple targets provided", async () => {
      vi.mocked(importFrom).mockRejectedValue(new Error("Only one tool can be imported at a time"));
      const options: ImportOptions = { targets: ["claudecode", "cursor"] };

      await expect(importCommand(options)).rejects.toThrow("Process exit");

      expect(logger.error).toHaveBeenCalledWith("❌ Only one tool can be imported at a time");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should format error message using formatError", async () => {
      const error = new Error("Test error");
      vi.mocked(importFrom).mockRejectedValue(error);
      vi.mocked(formatError).mockReturnValue("Formatted: Test error");
      const options: ImportOptions = { targets: ["claudecode"] };

      await expect(importCommand(options)).rejects.toThrow("Process exit");

      expect(formatError).toHaveBeenCalledWith(error);
      expect(logger.error).toHaveBeenCalledWith("❌ Formatted: Test error");
    });
  });
});

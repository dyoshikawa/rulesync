import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { gitignore } from "../../core/gitignore.js";
import { logger } from "../../utils/logger.js";
import { gitignoreCommand } from "./gitignore.js";

// Mock dependencies
vi.mock("../../core/gitignore.js");
vi.mock("../../utils/logger.js");

describe("gitignoreCommand", () => {
  beforeEach(() => {
    // Setup logger mocks
    vi.mocked(logger.success).mockImplementation(() => {});

    // Setup default mock for gitignore
    vi.mocked(gitignore).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("calling core gitignore function", () => {
    it("should call gitignore from core", async () => {
      await gitignoreCommand();

      expect(gitignore).toHaveBeenCalled();
    });
  });

  describe("success handling", () => {
    it("should log success message after gitignore completes", async () => {
      await gitignoreCommand();

      expect(logger.success).toHaveBeenCalledWith("Updated .gitignore with rulesync entries");
    });
  });

  describe("error handling", () => {
    it("should propagate errors from gitignore function", async () => {
      vi.mocked(gitignore).mockRejectedValue(new Error("Permission denied"));

      await expect(gitignoreCommand()).rejects.toThrow("Permission denied");

      expect(logger.success).not.toHaveBeenCalled();
    });

    it("should propagate file read errors", async () => {
      vi.mocked(gitignore).mockRejectedValue(new Error("Read error"));

      await expect(gitignoreCommand()).rejects.toThrow("Read error");
    });

    it("should propagate file write errors", async () => {
      vi.mocked(gitignore).mockRejectedValue(new Error("Write error"));

      await expect(gitignoreCommand()).rejects.toThrow("Write error");
    });
  });
});

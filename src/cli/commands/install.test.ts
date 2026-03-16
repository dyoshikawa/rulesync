import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigResolver } from "../../config/config-resolver.js";
import type { SourceEntry } from "../../config/config.js";
import { Config } from "../../config/config.js";
import { resolveAndFetchSources } from "../../lib/sources.js";
import { Logger } from "../../utils/logger.js";
import { installCommand } from "./install.js";

// Mock dependencies
vi.mock("../../config/config-resolver.js");
vi.mock("../../lib/sources.js");

function createMockConfig(sources: SourceEntry[]): Config {
  return {
    getSources: () => sources,
  } as unknown as Config;
}

describe("installCommand", () => {
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      configure: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      jsonMode: false,
      captureData: vi.fn(),
    } as unknown as Logger;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("successful install", () => {
    it("should install skills and log success", async () => {
      const sources: SourceEntry[] = [{ source: "owner/repo" }];
      vi.mocked(ConfigResolver.resolve).mockResolvedValue(createMockConfig(sources));
      vi.mocked(resolveAndFetchSources).mockResolvedValue({
        fetchedSkillCount: 3,
        sourcesProcessed: 1,
      });

      await installCommand(mockLogger, {});

      expect(resolveAndFetchSources).toHaveBeenCalledWith({
        sources,
        baseDir: process.cwd(),
        options: {
          updateSources: undefined,
          frozen: undefined,
          token: undefined,
        },
      });
      expect(mockLogger.success).toHaveBeenCalledWith("Installed 3 skill(s) from 1 source(s).");
    });

    it("should report all up to date when no skills fetched", async () => {
      const sources: SourceEntry[] = [{ source: "owner/repo" }];
      vi.mocked(ConfigResolver.resolve).mockResolvedValue(createMockConfig(sources));
      vi.mocked(resolveAndFetchSources).mockResolvedValue({
        fetchedSkillCount: 0,
        sourcesProcessed: 1,
      });

      await installCommand(mockLogger, {});

      expect(mockLogger.success).toHaveBeenCalledWith(
        "All skills up to date (1 source(s) checked).",
      );
    });

    it("should warn and return early when no sources defined", async () => {
      vi.mocked(ConfigResolver.resolve).mockResolvedValue(createMockConfig([]));

      await installCommand(mockLogger, {});

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "No sources defined in configuration. Nothing to install.",
      );
      expect(resolveAndFetchSources).not.toHaveBeenCalled();
    });
  });

  describe("option forwarding", () => {
    it("should pass --update option", async () => {
      const sources: SourceEntry[] = [{ source: "owner/repo" }];
      vi.mocked(ConfigResolver.resolve).mockResolvedValue(createMockConfig(sources));
      vi.mocked(resolveAndFetchSources).mockResolvedValue({
        fetchedSkillCount: 0,
        sourcesProcessed: 1,
      });

      await installCommand(mockLogger, { update: true });

      expect(resolveAndFetchSources).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({ updateSources: true }),
        }),
      );
    });

    it("should pass --frozen option", async () => {
      const sources: SourceEntry[] = [{ source: "owner/repo" }];
      vi.mocked(ConfigResolver.resolve).mockResolvedValue(createMockConfig(sources));
      vi.mocked(resolveAndFetchSources).mockResolvedValue({
        fetchedSkillCount: 0,
        sourcesProcessed: 1,
      });

      await installCommand(mockLogger, { frozen: true });

      expect(resolveAndFetchSources).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({ frozen: true }),
        }),
      );
    });

    it("should pass --token option", async () => {
      const sources: SourceEntry[] = [{ source: "owner/repo" }];
      vi.mocked(ConfigResolver.resolve).mockResolvedValue(createMockConfig(sources));
      vi.mocked(resolveAndFetchSources).mockResolvedValue({
        fetchedSkillCount: 0,
        sourcesProcessed: 1,
      });

      await installCommand(mockLogger, { token: "my-token" });

      expect(resolveAndFetchSources).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({ token: "my-token" }),
        }),
      );
    });
  });

  describe("error handling", () => {
    it("should propagate errors from resolveAndFetchSources", async () => {
      const sources: SourceEntry[] = [{ source: "owner/repo" }];
      vi.mocked(ConfigResolver.resolve).mockResolvedValue(createMockConfig(sources));
      vi.mocked(resolveAndFetchSources).mockRejectedValue(
        new Error("Frozen install failed: lockfile is missing entries"),
      );

      await expect(installCommand(mockLogger, { frozen: true })).rejects.toThrow(
        "Frozen install failed: lockfile is missing entries",
      );
    });

    it("should propagate generic errors", async () => {
      const sources: SourceEntry[] = [{ source: "owner/repo" }];
      vi.mocked(ConfigResolver.resolve).mockResolvedValue(createMockConfig(sources));
      vi.mocked(resolveAndFetchSources).mockRejectedValue(new Error("Network error"));

      await expect(installCommand(mockLogger, {})).rejects.toThrow("Network error");
    });
  });

  describe("logger configuration", () => {
    it("should configure logger with verbose mode", async () => {
      vi.mocked(ConfigResolver.resolve).mockResolvedValue(createMockConfig([]));

      await installCommand(mockLogger, { verbose: true });

      expect(mockLogger.configure).toHaveBeenCalledWith({
        verbose: true,
        silent: false,
      });
    });

    it("should configure logger with silent mode", async () => {
      vi.mocked(ConfigResolver.resolve).mockResolvedValue(createMockConfig([]));

      await installCommand(mockLogger, { silent: true });

      expect(mockLogger.configure).toHaveBeenCalledWith({
        verbose: false,
        silent: true,
      });
    });
  });
});

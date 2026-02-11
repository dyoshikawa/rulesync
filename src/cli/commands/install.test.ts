import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SourceEntry } from "../../config/config.js";

import { ConfigResolver } from "../../config/config-resolver.js";
import { Config } from "../../config/config.js";
import { resolveAndFetchSources } from "../../lib/sources.js";
import { logger } from "../../utils/logger.js";
import { installCommand } from "./install.js";

// Mock dependencies
vi.mock("../../config/config-resolver.js");
vi.mock("../../lib/sources.js");
vi.mock("../../utils/logger.js");

function createMockConfig(sources: SourceEntry[]): Config {
  return {
    getSources: () => sources,
  } as unknown as Config;
}

describe("installCommand", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockExit = vi.spyOn(process, "exit").mockImplementation(function () {
      throw new Error("Process exit");
    } as never);

    vi.mocked(logger.configure).mockImplementation(() => {});
    vi.mocked(logger.info).mockImplementation(() => {});
    vi.mocked(logger.success).mockImplementation(() => {});
    vi.mocked(logger.warn).mockImplementation(() => {});
    vi.mocked(logger.error).mockImplementation(() => {});
    vi.mocked(logger.debug).mockImplementation(() => {});
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

      await installCommand({});

      expect(resolveAndFetchSources).toHaveBeenCalledWith({
        sources,
        baseDir: process.cwd(),
        options: {
          updateSources: undefined,
          frozen: undefined,
          token: undefined,
        },
      });
      expect(logger.success).toHaveBeenCalledWith("Installed 3 skill(s) from 1 source(s).");
    });

    it("should report all up to date when no skills fetched", async () => {
      const sources: SourceEntry[] = [{ source: "owner/repo" }];
      vi.mocked(ConfigResolver.resolve).mockResolvedValue(createMockConfig(sources));
      vi.mocked(resolveAndFetchSources).mockResolvedValue({
        fetchedSkillCount: 0,
        sourcesProcessed: 1,
      });

      await installCommand({});

      expect(logger.success).toHaveBeenCalledWith("All skills up to date (1 source(s) checked).");
    });

    it("should warn and return early when no sources defined", async () => {
      vi.mocked(ConfigResolver.resolve).mockResolvedValue(createMockConfig([]));

      await installCommand({});

      expect(logger.warn).toHaveBeenCalledWith(
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

      await installCommand({ update: true });

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

      await installCommand({ frozen: true });

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

      await installCommand({ token: "my-token" });

      expect(resolveAndFetchSources).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({ token: "my-token" }),
        }),
      );
    });
  });

  describe("error handling", () => {
    it("should handle errors from resolveAndFetchSources", async () => {
      const sources: SourceEntry[] = [{ source: "owner/repo" }];
      vi.mocked(ConfigResolver.resolve).mockResolvedValue(createMockConfig(sources));
      vi.mocked(resolveAndFetchSources).mockRejectedValue(
        new Error("Frozen install failed: lockfile is missing entries"),
      );

      await expect(installCommand({ frozen: true })).rejects.toThrow("Process exit");

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Frozen install failed"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should handle generic errors", async () => {
      const sources: SourceEntry[] = [{ source: "owner/repo" }];
      vi.mocked(ConfigResolver.resolve).mockResolvedValue(createMockConfig(sources));
      vi.mocked(resolveAndFetchSources).mockRejectedValue(new Error("Network error"));

      await expect(installCommand({})).rejects.toThrow("Process exit");

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Network error"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("logger configuration", () => {
    it("should configure logger with verbose mode", async () => {
      vi.mocked(ConfigResolver.resolve).mockResolvedValue(createMockConfig([]));

      await installCommand({ verbose: true });

      expect(logger.configure).toHaveBeenCalledWith({
        verbose: true,
        silent: false,
      });
    });

    it("should configure logger with silent mode", async () => {
      vi.mocked(ConfigResolver.resolve).mockResolvedValue(createMockConfig([]));

      await installCommand({ silent: true });

      expect(logger.configure).toHaveBeenCalledWith({
        verbose: false,
        silent: true,
      });
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigResolver } from "../../config/config-resolver.js";
import type { SourceEntry } from "../../config/config.js";
import { Config } from "../../config/config.js";
import { installApm } from "../../lib/apm/apm-install.js";
import { apmManifestExists } from "../../lib/apm/apm-manifest.js";
import { resolveAndFetchSources } from "../../lib/sources.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { installCommand } from "./install.js";

// Mock dependencies
vi.mock("../../config/config-resolver.js");
vi.mock("../../lib/sources.js");
vi.mock("../../lib/apm/apm-install.js");
vi.mock("../../lib/apm/apm-manifest.js");

function createMockConfig(sources: SourceEntry[]): Config {
  return {
    getSources: () => sources,
  } as unknown as Config;
}

describe("installCommand", () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    vi.mocked(apmManifestExists).mockResolvedValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("rulesync mode (default)", () => {
    it("should install skills and log success", async () => {
      const sources: SourceEntry[] = [{ source: "owner/repo" }];
      vi.mocked(ConfigResolver.resolve).mockResolvedValue(createMockConfig(sources));
      vi.mocked(resolveAndFetchSources).mockResolvedValue({
        fetchedSkillCount: 3,
        sourcesProcessed: 1,
      });

      await installCommand(mockLogger, {});

      expect(resolveAndFetchSources).toHaveBeenCalledWith(
        expect.objectContaining({
          sources,
          baseDir: process.cwd(),
          options: {
            updateSources: undefined,
            frozen: undefined,
            token: undefined,
          },
        }),
      );
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

    it("should warn and suggest --mode apm when apm.yml is present but no sources", async () => {
      vi.mocked(apmManifestExists).mockResolvedValue(true);
      vi.mocked(ConfigResolver.resolve).mockResolvedValue(createMockConfig([]));

      await installCommand(mockLogger, {});

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("apm.yml is present"));
      expect(resolveAndFetchSources).not.toHaveBeenCalled();
    });

    it("should error when both apm.yml and sources are defined", async () => {
      vi.mocked(apmManifestExists).mockResolvedValue(true);
      vi.mocked(ConfigResolver.resolve).mockResolvedValue(
        createMockConfig([{ source: "owner/repo" }]),
      );

      await expect(installCommand(mockLogger, {})).rejects.toThrow(
        /Both apm.yml and rulesync.jsonc/,
      );
    });
  });

  describe("option forwarding (rulesync mode)", () => {
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

  describe("apm mode", () => {
    it("errors when apm.yml is missing", async () => {
      vi.mocked(apmManifestExists).mockResolvedValue(false);

      await expect(installCommand(mockLogger, { mode: "apm" })).rejects.toThrow(
        /requires an apm.yml/,
      );
    });

    it("routes to installApm and reports success when files are deployed", async () => {
      vi.mocked(apmManifestExists).mockResolvedValue(true);
      vi.mocked(installApm).mockResolvedValue({
        dependenciesProcessed: 2,
        deployedFileCount: 5,
        failedDependencyCount: 0,
      });

      await installCommand(mockLogger, { mode: "apm", update: true, token: "tok" });

      expect(installApm).toHaveBeenCalledWith(
        expect.objectContaining({
          baseDir: process.cwd(),
          options: expect.objectContaining({ update: true, token: "tok" }),
        }),
      );
      expect(mockLogger.success).toHaveBeenCalledWith(
        "Installed 5 file(s) from 2 apm dependency(ies).",
      );
    });

    it("reports up-to-date when no files are deployed", async () => {
      vi.mocked(apmManifestExists).mockResolvedValue(true);
      vi.mocked(installApm).mockResolvedValue({
        dependenciesProcessed: 2,
        deployedFileCount: 0,
        failedDependencyCount: 0,
      });

      await installCommand(mockLogger, { mode: "apm" });

      expect(mockLogger.success).toHaveBeenCalledWith(
        "All apm dependencies up to date (2 checked).",
      );
    });

    it("throws when installApm reports failed dependencies", async () => {
      vi.mocked(apmManifestExists).mockResolvedValue(true);
      vi.mocked(installApm).mockResolvedValue({
        dependenciesProcessed: 2,
        deployedFileCount: 1,
        failedDependencyCount: 1,
      });

      await expect(installCommand(mockLogger, { mode: "apm" })).rejects.toThrow(
        /Failed to install 1 of 2 apm dependency/,
      );
    });
  });

  describe("gh mode", () => {
    it("errors with a not-yet-implemented message", async () => {
      await expect(installCommand(mockLogger, { mode: "gh" })).rejects.toThrow(
        /not yet implemented/,
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
});

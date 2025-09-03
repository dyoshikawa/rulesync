import * as c12 from "c12";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import * as fileUtils from "../utils/file.js";
import { Config } from "./config.js";
import { ConfigResolver } from "./config-resolver.js";

// Only mock specific functions, not the entire module to avoid conflicts with setupTestDirectory
vi.mock("../utils/file.js", async () => {
  const actual = await vi.importActual("../utils/file.js");
  return {
    ...actual,
    fileExists: vi.fn(),
  };
});
vi.mock("c12");

describe("ConfigResolver", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    process.chdir(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  describe("resolve", () => {
    it("should return default config when no config file exists", async () => {
      vi.mocked(fileUtils.fileExists).mockResolvedValue(false);

      const config = await ConfigResolver.resolve({});

      expect(config).toBeInstanceOf(Config);
      expect(config.getTargets()).toEqual(["agentsmd"]);
      expect(config.getFeatures()).toContain("rules");
      expect(config.getFeatures()).toContain("ignore");
      expect(config.getVerbose()).toBe(false);
      expect(config.getDelete()).toBe(false);
      expect(config.getBaseDirs()).toEqual(["."]);
    });

    it("should use provided parameters when no config file", async () => {
      vi.mocked(fileUtils.fileExists).mockResolvedValue(false);

      const config = await ConfigResolver.resolve({
        targets: ["cursor", "copilot"],
        features: ["rules", "ignore"],
        verbose: true,
        delete: true,
        baseDirs: ["/custom/dir"],
      });

      expect(config.getTargets()).toEqual(["cursor", "copilot"]);
      expect(config.getFeatures()).toEqual(["rules", "ignore"]);
      expect(config.getVerbose()).toBe(true);
      expect(config.getDelete()).toBe(true);
      expect(config.getBaseDirs()).toEqual(["/custom/dir"]);
    });

    it("should load config from file when it exists", async () => {
      vi.mocked(fileUtils.fileExists).mockResolvedValue(true);
      vi.mocked(c12.loadConfig).mockResolvedValue({
        config: {
          targets: ["claudecode", "cursor"],
          features: ["rules", "mcp"],
          verbose: true,
          delete: false,
          baseDirs: ["src", "tests"],
        },
        configFile: "rulesync.jsonc",
      } as any);

      const config = await ConfigResolver.resolve({});

      expect(c12.loadConfig).toHaveBeenCalledWith({
        name: "rulesync",
        cwd: process.cwd(),
        rcFile: false,
        configFile: "rulesync.jsonc",
      });

      expect(config.getTargets()).toEqual(["claudecode", "cursor"]);
      expect(config.getFeatures()).toEqual(["rules", "mcp"]);
      expect(config.getVerbose()).toBe(true);
      expect(config.getDelete()).toBe(false);
      expect(config.getBaseDirs()).toEqual(["src", "tests"]);
    });

    it("should override config file with provided parameters", async () => {
      vi.mocked(fileUtils.fileExists).mockResolvedValue(true);
      vi.mocked(c12.loadConfig).mockResolvedValue({
        config: {
          targets: ["claudecode"],
          features: ["rules"],
          verbose: false,
          delete: false,
          baseDirs: ["src"],
        },
        configFile: "rulesync.jsonc",
      } as any);

      const config = await ConfigResolver.resolve({
        targets: ["cursor", "copilot"],
        verbose: true,
      });

      // Provided params should override config file
      expect(config.getTargets()).toEqual(["cursor", "copilot"]);
      expect(config.getVerbose()).toBe(true);
      // Non-provided params should come from config file
      expect(config.getFeatures()).toEqual(["rules"]);
      expect(config.getDelete()).toBe(false);
      expect(config.getBaseDirs()).toEqual(["src"]);
    });

    it("should use custom config path", async () => {
      vi.mocked(fileUtils.fileExists).mockResolvedValue(true);
      vi.mocked(c12.loadConfig).mockResolvedValue({
        config: {
          targets: ["cursor"],
          features: ["rules"],
        },
        configFile: "custom-config.json",
      } as any);

      await ConfigResolver.resolve({
        configPath: "custom-config.json",
      });

      expect(c12.loadConfig).toHaveBeenCalledWith({
        name: "rulesync",
        cwd: process.cwd(),
        rcFile: false,
        configFile: "custom-config.json",
      });
    });

    it("should handle partial config file", async () => {
      vi.mocked(fileUtils.fileExists).mockResolvedValue(true);
      vi.mocked(c12.loadConfig).mockResolvedValue({
        config: {
          targets: ["cursor"],
          // Missing other properties
        },
        configFile: "rulesync.jsonc",
      } as any);

      const config = await ConfigResolver.resolve({});

      expect(config.getTargets()).toEqual(["cursor"]);
      // Should use defaults for missing properties
      expect(config.getFeatures()).toEqual(["rules", "ignore", "mcp", "subagents", "commands"]); // Expanded default features
      expect(config.getVerbose()).toBe(false);
      expect(config.getDelete()).toBe(false);
      expect(config.getBaseDirs()).toEqual(["."]);
    });

    it("should handle empty config file", async () => {
      vi.mocked(fileUtils.fileExists).mockResolvedValue(true);
      vi.mocked(c12.loadConfig).mockResolvedValue({
        config: {},
        configFile: "rulesync.jsonc",
      } as any);

      const config = await ConfigResolver.resolve({});

      // Should use all defaults
      expect(config.getTargets()).toEqual(["agentsmd"]);
      expect(config.getFeatures()).toEqual(["rules", "ignore", "mcp", "subagents", "commands"]); // Expanded features
      expect(config.getVerbose()).toBe(false);
      expect(config.getDelete()).toBe(false);
      expect(config.getBaseDirs()).toEqual(["."]);
    });

    it("should handle c12 loadConfig errors gracefully", async () => {
      vi.mocked(fileUtils.fileExists).mockResolvedValue(true);
      vi.mocked(c12.loadConfig).mockRejectedValue(new Error("Config load failed"));

      // Should not throw but fall back to defaults
      await expect(ConfigResolver.resolve({})).rejects.toThrow("Config load failed");
    });

    it("should handle missing configPath parameter", async () => {
      vi.mocked(fileUtils.fileExists).mockResolvedValue(true);
      vi.mocked(c12.loadConfig).mockResolvedValue({
        config: { targets: ["cursor"] },
        configFile: "rulesync.jsonc",
      } as any);

      const _config = await ConfigResolver.resolve({
        // No configPath provided - should use default
      });

      expect(c12.loadConfig).toHaveBeenCalledWith({
        name: "rulesync",
        cwd: process.cwd(),
        rcFile: false,
        configFile: "rulesync.jsonc",
      });
    });

    it("should prioritize parameters over file config over defaults", async () => {
      vi.mocked(fileUtils.fileExists).mockResolvedValue(true);
      vi.mocked(c12.loadConfig).mockResolvedValue({
        config: {
          targets: ["from-file"],
          features: ["from-file-feature"],
          verbose: false,
          delete: false,
          baseDirs: ["from-file-dir"],
        },
        configFile: "rulesync.jsonc",
      } as any);

      const config = await ConfigResolver.resolve({
        targets: ["cursor"],
        verbose: true,
        // features, delete, baseDirs not provided - should use file config
      });

      expect(config.getTargets()).toEqual(["cursor"]); // From parameter
      expect(config.getFeatures()).toEqual(["from-file-feature"]); // From file
      expect(config.getVerbose()).toBe(true); // From parameter
      expect(config.getDelete()).toBe(false); // From file
      expect(config.getBaseDirs()).toEqual(["from-file-dir"]); // From file
    });
  });

  describe("edge cases", () => {
    it("should handle null/undefined config values", async () => {
      vi.mocked(fileUtils.fileExists).mockResolvedValue(true);
      vi.mocked(c12.loadConfig).mockResolvedValue({
        config: {
          targets: null,
          features: undefined,
        },
        configFile: "rulesync.jsonc",
      } as any);

      const config = await ConfigResolver.resolve({});

      // Should fallback to defaults for null/undefined values
      expect(config.getTargets()).toEqual(["agentsmd"]);
      expect(config.getFeatures()).toEqual(["rules", "ignore", "mcp", "subagents", "commands"]); // Expanded features
    });
  });
});

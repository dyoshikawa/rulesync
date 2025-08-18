import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MergedConfig, ToolTarget } from "../types/index.js";
import { generateSampleConfig, loadConfig, mergeWithCliOptions } from "./config-loader.js";

// Mock c12 to control what config files it "finds"
vi.mock("c12", () => ({
  loadConfig: vi.fn(),
}));

const FIXTURES = {
  valid: {
    verbose: true,
    delete: false,
    targets: ["copilot", "cursor"],
    outputPaths: {
      copilot: ".github/custom-copilot.md",
    },
  },
  full: {
    targets: ["copilot", "cursor", "claudecode"],
    baseDir: ["./packages"],
    watch: {
      enabled: true,
      interval: 2000,
      ignore: ["node_modules/**", "dist/**"],
    },
  },
  minimal: {
    targets: ["copilot"],
  },
  invalid: {
    targets: ["invalid-tool"],
  },
} as const;

describe("config-loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loadConfig", () => {
    it("should return default config when no config file is found", async () => {
      const { loadConfig: loadC12Config } = await import("c12");
      (loadC12Config as any).mockResolvedValue({
        config: {},
        configFile: undefined,
      });

      const result = await loadConfig();

      expect(result.isEmpty).toBe(true);
      expect(result.filepath).toBeUndefined();
      expect(result.config).toMatchObject({
        aiRulesDir: ".rulesync",
        watchEnabled: false,
        defaultTargets: expect.arrayContaining(["copilot", "cursor", "claudecode"]),
      });
    });

    it("should return default config when --no-config flag is set", async () => {
      const result = await loadConfig({ noConfig: true });

      expect(result.isEmpty).toBe(true);
      expect(result.config).toMatchObject({
        aiRulesDir: ".rulesync",
      });
    });

    it("should load and validate valid configuration from file", async () => {
      const { loadConfig: loadC12Config } = await import("c12");
      (loadC12Config as any).mockResolvedValue({
        config: FIXTURES.valid,
        configFile: "/path/to/rulesync.jsonc",
      });

      const result = await loadConfig();

      expect(result.isEmpty).toBe(false);
      expect(result.filepath).toBe("/path/to/rulesync.jsonc");
      expect(result.config.verbose).toBe(true);
      expect(result.config.delete).toBe(false);
      expect(result.config.defaultTargets).toEqual(["copilot", "cursor"]);
      expect(result.config.outputPaths.copilot).toBe(".github/custom-copilot.md");
    });

    it("should load and process full configuration", async () => {
      const { loadConfig: loadC12Config } = await import("c12");
      (loadC12Config as any).mockResolvedValue({
        config: FIXTURES.full,
        configFile: "/path/to/rulesync.jsonc",
      });

      const result = await loadConfig();

      expect(result.isEmpty).toBe(false);
      // Check that targets are set correctly (targets field overrides defaults)
      expect(result.config.defaultTargets).toEqual(["copilot", "cursor", "claudecode"]);
      expect(result.config.baseDir).toEqual(["./packages"]);
      expect(result.config.watch).toEqual({
        enabled: true,
        interval: 2000,
        ignore: ["node_modules/**", "dist/**"],
      });
    });

    it("should throw error for invalid configuration", async () => {
      const { loadConfig: loadC12Config } = await import("c12");
      (loadC12Config as any).mockResolvedValue({
        config: FIXTURES.invalid,
        configFile: "/path/to/rulesync.jsonc",
      });

      await expect(loadConfig()).rejects.toThrow(/Invalid configuration in/);
    });

    it("should load from specific config path when provided", async () => {
      const { loadConfig: loadC12Config } = await import("c12");
      (loadC12Config as any).mockResolvedValue({
        config: FIXTURES.minimal,
        configFile: "/custom/config.json",
      });

      const result = await loadConfig({ configPath: "/custom/config.json" });

      expect(loadC12Config).toHaveBeenCalledWith({
        name: "rulesync",
        cwd: process.cwd(),
        rcFile: false,
        configFile: "/custom/config.json",
        defaults: expect.any(Object),
      });
      expect(result.filepath).toBe("/custom/config.json");
      expect(result.config.defaultTargets).toEqual(["copilot"]);
    });
  });

  describe("mergeWithCliOptions", () => {
    const baseConfig: MergedConfig = {
      aiRulesDir: ".rulesync",
      outputPaths: {
        copilot: ".github/instructions",
        cursor: ".cursor/rules",
        cline: ".clinerules",
        claudecode: ".",
        codexcli: ".",
        roo: ".roo/rules",
        geminicli: ".gemini/memories",
        kiro: ".kiro/steering",
        augmentcode: ".",
        "augmentcode-legacy": ".",
        opencode: ".",
        junie: ".",
        windsurf: ".",
      },
      watchEnabled: false,
      defaultTargets: ["copilot", "cursor"],
      verbose: false,
      delete: false,
    };

    it("should override config with CLI options", () => {
      const cliOptions = {
        verbose: true,
        delete: true,
        baseDirs: ["./packages"],
      };

      const merged = mergeWithCliOptions(baseConfig, cliOptions);

      expect(merged.verbose).toBe(true);
      expect(merged.delete).toBe(true);
      expect(merged.baseDir).toEqual(["./packages"]);
    });

    it("should use CLI tools when specified", () => {
      const cliOptions = {
        tools: ["claudecode", "roo"] as ToolTarget[],
      };

      const merged = mergeWithCliOptions(baseConfig, cliOptions);

      expect(merged.defaultTargets).toEqual(["claudecode", "roo"]);
      expect(merged.exclude).toBeUndefined();
    });

    it("should preserve config values when CLI options are not provided", () => {
      const merged = mergeWithCliOptions(baseConfig, {});

      expect(merged).toEqual(baseConfig);
    });

    it("should handle empty CLI options object", () => {
      const merged = mergeWithCliOptions(baseConfig, {});

      expect(merged).toEqual(baseConfig);
    });
  });

  describe("generateSampleConfig", () => {
    it("should generate valid JSON config", () => {
      const config = generateSampleConfig();

      // Should be valid JSON (with comments stripped)
      const jsonWithoutComments = config.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(() => JSON.parse(jsonWithoutComments)).not.toThrow();

      // Should contain expected fields
      expect(config).toContain("targets");
      expect(config).toContain("exclude");
      expect(config).toContain("outputPaths");
      expect(config).toContain("baseDir");
      expect(config).toContain("verbose");
      expect(config).toContain("watch");
    });

    it("should generate config with proper structure", () => {
      const config = generateSampleConfig();
      const jsonWithoutComments = config.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      const parsed = JSON.parse(jsonWithoutComments);

      expect(parsed).toHaveProperty("targets");
      expect(parsed).toHaveProperty("outputPaths");
      expect(parsed).toHaveProperty("delete");
      expect(parsed).toHaveProperty("verbose");
      expect(parsed).toHaveProperty("watch");
    });
  });
});

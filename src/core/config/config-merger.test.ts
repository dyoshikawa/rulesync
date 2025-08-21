import { describe, expect, it } from "vitest";
import type { MergedConfig, ToolTarget } from "../../types/index.js";
import { ALL_TOOL_TARGETS } from "../../types/tool-targets.js";
import { ConfigMerger } from "./config-merger.js";
import { type CliOptions, ConfigSource } from "./types.js";

describe("ConfigMerger", () => {
  const merger = new ConfigMerger();

  const createCompleteOutputPaths = (): Record<ToolTarget, string> => {
    const paths: Record<ToolTarget, string> = {} as Record<ToolTarget, string>;
    for (const tool of ALL_TOOL_TARGETS) {
      paths[tool] = `.${tool}/rules/`;
    }
    return paths;
  };

  const createBaseMergedConfig = (): MergedConfig => ({
    aiRulesDir: ".rulesync",
    outputPaths: createCompleteOutputPaths(),
    watchEnabled: false,
    defaultTargets: ["copilot", "cursor"],
  });

  describe("merge", () => {
    it("should merge CLI options over config file", () => {
      const fileConfig = createBaseMergedConfig();
      const cliOptions: CliOptions = {
        tools: ["augmentcode"],
        verbose: true,
        delete: true,
        baseDirs: ["./src"],
      };

      const result = merger.merge(fileConfig, cliOptions);

      expect(result.defaultTargets).toEqual(["augmentcode"]);
      expect(result.verbose).toBe(true);
      expect(result.delete).toBe(true);
      expect(result.baseDir).toEqual(["./src"]);
      expect(result.exclude).toBeUndefined(); // Should be cleared when tools are specified
    });

    it("should preserve config file values when CLI options are not provided", () => {
      const fileConfig: MergedConfig = {
        ...createBaseMergedConfig(),
        verbose: false,
        delete: false,
        baseDir: ["./config-dir"],
      };
      const cliOptions: CliOptions = {};

      const result = merger.merge(fileConfig, cliOptions);

      expect(result.defaultTargets).toEqual(["copilot", "cursor"]);
      expect(result.verbose).toBe(false);
      expect(result.delete).toBe(false);
      expect(result.baseDir).toEqual(["./config-dir"]);
    });

    it("should handle undefined CLI values correctly", () => {
      const fileConfig = createBaseMergedConfig();
      const cliOptions: CliOptions = {};

      const result = merger.merge(fileConfig, cliOptions);

      expect(result.defaultTargets).toEqual(["copilot", "cursor"]);
      expect(result.verbose).toBeUndefined();
      expect(result.delete).toBeUndefined();
      expect(result.baseDir).toBeUndefined();
    });

    it("should clear exclude when tools are specified in CLI", () => {
      const fileConfig: MergedConfig = {
        ...createBaseMergedConfig(),
        exclude: ["roo"],
      };
      const cliOptions: CliOptions = {
        tools: ["copilot"],
      };

      const result = merger.merge(fileConfig, cliOptions);

      expect(result.defaultTargets).toEqual(["copilot"]);
      expect(result.exclude).toBeUndefined();
    });

    it("should preserve exclude when tools are not specified in CLI", () => {
      const fileConfig: MergedConfig = {
        ...createBaseMergedConfig(),
        exclude: ["roo"],
      };
      const cliOptions: CliOptions = {
        verbose: true,
      };

      const result = merger.merge(fileConfig, cliOptions);

      expect(result.defaultTargets).toEqual(["copilot", "cursor"]);
      expect(result.exclude).toEqual(["roo"]);
    });
  });

  describe("generateMetadata", () => {
    it("should generate correct metadata for CLI overrides", () => {
      const fileConfig = createBaseMergedConfig();
      const cliOptions: CliOptions = {
        tools: ["augmentcode"],
        verbose: true,
      };
      const merged = merger.merge(fileConfig, cliOptions);

      const metadata = merger.generateMetadata(fileConfig, cliOptions, merged);

      expect(metadata.verbose?.source).toBe(ConfigSource.CLI_ARGS);
      expect(metadata.verbose?.value).toBe(true);
      expect(metadata.defaultTargets?.source).toBe(ConfigSource.CLI_ARGS);
      expect(metadata.defaultTargets?.value).toEqual(["augmentcode"]);
    });

    it("should generate correct metadata for config file values", () => {
      const fileConfig: MergedConfig = {
        ...createBaseMergedConfig(),
        verbose: false,
        baseDir: ["./config-dir"],
      };
      const cliOptions: CliOptions = {};
      const merged = merger.merge(fileConfig, cliOptions);

      const metadata = merger.generateMetadata(fileConfig, cliOptions, merged);

      expect(metadata.verbose?.source).toBe(ConfigSource.CONFIG_FILE);
      expect(metadata.verbose?.value).toBe(false);
      expect(metadata.baseDir?.source).toBe(ConfigSource.CONFIG_FILE);
      expect(metadata.baseDir?.value).toEqual(["./config-dir"]);
      expect(metadata.defaultTargets?.source).toBe(ConfigSource.CONFIG_FILE);
    });

    it("should not include metadata for undefined values", () => {
      const fileConfig = createBaseMergedConfig();
      const cliOptions = {};
      const merged = merger.merge(fileConfig, cliOptions);

      const metadata = merger.generateMetadata(fileConfig, cliOptions, merged);

      expect(metadata.verbose).toBeUndefined();
      expect(metadata.delete).toBeUndefined();
      expect(metadata.baseDir).toBeUndefined();
    });
  });

  describe("validate", () => {
    it("should validate successful for valid config", () => {
      const config = createBaseMergedConfig();

      const result = merger.validate(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should detect missing required fields", () => {
      const config = {
        aiRulesDir: "",
        outputPaths: undefined,
        watchEnabled: false,
        defaultTargets: [],
      } as any;

      const result = merger.validate(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("aiRulesDir must be specified");
      expect(result.errors).toContain("outputPaths must be specified");
      expect(result.errors).toContain(
        "At least one tool must be specified in targets or CLI arguments",
      );
    });

    it("should validate partial config correctly", () => {
      const config: MergedConfig = {
        ...createBaseMergedConfig(),
        aiRulesDir: "valid-dir",
        defaultTargets: ["copilot"],
      };

      const result = merger.validate(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { CliParser } from "./cli-parser.js";
import { ConfigFileLoader } from "./config-file-loader.js";
import { ConfigMerger } from "./config-merger.js";
import { ConfigResolver } from "./config-resolver.js";
import { ConfigSource } from "./types.js";
import { ConfigValidationError, ConfigValidator } from "./validators.js";

describe("ConfigResolver", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("resolve", () => {
    it("should resolve configuration with CLI options taking precedence", async () => {
      const resolver = new ConfigResolver();

      const result = await resolver.resolve({
        cliOptions: {
          tools: ["copilot", "cursor"],
          verbose: true,
        },
        workingDirectory: testDir,
      });

      expect(result.value.defaultTargets).toEqual(["copilot", "cursor"]);
      expect(result.value.verbose).toBe(true);
      expect(result.source).toBe(ConfigSource.CLI_ARGS);
    });

    it("should handle config file not found gracefully", async () => {
      const resolver = new ConfigResolver();

      const result = await resolver.resolve({
        cliOptions: {
          tools: ["copilot"],
          config: "non-existent.json",
        },
        workingDirectory: testDir,
      });

      expect(result.value.defaultTargets).toEqual(["copilot"]);
      expect(result.source).toBe(ConfigSource.CLI_ARGS);
    });

    it("should validate CLI options and throw on invalid input", async () => {
      const resolver = new ConfigResolver();

      await expect(
        resolver.resolve({
          cliOptions: {
            config: "some-config.json",
            noConfig: true, // Conflicting options
          },
          workingDirectory: testDir,
        }),
      ).rejects.toThrow(ConfigValidationError);
    });

    it("should resolve with no config when noConfig is true", async () => {
      const resolver = new ConfigResolver();

      const result = await resolver.resolve({
        cliOptions: {
          noConfig: true,
          tools: ["copilot"],
        },
        workingDirectory: testDir,
      });

      expect(result.value.defaultTargets).toEqual(["copilot"]);
      expect(result.source).toBe(ConfigSource.CLI_ARGS);
    });

    it("should merge baseDirs from CLI options", async () => {
      const resolver = new ConfigResolver();

      const result = await resolver.resolve({
        cliOptions: {
          tools: ["copilot"],
          baseDirs: ["./src", "./tests"],
        },
        workingDirectory: testDir,
      });

      expect(result.value.baseDir).toEqual(["./src", "./tests"]);
      expect(result.source).toBe(ConfigSource.CLI_ARGS);
    });
  });

  describe("resolveWithDetails", () => {
    it("should provide detailed resolution information", async () => {
      const resolver = new ConfigResolver();

      const result = await resolver.resolveWithDetails({
        cliOptions: {
          tools: ["copilot"],
          verbose: true,
        },
        workingDirectory: testDir,
      });

      expect(result.result.value.defaultTargets).toEqual(["copilot"]);
      expect(result.details.parsedCliOptions).toEqual({
        tools: ["copilot"],
        verbose: true,
      });
      expect(result.details.configFileResult).toBeDefined();
    });

    it("should provide details even when validation fails", async () => {
      const resolver = new ConfigResolver();

      const result = await resolver.resolveWithDetails({
        cliOptions: {
          config: "some-config.json",
          noConfig: true, // Invalid combination
        },
        workingDirectory: testDir,
      });

      expect(result.details.validationErrors).toBeDefined();
      expect(result.details.validationErrors?.length).toBeGreaterThan(0);
    });
  });

  describe("dependency injection", () => {
    it("should allow custom dependencies", async () => {
      const mockCliParser = new CliParser();
      const mockConfigLoader = new ConfigFileLoader();
      const mockMerger = new ConfigMerger();
      const mockValidator = new ConfigValidator();

      const resolver = new ConfigResolver(
        mockCliParser,
        mockConfigLoader,
        mockMerger,
        mockValidator,
      );

      const result = await resolver.resolve({
        cliOptions: {
          tools: ["copilot"],
        },
        workingDirectory: testDir,
      });

      expect(result.value.defaultTargets).toEqual(["copilot"]);
    });
  });

  describe("error handling", () => {
    it("should wrap non-ConfigValidationError errors", async () => {
      // Create a resolver that will cause an error
      const mockConfigLoader = {
        load: () => {
          throw new Error("Test error");
        },
      } as any;

      const resolver = new ConfigResolver(undefined, mockConfigLoader);

      await expect(
        resolver.resolve({
          cliOptions: {
            tools: ["copilot"],
          },
          workingDirectory: testDir,
        }),
      ).rejects.toThrow("Failed to resolve configuration");
    });
  });
});

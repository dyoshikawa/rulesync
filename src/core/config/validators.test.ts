import { describe, expect, it } from "vitest";
import type { MergedConfig, ToolTarget } from "../../types/index.js";
import { ALL_TOOL_TARGETS } from "../../types/tool-targets.js";
import { ConfigValidationError, ConfigValidator } from "./validators.js";

describe("ConfigValidator", () => {
  const validator = new ConfigValidator();

  const createCompleteOutputPaths = (): Record<ToolTarget, string> => {
    const paths: Record<ToolTarget, string> = {} as Record<ToolTarget, string>;
    for (const tool of ALL_TOOL_TARGETS) {
      paths[tool] = `.${tool}/rules/`;
    }
    return paths;
  };

  const createValidMergedConfig = (): MergedConfig => ({
    aiRulesDir: ".rulesync",
    outputPaths: createCompleteOutputPaths(),
    watchEnabled: false,
    defaultTargets: ["copilot"],
  });

  describe("validateCliOptions", () => {
    it("should pass validation for valid options", () => {
      expect(() =>
        validator.validateCliOptions({
          tools: ["copilot"],
          verbose: true,
          config: "rulesync.json",
        }),
      ).not.toThrow();
    });

    it("should throw for conflicting config options", () => {
      expect(() =>
        validator.validateCliOptions({
          config: "rulesync.json",
          noConfig: true,
        }),
      ).toThrow(ConfigValidationError);
    });

    it("should throw for empty arrays", () => {
      expect(() =>
        validator.validateCliOptions({
          tools: [],
          baseDirs: [],
        }),
      ).toThrow(ConfigValidationError);
    });

    it("should throw for invalid base directories", () => {
      expect(() =>
        validator.validateCliOptions({
          baseDirs: ["valid-dir", "", "  "],
        }),
      ).toThrow(ConfigValidationError);
    });

    it("should include multiple errors in validation error", () => {
      try {
        validator.validateCliOptions({
          config: "rulesync.json",
          noConfig: true,
          tools: [],
          baseDirs: [""],
        });
        expect.fail("Should have thrown ConfigValidationError");
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigValidationError);
        const validationError = error as ConfigValidationError;
        expect(validationError.errors.length).toBeGreaterThan(1);
        expect(validationError.errors).toContain(
          "--config and --no-config cannot be used together",
        );
        expect(validationError.errors).toContain("--tools cannot be empty");
      }
    });
  });

  describe("validateMergedConfig", () => {
    it("should pass validation for valid config", () => {
      const config = createValidMergedConfig();

      expect(() => validator.validateMergedConfig(config)).not.toThrow();
    });

    it("should throw for missing required fields", () => {
      const config = {
        aiRulesDir: "",
        outputPaths: undefined,
        watchEnabled: undefined,
        defaultTargets: [],
      } as any;

      expect(() => validator.validateMergedConfig(config)).toThrow(ConfigValidationError);
    });

    it("should validate baseDir array correctly", () => {
      const config: MergedConfig = {
        ...createValidMergedConfig(),
        baseDir: ["valid-dir", "", "  "],
      };

      expect(() => validator.validateMergedConfig(config)).toThrow(ConfigValidationError);
    });

    it("should validate exclude against defaultTargets", () => {
      const config: MergedConfig = {
        ...createValidMergedConfig(),
        defaultTargets: ["copilot", "cursor"],
        exclude: ["augmentcode"], // Not in defaultTargets
      };

      expect(() => validator.validateMergedConfig(config)).toThrow(ConfigValidationError);
    });

    it("should allow valid exclude values", () => {
      const config: MergedConfig = {
        ...createValidMergedConfig(),
        defaultTargets: ["copilot", "cursor", "augmentcode"],
        exclude: ["augmentcode"], // Valid subset
      };

      expect(() => validator.validateMergedConfig(config)).not.toThrow();
    });

    it("should handle string baseDir correctly", () => {
      const config: MergedConfig = {
        ...createValidMergedConfig(),
        baseDir: "valid-dir",
      };

      expect(() => validator.validateMergedConfig(config)).not.toThrow();
    });

    it("should throw for empty string baseDir", () => {
      const config: MergedConfig = {
        ...createValidMergedConfig(),
        baseDir: "",
      };

      expect(() => validator.validateMergedConfig(config)).toThrow(ConfigValidationError);
    });
  });

  describe("validateConfigPath", () => {
    it("should pass for valid config path", () => {
      expect(() => validator.validateConfigPath("valid-path.json")).not.toThrow();
    });

    it("should pass for undefined config path", () => {
      expect(() => validator.validateConfigPath(undefined)).not.toThrow();
    });

    it("should throw for non-string config path", () => {
      expect(() => validator.validateConfigPath(123 as any)).toThrow(ConfigValidationError);
    });

    it("should throw for empty config path", () => {
      expect(() => validator.validateConfigPath("")).toThrow(ConfigValidationError);
      expect(() => validator.validateConfigPath("  ")).toThrow(ConfigValidationError);
    });
  });

  describe("validateWorkingDirectory", () => {
    it("should pass for valid working directory", () => {
      expect(() => validator.validateWorkingDirectory("/valid/path")).not.toThrow();
    });

    it("should pass for undefined working directory", () => {
      expect(() => validator.validateWorkingDirectory(undefined)).not.toThrow();
    });

    it("should throw for non-string working directory", () => {
      expect(() => validator.validateWorkingDirectory(123 as any)).toThrow(ConfigValidationError);
    });

    it("should throw for empty working directory", () => {
      expect(() => validator.validateWorkingDirectory("")).toThrow(ConfigValidationError);
      expect(() => validator.validateWorkingDirectory("  ")).toThrow(ConfigValidationError);
    });
  });

  describe("ConfigValidationError", () => {
    it("should create error with message and errors", () => {
      const errors = ["Error 1", "Error 2"];
      const error = new ConfigValidationError("Test message", errors);

      expect(error.message).toBe("Test message");
      expect(error.errors).toEqual(errors);
      expect(error.name).toBe("ConfigValidationError");
      expect(error).toBeInstanceOf(Error);
    });
  });
});

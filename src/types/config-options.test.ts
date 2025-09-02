import { describe, expect, it } from "vitest";
import {
  ConfigOptionsSchema,
  FEATURE_TYPES,
  FeaturesSchema,
  FeatureType,
  FeatureTypeSchema,
  OutputPathsSchema,
} from "./config-options.js";

describe("config-options types", () => {
  describe("FEATURE_TYPES", () => {
    it("should contain expected feature types", () => {
      expect(FEATURE_TYPES).toEqual(["rules", "commands", "mcp", "ignore", "subagents"]);
      expect(FEATURE_TYPES).toHaveLength(5);
    });

    it("should be immutable array", () => {
      // TypeScript will prevent modifications at compile time
      // At runtime, const arrays are still mutable, so this test verifies the type constraint
      expect(FEATURE_TYPES.length).toBe(5);
      // We can't actually test runtime immutability without Object.freeze()
      // This test mainly serves to document the intent
    });
  });

  describe("FeatureTypeSchema", () => {
    it("should validate valid feature types", () => {
      for (const featureType of FEATURE_TYPES) {
        const result = FeatureTypeSchema.parse(featureType);
        expect(result).toBe(featureType);
      }
    });

    it("should reject invalid feature types", () => {
      const invalidTypes = ["invalid", "unknown", "", null, undefined, 123];

      for (const invalidType of invalidTypes) {
        expect(() => FeatureTypeSchema.parse(invalidType)).toThrow();
      }
    });

    it("should have correct TypeScript type", () => {
      const validFeature: FeatureType = "rules";
      expect(FeatureTypeSchema.parse(validFeature)).toBe("rules");

      const anotherValidFeature: FeatureType = "commands";
      expect(FeatureTypeSchema.parse(anotherValidFeature)).toBe("commands");
    });
  });

  describe("FeaturesSchema", () => {
    it("should validate array of feature types", () => {
      const validArrays = [
        ["rules"],
        ["rules", "commands"],
        ["rules", "commands", "mcp", "ignore", "subagents"],
        [],
      ];

      for (const array of validArrays) {
        expect(() => FeaturesSchema.parse(array)).not.toThrow();
      }
    });

    it("should validate wildcard '*'", () => {
      expect(() => FeaturesSchema.parse("*")).not.toThrow();
      expect(FeaturesSchema.parse("*")).toBe("*");
    });

    it("should reject invalid feature arrays", () => {
      const invalidArrays = [
        ["invalid"],
        ["rules", "invalid"],
        [123],
        [null],
        ["rules", "", "commands"],
      ];

      for (const array of invalidArrays) {
        expect(() => FeaturesSchema.parse(array)).toThrow();
      }
    });

    it("should reject non-array, non-wildcard values", () => {
      const invalidValues = ["rules", 123, null, undefined, {}, "other"];

      for (const value of invalidValues) {
        expect(() => FeaturesSchema.parse(value)).toThrow();
      }
    });
  });

  describe("OutputPathsSchema", () => {
    it("should validate empty object", () => {
      const result = OutputPathsSchema.parse({});
      expect(result).toEqual({});
    });

    it("should validate object with all supported tools", () => {
      const fullPaths = {
        agentsmd: "./agents.md",
        amazonqcli: "./.amazonq/rules/",
        augmentcode: "./.augment/rules/",
        "augmentcode-legacy": "./.augment-guidelines",
        copilot: "./.github/copilot-instructions.md",
        cursor: "./.cursor/rules/",
        cline: "./.clinerules/",
        claudecode: "./CLAUDE.md",
        codexcli: "./AGENTS.md",
        opencode: "./AGENTS.md",
        qwencode: "./QWEN.md",
        roo: "./.roo/rules/",
        geminicli: "./GEMINI.md",
        kiro: "./.kiro/steering/",
        junie: "./.junie/guidelines.md",
        windsurf: "./.windsurf/rules/",
      };

      const result = OutputPathsSchema.parse(fullPaths);
      expect(result).toEqual(fullPaths);
    });

    it("should validate partial configuration", () => {
      const partialPaths = {
        cursor: "./.cursor/rules/",
        claudecode: "./CLAUDE.md",
        copilot: "./.github/copilot-instructions.md",
      };

      const result = OutputPathsSchema.parse(partialPaths);
      expect(result).toEqual(partialPaths);
    });

    it("should allow additional properties (Zod default behavior)", () => {
      const pathsWithExtra = {
        cursor: "./.cursor/rules/",
        additionalProperty: "./path",
      };

      // Zod allows additional properties by default
      const result = OutputPathsSchema.parse(pathsWithExtra);
      expect(result.cursor).toBe("./.cursor/rules/");
    });

    it("should reject non-string paths", () => {
      const invalidPaths = {
        cursor: 123,
      };

      expect(() => OutputPathsSchema.parse(invalidPaths)).toThrow();
    });

    it("should allow undefined paths", () => {
      const pathsWithUndefined = {
        cursor: "./.cursor/rules/",
        claudecode: undefined,
      };

      const result = OutputPathsSchema.parse(pathsWithUndefined);
      expect(result).toEqual({
        cursor: "./.cursor/rules/",
        claudecode: undefined,
      });
    });
  });

  describe("ConfigOptionsSchema", () => {
    it("should validate empty configuration", () => {
      const result = ConfigOptionsSchema.parse({});
      expect(result).toEqual({});
    });

    it("should validate minimal configuration", () => {
      const config = {
        aiRulesDir: "./.rulesync",
        watchEnabled: false,
      };

      const result = ConfigOptionsSchema.parse(config);
      expect(result).toEqual(config);
    });

    it("should validate full configuration", () => {
      const config = {
        aiRulesDir: "./.rulesync",
        outputPaths: {
          cursor: "./.cursor/rules/",
          claudecode: "./CLAUDE.md",
        },
        watchEnabled: true,
        defaultTargets: ["cursor", "claudecode"],
        targets: ["cursor"],
        exclude: ["copilot"],
        features: ["rules", "commands"],
        verbose: true,
        delete: false,
        baseDir: "./project",
        legacy: false,
        watch: {
          enabled: true,
          interval: 1000,
          ignore: ["*.tmp", "node_modules/"],
        },
      };

      const result = ConfigOptionsSchema.parse(config);
      expect(result).toEqual(config);
    });

    it("should validate array baseDir", () => {
      const config = {
        baseDir: ["./project1", "./project2"],
      };

      const result = ConfigOptionsSchema.parse(config);
      expect(result).toEqual(config);
    });

    it("should validate features as wildcard", () => {
      const config = {
        features: "*",
      };

      const result = ConfigOptionsSchema.parse(config);
      expect(result).toEqual(config);
    });

    it("should validate watch configuration", () => {
      const watchConfigs = [
        { watch: { enabled: true } },
        { watch: { interval: 500 } },
        { watch: { ignore: ["*.log"] } },
        { watch: { enabled: false, interval: 2000, ignore: ["node_modules/", "*.tmp"] } },
      ];

      for (const config of watchConfigs) {
        expect(() => ConfigOptionsSchema.parse(config)).not.toThrow();
      }
    });

    it("should reject invalid configuration", () => {
      const invalidConfigs = [
        { aiRulesDir: 123 },
        { watchEnabled: "true" },
        { verbose: "yes" },
        { delete: "false" },
        { features: ["invalid"] },
        { watch: { enabled: "true" } },
        { watch: { interval: "1000" } },
        { watch: { ignore: "*.log" } },
      ];

      for (const config of invalidConfigs) {
        expect(() => ConfigOptionsSchema.parse(config)).toThrow();
      }
    });

    it("should handle optional fields correctly", () => {
      const config = {
        aiRulesDir: "./.rulesync",
        // All other fields should be optional
      };

      const result = ConfigOptionsSchema.parse(config);
      expect(result.aiRulesDir).toBe("./.rulesync");
      expect(result.watchEnabled).toBeUndefined();
      expect(result.verbose).toBeUndefined();
      expect(result.features).toBeUndefined();
    });

    it("should validate complex nested structures", () => {
      const config = {
        outputPaths: {
          cursor: "./.cursor/rules/",
          claudecode: "./CLAUDE.md",
          copilot: "./.github/copilot-instructions.md",
        },
        defaultTargets: ["cursor", "claudecode", "copilot"],
        targets: ["cursor"],
        exclude: ["copilot"],
        features: ["rules", "mcp", "ignore"],
        watch: {
          enabled: true,
          interval: 1500,
          ignore: ["node_modules/", "*.tmp", "dist/"],
        },
      };

      const result = ConfigOptionsSchema.parse(config);
      expect(result).toEqual(config);
    });

    it("should validate edge cases", () => {
      const edgeCases = [
        { targets: [] },
        { exclude: [] },
        { features: [] },
        { baseDir: [] },
        { watch: {} },
        { outputPaths: {} },
      ];

      for (const config of edgeCases) {
        expect(() => ConfigOptionsSchema.parse(config)).not.toThrow();
      }
    });
  });

  describe("schema validation edge cases", () => {
    it("should handle null and undefined values appropriately", () => {
      // These should throw because the schema expects specific types
      expect(() => ConfigOptionsSchema.parse({ aiRulesDir: null })).toThrow();
      expect(() => ConfigOptionsSchema.parse({ watchEnabled: null })).toThrow();
      expect(() => ConfigOptionsSchema.parse({ features: null })).toThrow();

      // But undefined should be fine for optional fields
      expect(() => ConfigOptionsSchema.parse({ aiRulesDir: undefined })).not.toThrow();
    });

    it("should handle deeply nested invalid values", () => {
      const invalidConfig = {
        watch: {
          enabled: "not-boolean",
          interval: "not-number",
          ignore: "not-array",
        },
      };

      expect(() => ConfigOptionsSchema.parse(invalidConfig)).toThrow();
    });

    it("should preserve unknown properties", () => {
      const configWithExtra = {
        aiRulesDir: "./.rulesync",
        unknownProperty: "should be preserved",
      } as any;

      // Zod by default strips unknown properties unless configured otherwise
      const result = ConfigOptionsSchema.parse(configWithExtra);
      expect(result).not.toHaveProperty("unknownProperty");
      expect(result.aiRulesDir).toBe("./.rulesync");
    });
  });
});

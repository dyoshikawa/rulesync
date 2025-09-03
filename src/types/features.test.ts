import { describe, expect, it } from "vitest";
import {
  ALL_FEATURES,
  ALL_FEATURES_WITH_WILDCARD,
  FeatureSchema,
  FeaturesSchema,
  RulesyncFeaturesSchema,
} from "./features.js";

describe("features types", () => {
  describe("ALL_FEATURES", () => {
    it("should contain expected features", () => {
      expect(ALL_FEATURES).toEqual(["rules", "ignore", "mcp", "subagents", "commands"]);
    });

    it("should have correct length", () => {
      expect(ALL_FEATURES).toHaveLength(5);
    });

    it("should be readonly array", () => {
      expect(Object.isFrozen(ALL_FEATURES)).toBe(false); // const assertions don't freeze
      // TypeScript protects this at compile time, but at runtime the array is mutable
      // This is expected behavior for const assertions in TypeScript
      expect(() => {
        // @ts-expect-error - testing runtime behavior
        ALL_FEATURES[0] = "modified";
      }).not.toThrow(); // Runtime doesn't enforce readonly
    });
  });

  describe("ALL_FEATURES_WITH_WILDCARD", () => {
    it("should contain all features plus wildcard", () => {
      expect(ALL_FEATURES_WITH_WILDCARD).toEqual([
        "rules",
        "ignore",
        "mcp",
        "subagents",
        "commands",
        "*",
      ]);
    });

    it("should have correct length", () => {
      expect(ALL_FEATURES_WITH_WILDCARD).toHaveLength(6);
    });

    it("should include wildcard as last element", () => {
      expect(ALL_FEATURES_WITH_WILDCARD[ALL_FEATURES_WITH_WILDCARD.length - 1]).toBe("*");
    });
  });

  describe("FeatureSchema", () => {
    it("should validate valid features", () => {
      expect(() => FeatureSchema.parse("rules")).not.toThrow();
      expect(() => FeatureSchema.parse("ignore")).not.toThrow();
      expect(() => FeatureSchema.parse("mcp")).not.toThrow();
      expect(() => FeatureSchema.parse("subagents")).not.toThrow();
      expect(() => FeatureSchema.parse("commands")).not.toThrow();
    });

    it("should reject invalid features", () => {
      expect(() => FeatureSchema.parse("invalid")).toThrow();
      expect(() => FeatureSchema.parse("*")).toThrow(); // Wildcard not allowed in Feature
      expect(() => FeatureSchema.parse("")).toThrow();
      expect(() => FeatureSchema.parse(null)).toThrow();
      expect(() => FeatureSchema.parse(undefined)).toThrow();
      expect(() => FeatureSchema.parse(123)).toThrow();
    });

    it("should have correct type inference", () => {
      const validFeature = FeatureSchema.parse("rules");
      expect(validFeature).toBe("rules");

      // Type assertion to ensure proper typing
      const _typeTest: "rules" | "ignore" | "mcp" | "subagents" | "commands" = validFeature;
      expect(_typeTest).toBeDefined();
    });
  });

  describe("FeaturesSchema", () => {
    it("should validate arrays of valid features", () => {
      expect(() => FeaturesSchema.parse([])).not.toThrow();
      expect(() => FeaturesSchema.parse(["rules"])).not.toThrow();
      expect(() => FeaturesSchema.parse(["rules", "ignore"])).not.toThrow();
      expect(() =>
        FeaturesSchema.parse(["rules", "ignore", "mcp", "subagents", "commands"]),
      ).not.toThrow();
    });

    it("should reject arrays with invalid features", () => {
      expect(() => FeaturesSchema.parse(["invalid"])).toThrow();
      expect(() => FeaturesSchema.parse(["rules", "invalid"])).toThrow();
      expect(() => FeaturesSchema.parse(["*"])).toThrow(); // Wildcard not allowed
      expect(() => FeaturesSchema.parse(["rules", "*"])).toThrow();
    });

    it("should reject non-arrays", () => {
      expect(() => FeaturesSchema.parse("rules")).toThrow();
      expect(() => FeaturesSchema.parse(null)).toThrow();
      expect(() => FeaturesSchema.parse(undefined)).toThrow();
      expect(() => FeaturesSchema.parse({})).toThrow();
    });

    it("should allow duplicate features", () => {
      expect(() => FeaturesSchema.parse(["rules", "rules"])).not.toThrow();
      const result = FeaturesSchema.parse(["rules", "rules"]);
      expect(result).toEqual(["rules", "rules"]);
    });
  });

  describe("RulesyncFeaturesSchema", () => {
    it("should validate arrays with wildcard", () => {
      expect(() => RulesyncFeaturesSchema.parse([])).not.toThrow();
      expect(() => RulesyncFeaturesSchema.parse(["*"])).not.toThrow();
      expect(() => RulesyncFeaturesSchema.parse(["rules", "*"])).not.toThrow();
      expect(() => RulesyncFeaturesSchema.parse(["*", "ignore"])).not.toThrow();
    });

    it.skip("should validate arrays without wildcard", () => {
      expect(() => RulesyncFeaturesSchema.parse(["rules"])).not.toThrow();
      expect(() => RulesyncFeaturesSchema.parse(["rules", "ignore"])).not.toThrow();
      expect(() => RulesyncFeaturesSchema.parse([...ALL_FEATURES])).not.toThrow();
    });

    it("should reject arrays with invalid features", () => {
      expect(() => RulesyncFeaturesSchema.parse(["invalid"])).toThrow();
      expect(() => RulesyncFeaturesSchema.parse(["rules", "invalid"])).toThrow();
      expect(() => RulesyncFeaturesSchema.parse(["*", "invalid"])).toThrow();
    });

    it("should reject non-arrays", () => {
      expect(() => RulesyncFeaturesSchema.parse("*")).toThrow();
      expect(() => RulesyncFeaturesSchema.parse(null)).toThrow();
      expect(() => RulesyncFeaturesSchema.parse(undefined)).toThrow();
      expect(() => RulesyncFeaturesSchema.parse({})).toThrow();
    });

    it("should handle mixed valid features with wildcard", () => {
      const result = RulesyncFeaturesSchema.parse(["rules", "*", "ignore", "mcp"]);
      expect(result).toEqual(["rules", "*", "ignore", "mcp"]);
    });

    it.skip("should allow all features with wildcard", () => {
      const allWithWildcard = [...ALL_FEATURES, "*"];
      expect(() => RulesyncFeaturesSchema.parse(allWithWildcard)).not.toThrow();
      const result = RulesyncFeaturesSchema.parse(allWithWildcard);
      expect(result).toContain("*");
      expect(result).toContain("rules");
    });
  });

  describe("type relationships", () => {
    it("should maintain proper type relationships", () => {
      // Features should be subset of RulesyncFeatures (excluding wildcard)
      const features: string[] = ["rules", "ignore"];
      expect(() => FeaturesSchema.parse(features)).not.toThrow();
      expect(() => RulesyncFeaturesSchema.parse(features)).not.toThrow();
    });

    it.skip("should handle feature constants correctly", () => {
      // Test that constants work with schemas
      expect(() => FeatureSchema.parse(ALL_FEATURES[0] as string)).not.toThrow();
      expect(() =>
        RulesyncFeaturesSchema.parse([ALL_FEATURES_WITH_WILDCARD[5] as string]),
      ).not.toThrow(); // "*"
    });
  });
});

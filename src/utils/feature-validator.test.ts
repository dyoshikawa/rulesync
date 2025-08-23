import { describe, expect, it } from "vitest";
import type { FeatureType } from "../types/config-options.js";
import {
  expandWildcard,
  isWildcard,
  normalizeFeatures,
  validateFeatures,
} from "./feature-validator.js";

describe("feature-validator", () => {
  describe("validateFeatures", () => {
    it("should return '*' for undefined input", () => {
      expect(validateFeatures(undefined)).toBe("*");
    });

    it("should return '*' for wildcard input", () => {
      expect(validateFeatures("*")).toBe("*");
    });

    it("should validate valid feature array", () => {
      const result = validateFeatures(["rules", "commands"] as FeatureType[]);
      expect(result).toEqual(["rules", "commands"]);
    });

    it("should remove duplicates while preserving order", () => {
      const result = validateFeatures(["rules", "commands", "rules", "mcp"] as FeatureType[]);
      expect(result).toEqual(["rules", "commands", "mcp"]);
    });

    it("should throw error for invalid feature", () => {
      expect(() => validateFeatures(["invalid"])).toThrow(
        "Invalid feature types: invalid. Valid features are: rules, commands, mcp, ignore, subagents",
      );
    });

    it("should throw error for empty array", () => {
      expect(() => validateFeatures([])).toThrow(
        'Features array cannot be empty. Use "*" to include all features',
      );
    });

    it("should throw error for non-array non-string input", () => {
      expect(() => validateFeatures(123 as any)).toThrow(
        'Features must be an array of feature names or "*"',
      );
    });

    it("should handle mixed valid and invalid features", () => {
      expect(() => validateFeatures(["rules", "invalid1", "commands", "invalid2"])).toThrow(
        "Invalid feature types: invalid1, invalid2. Valid features are: rules, commands, mcp, ignore, subagents",
      );
    });
  });

  describe("expandWildcard", () => {
    it("should return all feature types", () => {
      const result = expandWildcard();
      expect(result).toEqual(["rules", "commands", "mcp", "ignore", "subagents"]);
    });
  });

  describe("normalizeFeatures", () => {
    it("should expand wildcard to all features", () => {
      expect(normalizeFeatures("*")).toEqual(["rules", "commands", "mcp", "ignore", "subagents"]);
    });

    it("should expand undefined to all features", () => {
      expect(normalizeFeatures(undefined)).toEqual([
        "rules",
        "commands",
        "mcp",
        "ignore",
        "subagents",
      ]);
    });

    it("should return feature array as-is", () => {
      const features: FeatureType[] = ["rules", "commands"];
      expect(normalizeFeatures(features)).toEqual(features);
    });
  });

  describe("isWildcard", () => {
    it("should return true for '*'", () => {
      expect(isWildcard("*")).toBe(true);
    });

    it("should return true for undefined", () => {
      expect(isWildcard(undefined)).toBe(true);
    });

    it("should return true for array with all features", () => {
      expect(isWildcard(["rules", "commands", "mcp", "ignore", "subagents"])).toBe(true);
    });

    it("should return true for array with all features in different order", () => {
      expect(isWildcard(["ignore", "mcp", "rules", "commands", "subagents"])).toBe(true);
    });

    it("should return false for partial feature array", () => {
      expect(isWildcard(["rules", "commands"])).toBe(false);
    });

    it("should return false for empty array", () => {
      expect(isWildcard([])).toBe(false);
    });

    it("should return false for non-array non-string", () => {
      expect(isWildcard(123 as any)).toBe(false);
    });
  });
});

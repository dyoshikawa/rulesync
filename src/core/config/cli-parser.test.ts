import { describe, expect, it } from "vitest";
import { CliParser } from "./cli-parser.js";

describe("CliParser", () => {
  const parser = new CliParser();

  describe("parse", () => {
    it("should parse valid CLI options", () => {
      const result = parser.parse({
        tools: ["copilot", "cursor"],
        verbose: true,
        delete: false,
        baseDirs: ["./src"],
        config: "rulesync.json",
      });

      expect(result).toEqual({
        tools: ["copilot", "cursor"],
        verbose: true,
        delete: false,
        baseDirs: ["./src"],
        config: "rulesync.json",
      });
    });

    it("should filter out undefined values", () => {
      const result = parser.parse({
        tools: ["copilot"],
        delete: false,
      });

      expect(result).toEqual({
        tools: ["copilot"],
        delete: false,
      });
    });

    it("should filter out empty arrays", () => {
      const result = parser.parse({
        tools: [],
        baseDirs: [],
      });

      expect(result).toEqual({});
    });

    it("should handle boolean false values correctly", () => {
      const result = parser.parse({
        verbose: false,
        delete: false,
        noConfig: false,
      });

      expect(result).toEqual({
        verbose: false,
        delete: false,
        noConfig: false,
      });
    });
  });

  describe("validate", () => {
    it("should validate successful for valid options", () => {
      const result = parser.validate({
        tools: ["copilot"],
        verbose: true,
        config: "rulesync.json",
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should detect conflicting config options", () => {
      const result = parser.validate({
        config: "rulesync.json",
        noConfig: true,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("--config and --no-config cannot be used together");
    });

    it("should detect empty arrays", () => {
      const result = parser.validate({
        tools: [],
        baseDirs: [],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("--tools cannot be empty");
      expect(result.errors).toContain("--base-dirs cannot be empty");
    });

    it("should allow undefined values", () => {
      const result = parser.validate({});

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });
});

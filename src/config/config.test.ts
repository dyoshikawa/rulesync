import { describe, expect, it } from "vitest";
import { Config } from "./config.js";

describe("Config", () => {
  describe("constructor", () => {
    it("should create config with all parameters", () => {
      const config = new Config({
        baseDirs: ["/test/dir1", "/test/dir2"],
        targets: ["cursor", "copilot"],
        features: ["rules", "ignore"],
        verbose: true,
        delete: true,
      });

      expect(config).toBeInstanceOf(Config);
    });

    it("should handle single base directory", () => {
      const config = new Config({
        baseDirs: ["."],
        targets: ["cursor"],
        features: ["rules"],
        verbose: false,
        delete: false,
      });

      expect(config.getBaseDirs()).toEqual(["."]);
    });
  });

  describe("getBaseDirs", () => {
    it("should return base directories", () => {
      const config = new Config({
        baseDirs: ["/test/dir1", "/test/dir2"],
        targets: ["cursor"],
        features: ["rules"],
        verbose: false,
        delete: false,
      });

      expect(config.getBaseDirs()).toEqual(["/test/dir1", "/test/dir2"]);
    });

    it("should return empty array when no base directories", () => {
      const config = new Config({
        baseDirs: [],
        targets: ["cursor"],
        features: ["rules"],
        verbose: false,
        delete: false,
      });

      expect(config.getBaseDirs()).toEqual([]);
    });
  });

  describe("getTargets", () => {
    it("should return specific targets", () => {
      const config = new Config({
        baseDirs: ["."],
        targets: ["cursor", "copilot"],
        features: ["rules"],
        verbose: false,
        delete: false,
      });

      expect(config.getTargets()).toEqual(["cursor", "copilot"]);
    });

    it("should return all targets when wildcard is used", () => {
      const config = new Config({
        baseDirs: ["."],
        targets: ["*"],
        features: ["rules"],
        verbose: false,
        delete: false,
      });

      const targets = config.getTargets();
      expect(targets.length).toBeGreaterThan(5);
      expect(targets).toContain("cursor");
      expect(targets).toContain("copilot");
      expect(targets).toContain("claudecode");
    });

    it("should filter out wildcard from mixed targets", () => {
      const config = new Config({
        baseDirs: ["."],
        targets: ["cursor", "*", "copilot"],
        features: ["rules"],
        verbose: false,
        delete: false,
      });

      const targets = config.getTargets();
      expect(targets).not.toContain("*");
      expect(targets).toContain("cursor");
      expect(targets).toContain("copilot");
    });

    it("should handle empty targets array", () => {
      const config = new Config({
        baseDirs: ["."],
        targets: [],
        features: ["rules"],
        verbose: false,
        delete: false,
      });

      expect(config.getTargets()).toEqual([]);
    });
  });

  describe("getFeatures", () => {
    it("should return specific features", () => {
      const config = new Config({
        baseDirs: ["."],
        targets: ["cursor"],
        features: ["rules", "ignore"],
        verbose: false,
        delete: false,
      });

      expect(config.getFeatures()).toEqual(["rules", "ignore"]);
    });

    it("should return all features when wildcard is used", () => {
      const config = new Config({
        baseDirs: ["."],
        targets: ["cursor"],
        features: ["*"],
        verbose: false,
        delete: false,
      });

      const features = config.getFeatures();
      expect(features).toContain("rules");
      expect(features).toContain("ignore");
      expect(features).toContain("mcp");
      expect(features).toContain("commands");
      expect(features).toContain("subagents");
    });

    it("should filter out wildcard from mixed features", () => {
      const config = new Config({
        baseDirs: ["."],
        targets: ["cursor"],
        features: ["rules", "*", "ignore"],
        verbose: false,
        delete: false,
      });

      const features = config.getFeatures();
      expect(features).not.toContain("*");
      expect(features).toContain("rules");
      expect(features).toContain("ignore");
    });

    it("should handle empty features array", () => {
      const config = new Config({
        baseDirs: ["."],
        targets: ["cursor"],
        features: [],
        verbose: false,
        delete: false,
      });

      expect(config.getFeatures()).toEqual([]);
    });
  });

  describe("getVerbose", () => {
    it("should return true when verbose is enabled", () => {
      const config = new Config({
        baseDirs: ["."],
        targets: ["cursor"],
        features: ["rules"],
        verbose: true,
        delete: false,
      });

      expect(config.getVerbose()).toBe(true);
    });

    it("should return false when verbose is disabled", () => {
      const config = new Config({
        baseDirs: ["."],
        targets: ["cursor"],
        features: ["rules"],
        verbose: false,
        delete: false,
      });

      expect(config.getVerbose()).toBe(false);
    });
  });

  describe("getDelete", () => {
    it("should return true when delete is enabled", () => {
      const config = new Config({
        baseDirs: ["."],
        targets: ["cursor"],
        features: ["rules"],
        verbose: false,
        delete: true,
      });

      expect(config.getDelete()).toBe(true);
    });

    it("should return false when delete is disabled", () => {
      const config = new Config({
        baseDirs: ["."],
        targets: ["cursor"],
        features: ["rules"],
        verbose: false,
        delete: false,
      });

      expect(config.getDelete()).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle complex configuration", () => {
      const config = new Config({
        baseDirs: [".", "src", "tests"],
        targets: ["cursor", "copilot", "claudecode", "cline"],
        features: ["rules", "ignore", "mcp", "commands", "subagents"],
        verbose: true,
        delete: true,
      });

      expect(config.getBaseDirs()).toHaveLength(3);
      expect(config.getTargets()).toHaveLength(4);
      expect(config.getFeatures()).toHaveLength(5);
      expect(config.getVerbose()).toBe(true);
      expect(config.getDelete()).toBe(true);
    });

    it("should handle duplicate targets", () => {
      const config = new Config({
        baseDirs: ["."],
        targets: ["cursor", "cursor", "copilot"],
        features: ["rules"],
        verbose: false,
        delete: false,
      });

      expect(config.getTargets()).toEqual(["cursor", "cursor", "copilot"]);
    });
  });
});

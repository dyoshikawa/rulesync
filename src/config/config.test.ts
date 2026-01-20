import { describe, expect, it } from "vitest";

import { ALL_TOOL_TARGETS } from "../types/tool-targets.js";
import { Config, type ConfigParams } from "./config.js";

describe("Config", () => {
  const defaultConfig: ConfigParams = {
    baseDirs: ["."],
    targets: ["cursor"],
    features: ["rules"],
    verbose: false,
    delete: false,
    silent: false,
  };

  const createConfig = (overrides: Partial<ConfigParams> = {}) => {
    return new Config({
      ...defaultConfig,
      ...overrides,
    });
  };

  describe("conflicting targets validation", () => {
    it("should throw error when claudecode and claudecode-legacy are both specified", () => {
      expect(() =>
        createConfig({
          targets: ["claudecode", "claudecode-legacy"],
        }),
      ).toThrow(
        "Conflicting targets: 'claudecode' and 'claudecode-legacy' cannot be used together. Please choose one.",
      );
    });

    it("should throw error when augmentcode and augmentcode-legacy are both specified", () => {
      expect(() =>
        createConfig({
          targets: ["augmentcode", "augmentcode-legacy"],
        }),
      ).toThrow(
        "Conflicting targets: 'augmentcode' and 'augmentcode-legacy' cannot be used together. Please choose one.",
      );
    });

    it("should allow claudecode without claudecode-legacy", () => {
      expect(() => createConfig({ targets: ["claudecode"] })).not.toThrow();
    });

    it("should allow claudecode-legacy without claudecode", () => {
      expect(() => createConfig({ targets: ["claudecode-legacy"] })).not.toThrow();
    });

    it("should allow multiple non-conflicting targets", () => {
      expect(() =>
        createConfig({
          targets: ["claudecode", "cursor", "copilot", "augmentcode"],
        }),
      ).not.toThrow();
    });
  });

  describe("getTargets with wildcard expansion", () => {
    it("should exclude legacy targets when wildcard is used", () => {
      const config = createConfig({ targets: ["*"] });
      const targets = config.getTargets();

      expect(targets).not.toContain("claudecode-legacy");
      expect(targets).not.toContain("augmentcode-legacy");
      expect(targets).toContain("claudecode");
      expect(targets).toContain("augmentcode");
    });

    it("should include all non-legacy targets when wildcard is used", () => {
      const config = createConfig({ targets: ["*"] });
      const targets = config.getTargets();

      const expectedTargets = ALL_TOOL_TARGETS.filter(
        (t) => t !== "claudecode-legacy" && t !== "augmentcode-legacy",
      );

      expect(targets).toEqual(expectedTargets);
    });

    it("should return explicit targets when no wildcard", () => {
      const config = createConfig({ targets: ["cursor", "claudecode"] });
      const targets = config.getTargets();

      expect(targets).toEqual(["cursor", "claudecode"]);
    });

    it("should allow explicit legacy targets", () => {
      const config = createConfig({ targets: ["claudecode-legacy"] });
      const targets = config.getTargets();

      expect(targets).toEqual(["claudecode-legacy"]);
    });

    it("should filter out wildcard from returned targets", () => {
      const config = createConfig({ targets: ["cursor", "*"] });
      const targets = config.getTargets();

      expect(targets).not.toContain("*");
    });
  });

  describe("getSilent", () => {
    it("should return true when silent is set to true", () => {
      const config = createConfig({ silent: true });
      expect(config.getSilent()).toBe(true);
    });

    it("should return false when silent is set to false", () => {
      const config = createConfig({ silent: false });
      expect(config.getSilent()).toBe(false);
    });

    it("should default to false when silent is not specified", () => {
      const config = createConfig({});
      expect(config.getSilent()).toBe(false);
    });
  });
});

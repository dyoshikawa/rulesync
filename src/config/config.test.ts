import { isAbsolute, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ALL_FEATURES } from "../types/features.js";
import { ALL_TOOL_TARGETS } from "../types/tool-targets.js";
import { assertTargetsFeaturesExclusive, Config, type ConfigParams } from "./config.js";

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
    // The new schema-level mutual-exclusivity rule rejects any config that
    // mixes an object-form side with a defined value on the other side
    // (e.g., object-form `targets` + array-form `features`). The helper
    // therefore strips the conflicting default automatically so individual
    // tests can focus on the override they care about without repeating
    // `features: undefined` / `targets: undefined` boilerplate.
    const targetsIsObject = overrides.targets !== undefined && !Array.isArray(overrides.targets);
    const featuresIsObject = overrides.features !== undefined && !Array.isArray(overrides.features);
    const base: Partial<ConfigParams> = { ...defaultConfig };
    if (targetsIsObject) delete base.features;
    if (featuresIsObject) delete base.targets;
    return new Config({
      ...base,
      ...overrides,
    } as ConfigParams);
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

  describe("per-target features configuration", () => {
    it("should return all features when using array format with wildcard", () => {
      const config = createConfig({ features: ["*"] });
      const features = config.getFeatures();

      expect(features).toContain("rules");
      expect(features).toContain("ignore");
      expect(features).toContain("mcp");
      expect(features).toContain("commands");
      expect(features).toContain("subagents");
      expect(features).toContain("skills");
      expect(features).toContain("hooks");
    });

    it("should return target-specific features when using object format", () => {
      const config = createConfig({
        features: {
          copilot: ["commands"],
          agentsmd: ["rules", "mcp"],
        },
      });

      expect(config.getFeatures("copilot")).toEqual(["commands"]);
      expect(config.getFeatures("agentsmd")).toEqual(["rules", "mcp"]);
    });

    it("should return empty array for target not in per-target features", () => {
      const config = createConfig({
        features: {
          copilot: ["commands"],
        },
      });

      expect(config.getFeatures("cursor")).toEqual([]);
    });

    it("should handle wildcard in per-target features", () => {
      const config = createConfig({
        features: {
          copilot: ["*"],
          agentsmd: ["rules"],
        },
      });

      const copilotFeatures = config.getFeatures("copilot");
      expect(copilotFeatures).toContain("rules");
      expect(copilotFeatures).toContain("ignore");
      expect(copilotFeatures).toContain("mcp");
      expect(copilotFeatures).toContain("commands");
      expect(copilotFeatures).toContain("subagents");
      expect(copilotFeatures).toContain("skills");
      expect(copilotFeatures).toContain("hooks");

      expect(config.getFeatures("agentsmd")).toEqual(["rules"]);
    });

    it("should collect all unique features when calling getFeatures() without target in object mode", () => {
      const config = createConfig({
        features: {
          copilot: ["commands", "rules"],
          agentsmd: ["rules", "mcp"],
        },
      });

      const features = config.getFeatures();
      expect(features).toContain("commands");
      expect(features).toContain("rules");
      expect(features).toContain("mcp");
      expect(features).not.toContain("*");
    });

    it("should return all features when per-target has wildcard and getFeatures() is called without target", () => {
      const config = createConfig({
        features: {
          copilot: ["commands"],
          agentsmd: ["*"],
        },
      });

      const features = config.getFeatures();
      expect(features).toContain("rules");
      expect(features).toContain("ignore");
      expect(features).toContain("mcp");
      expect(features).toContain("commands");
      expect(features).toContain("subagents");
      expect(features).toContain("skills");
      expect(features).toContain("hooks");
    });

    it("should correctly identify per-target features configuration", () => {
      const arrayConfig = createConfig({ features: ["rules", "commands"] });
      expect(arrayConfig.hasPerTargetFeatures()).toBe(false);

      const objectConfig = createConfig({
        features: {
          copilot: ["commands"],
        },
      });
      expect(objectConfig.hasPerTargetFeatures()).toBe(true);
    });
  });

  describe("per-feature options object form", () => {
    it("should treat truthy per-feature values as enabled features", () => {
      const config = createConfig({
        features: {
          claudecode: {
            rules: true,
            ignore: { fileMode: "local" },
            mcp: false,
          },
        },
      });

      const features = config.getFeatures("claudecode");
      expect(features).toContain("rules");
      expect(features).toContain("ignore");
      expect(features).not.toContain("mcp");
    });

    it("should expose per-feature options via getFeatureOptions", () => {
      const config = createConfig({
        features: {
          claudecode: {
            ignore: { fileMode: "local" },
          },
        },
      });

      expect(config.getFeatureOptions("claudecode", "ignore")).toEqual({
        fileMode: "local",
      });
    });

    it("should return undefined for getFeatureOptions when feature is enabled with bare boolean", () => {
      const config = createConfig({
        features: {
          claudecode: { ignore: true },
        },
      });

      expect(config.getFeatureOptions("claudecode", "ignore")).toBeUndefined();
    });

    it("should return undefined for getFeatureOptions when features is array form", () => {
      const config = createConfig({
        targets: ["claudecode"],
        features: ["ignore"],
      });

      expect(config.getFeatureOptions("claudecode", "ignore")).toBeUndefined();
    });

    it("should expand wildcard inside per-feature object form", () => {
      const config = createConfig({
        features: {
          claudecode: { "*": true },
        },
      });

      const features = config.getFeatures("claudecode");
      expect(features).toContain("rules");
      expect(features).toContain("ignore");
      expect(features).toContain("mcp");
      expect(features).toContain("commands");
      expect(features).toContain("subagents");
      expect(features).toContain("skills");
      expect(features).toContain("hooks");
      expect(features).toContain("permissions");
      expect(features).toHaveLength(ALL_FEATURES.length);
    });

    it("should return undefined for getFeatureOptions when wildcard enables all features", () => {
      const config = createConfig({
        features: {
          claudecode: { "*": true },
        },
      });

      // Wildcard `true` is a boolean, not an options object, so individual
      // features should not inherit options from it.
      expect(config.getFeatureOptions("claudecode", "ignore")).toBeUndefined();
      expect(config.getFeatureOptions("claudecode", "rules")).toBeUndefined();
    });

    it("should return specific options even when wildcard is also present", () => {
      const config = createConfig({
        features: {
          claudecode: {
            "*": true,
            ignore: { fileMode: "local" },
          },
        },
      });

      // Explicitly provided options should still be returned
      expect(config.getFeatureOptions("claudecode", "ignore")).toEqual({
        fileMode: "local",
      });
      // Other features enabled via wildcard have no options
      expect(config.getFeatureOptions("claudecode", "rules")).toBeUndefined();
    });
  });

  describe("gitignoreTargetsOnly", () => {
    it("should default to true when not specified", () => {
      const config = createConfig();
      expect(config.getGitignoreTargetsOnly()).toBe(true);
    });

    it("should respect an explicit false value", () => {
      const config = createConfig({ gitignoreTargetsOnly: false });
      expect(config.getGitignoreTargetsOnly()).toBe(false);
    });

    it("should respect an explicit true value", () => {
      const config = createConfig({ gitignoreTargetsOnly: true });
      expect(config.getGitignoreTargetsOnly()).toBe(true);
    });
  });

  describe("getGitignoreDestination", () => {
    it("defaults to gitignore", () => {
      const config = createConfig({
        targets: {
          claudecode: ["rules"],
        },
      });
      expect(config.getGitignoreDestination("claudecode", "rules")).toBe("gitignore");
    });

    it("supports tool-level destination", () => {
      const config = createConfig({
        targets: {
          claudecode: {
            gitignoreDestination: "gitattributes",
            rules: true,
          },
        },
      });
      expect(config.getGitignoreDestination("claudecode", "rules")).toBe("gitattributes");
    });

    it("prefers feature-level destination over tool-level destination", () => {
      const config = createConfig({
        targets: {
          claudecode: {
            gitignoreDestination: "gitignore",
            rules: { gitignoreDestination: "gitattributes" },
          },
        },
      });
      expect(config.getGitignoreDestination("claudecode", "rules")).toBe("gitattributes");
    });

    it("supports root-level destination", () => {
      const config = createConfig({
        gitignoreDestination: "gitattributes",
      });
      expect(config.getGitignoreDestination("claudecode", "rules")).toBe("gitattributes");
    });

    it("prefers tool-level destination over root-level destination", () => {
      const config = createConfig({
        gitignoreDestination: "gitignore",
        targets: {
          claudecode: {
            gitignoreDestination: "gitattributes",
            rules: true,
          },
        },
      });
      expect(config.getGitignoreDestination("claudecode", "rules")).toBe("gitattributes");
    });
  });

  describe("object-form targets (per-target configuration)", () => {
    it("should derive target list from targets object keys", () => {
      const config = createConfig({
        targets: {
          claudecode: ["rules", "commands"],
          cursor: ["rules"],
        },
      });

      expect(config.getTargets()).toEqual(["claudecode", "cursor"]);
    });

    it("should return per-target features from targets object values", () => {
      const config = createConfig({
        targets: {
          claudecode: ["rules", "commands"],
          cursor: ["rules", "mcp"],
        },
      });

      expect(config.getFeatures("claudecode")).toEqual(["rules", "commands"]);
      expect(config.getFeatures("cursor")).toEqual(["rules", "mcp"]);
    });

    it("should return per-feature options from targets object", () => {
      const config = createConfig({
        targets: {
          claudecode: {
            rules: true,
            ignore: { fileMode: "local" },
          },
        },
      });

      expect(config.getFeatures("claudecode")).toEqual(["rules", "ignore"]);
      expect(config.getFeatureOptions("claudecode", "ignore")).toEqual({ fileMode: "local" });
      expect(config.getFeatureOptions("claudecode", "rules")).toBeUndefined();
    });

    it("should expand wildcard inside targets object value", () => {
      const config = createConfig({
        targets: {
          claudecode: ["*"],
          cursor: ["rules"],
        },
      });

      const claudeFeatures = config.getFeatures("claudecode");
      expect(claudeFeatures).toHaveLength(ALL_FEATURES.length);
      expect(config.getFeatures("cursor")).toEqual(["rules"]);
    });

    it("should return empty array for target not present in targets object", () => {
      const config = createConfig({
        targets: {
          claudecode: ["rules"],
        },
      });

      expect(config.getFeatures("cursor")).toEqual([]);
    });

    it("should collect all unique features across targets object", () => {
      const config = createConfig({
        targets: {
          claudecode: ["rules", "commands"],
          cursor: ["rules", "mcp"],
        },
      });

      const features = config.getFeatures();
      expect(features).toContain("rules");
      expect(features).toContain("commands");
      expect(features).toContain("mcp");
      expect(features).not.toContain("*");
    });

    it("should report hasPerTargetFeatures true for object-form targets", () => {
      const config = createConfig({
        targets: { claudecode: ["rules"] },
      });
      expect(config.hasPerTargetFeatures()).toBe(true);
      expect(config.hasDeprecatedFeaturesObjectForm()).toBe(false);
    });

    it("should detect conflicting targets within the object form keys", () => {
      expect(() =>
        createConfig({
          targets: {
            claudecode: ["rules"],
            "claudecode-legacy": ["rules"],
          },
        }),
      ).toThrow(
        "Conflicting targets: 'claudecode' and 'claudecode-legacy' cannot be used together. Please choose one.",
      );
    });

    it("should reject '*' as a key in object-form targets", () => {
      expect(() =>
        createConfig({
          targets: { "*": ["rules"] } as unknown as ConfigParams["targets"],
        }),
      ).toThrow(/wildcard is only supported in the array form/);
    });

    it("should reject unknown target keys in the object form", () => {
      expect(
        () =>
          createConfig({
            // cspell:disable-next-line
            targets: { cloudecode: ["rules"] } as unknown as ConfigParams["targets"],
          }),
        // cspell:disable-next-line
      ).toThrow(/Unknown target 'cloudecode'/);
    });

    it("should reject object-form targets combined with any features (constructor-level guard)", () => {
      // The helper only strips the *default* when an object form is detected,
      // so an explicit `features` override still reaches the Config constructor.
      expect(() =>
        createConfig({
          targets: { claudecode: ["rules"] },
          features: ["rules"],
        }),
      ).toThrow(/when 'targets' is in object form, 'features' must be omitted/);
    });
  });

  describe("assertTargetsFeaturesExclusive (schema-level mutual exclusivity)", () => {
    it("rejects object-form targets combined with array-form features", () => {
      expect(() =>
        assertTargetsFeaturesExclusive({
          targets: { claudecode: ["rules"] },
          features: ["rules"],
        }),
      ).toThrow(/when 'targets' is in object form, 'features' must be omitted/);
    });

    it("rejects object-form targets combined with object-form features", () => {
      expect(() =>
        assertTargetsFeaturesExclusive({
          targets: { claudecode: ["rules"] },
          features: { claudecode: ["rules"] },
        }),
      ).toThrow(/when 'targets' is in object form, 'features' must be omitted/);
    });

    it("rejects object-form features combined with array-form targets", () => {
      expect(() =>
        assertTargetsFeaturesExclusive({
          targets: ["claudecode"],
          features: { claudecode: ["rules"] },
        }),
      ).toThrow(/when 'features' is in object form, 'targets' must be omitted/);
    });

    it("accepts object-form targets alone", () => {
      expect(() =>
        assertTargetsFeaturesExclusive({
          targets: { claudecode: ["rules"] },
        }),
      ).not.toThrow();
    });

    it("accepts object-form features alone (still supported, deprecated)", () => {
      expect(() =>
        assertTargetsFeaturesExclusive({
          features: { claudecode: ["rules"] },
        }),
      ).not.toThrow();
    });

    it("accepts array-form targets with array-form features", () => {
      expect(() =>
        assertTargetsFeaturesExclusive({
          targets: ["claudecode"],
          features: ["rules"],
        }),
      ).not.toThrow();
    });
  });

  describe("constructor-level guard for missing targets and features", () => {
    it("should throw when both 'targets' and 'features' are undefined", () => {
      expect(
        () =>
          new Config({
            baseDirs: ["."],
            verbose: false,
            delete: false,
            silent: false,
          } as unknown as ConfigParams),
      ).toThrow(/at least one of 'targets' or 'features' must be provided/);
    });
  });

  describe("getInputRoot", () => {
    let originalCwd: string;

    beforeEach(() => {
      originalCwd = process.cwd();
    });

    afterEach(() => {
      process.chdir(originalCwd);
    });

    it("snapshots process.cwd() at construction time when no inputRoot is supplied", () => {
      const config = createConfig({});
      const snapshot = config.getInputRoot();
      expect(isAbsolute(snapshot)).toBe(true);
      expect(snapshot).toBe(originalCwd);
      // Subsequent chdir calls must not affect the captured value.
      // process.chdir to the parent directory which should always exist.
      const parent = resolve(originalCwd, "..");
      process.chdir(parent);
      expect(config.getInputRoot()).toBe(snapshot);
    });

    it("preserves an absolute inputRoot exactly as supplied", () => {
      const absolute = resolve(originalCwd, "some-absolute-path");
      const config = createConfig({ inputRoot: absolute });
      expect(config.getInputRoot()).toBe(absolute);
    });

    it("resolves a relative inputRoot to absolute against the construction-time cwd", () => {
      const config = createConfig({ inputRoot: "./central-rules" });
      const expected = resolve(originalCwd, "central-rules");
      expect(config.getInputRoot()).toBe(expected);
      expect(isAbsolute(config.getInputRoot())).toBe(true);
      // Later chdir must not change the captured value.
      const parent = resolve(originalCwd, "..");
      process.chdir(parent);
      expect(config.getInputRoot()).toBe(expected);
    });
  });
});

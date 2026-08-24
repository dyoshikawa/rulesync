import { isAbsolute, join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RULESYNC_CONFIG_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { ALL_FEATURES } from "../types/features.js";
import { ALL_TOOL_TARGETS } from "../types/tool-targets.js";
import {
  assertTargetsFeaturesExclusive,
  Config,
  ConfigFileSchema,
  type ConfigParams,
} from "./config.js";

const parseSources = (sources: unknown[]) =>
  ConfigFileSchema.safeParse({ targets: ["cursor"], sources });

describe("Config", () => {
  const defaultConfig: ConfigParams = {
    outputRoots: ["."],
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
    it("should exclude legacy and packaging targets when wildcard is used", () => {
      const config = createConfig({ targets: ["*"] });
      const targets = config.getTargets();

      expect(targets).not.toContain("claudecode-legacy");
      expect(targets).not.toContain("augmentcode-legacy");
      expect(targets).not.toContain("claudecode-plugin");
      expect(targets).not.toContain("antigravity-plugin");
      expect(targets).toContain("claudecode");
      expect(targets).toContain("augmentcode");
    });

    it("should include all non-legacy, non-packaging targets when wildcard is used", () => {
      const config = createConfig({ targets: ["*"] });
      const targets = config.getTargets();

      const expectedTargets = ALL_TOOL_TARGETS.filter(
        (t) =>
          t !== "claudecode-legacy" &&
          t !== "augmentcode-legacy" &&
          t !== "claudecode-plugin" &&
          t !== "antigravity-plugin",
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

    it("should preserve packaging targets explicitly listed with wildcard", () => {
      const config = createConfig({
        targets: ["*", "claudecode-plugin", "antigravity-plugin"],
      });
      const targets = config.getTargets();

      expect(targets).toContain("claudecode-plugin");
      expect(targets).toContain("antigravity-plugin");
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

    it("accepts object-form targets alone", () => {
      expect(() =>
        assertTargetsFeaturesExclusive({
          targets: { claudecode: ["rules"] },
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
            outputRoots: ["."],
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

    it("snapshots join(process.cwd(), '.rulesync') at construction time when no inputRoot/inputRoots is supplied", () => {
      const config = createConfig({});
      const [snapshot, ...rest] = config.getInputRoots();
      expect(rest).toHaveLength(0);
      expect(isAbsolute(snapshot)).toBe(true);
      expect(snapshot).toBe(resolve(originalCwd, ".rulesync"));
      // Subsequent chdir calls must not affect the captured value.
      // process.chdir to the parent directory which should always exist.
      const parent = resolve(originalCwd, "..");
      process.chdir(parent);
      expect(config.getInputRoots()[0]).toBe(snapshot);
    });

    it("expands an absolute inputRoot to `[join(inputRoot, '.rulesync')]`", () => {
      const absolute = resolve(originalCwd, "some-absolute-path");
      const config = createConfig({ inputRoot: absolute });
      expect(config.getInputRoots()).toEqual([resolve(absolute, ".rulesync")]);
    });

    it("resolves a relative inputRoot to absolute against the construction-time cwd and appends '.rulesync'", () => {
      const config = createConfig({ inputRoot: "./central-rules" });
      const expected = resolve(originalCwd, "central-rules", ".rulesync");
      expect(config.getInputRoots()).toEqual([expected]);
      expect(isAbsolute(config.getInputRoots()[0])).toBe(true);
      // Later chdir must not change the captured value.
      const parent = resolve(originalCwd, "..");
      process.chdir(parent);
      expect(config.getInputRoots()[0]).toBe(expected);
    });
  });

  describe("getInputRoots (multi-root)", () => {
    let originalCwd: string;

    beforeEach(() => {
      originalCwd = process.cwd();
    });

    afterEach(() => {
      process.chdir(originalCwd);
    });

    it("normalizes every entry of `inputRoots` to absolute at construction time", () => {
      const absolute = resolve(originalCwd, "central");
      const config = createConfig({ inputRoots: [absolute, "./overlay"] });
      expect(config.getInputRoots()).toEqual([absolute, resolve(originalCwd, "overlay")]);
    });

    it("rejects an explicitly empty inputRoots list", () => {
      expect(() => createConfig({ inputRoots: [] })).toThrow(/'inputRoots' must be non-empty/);
    });

    it("prefers `inputRoots` over `inputRoot` when both are supplied to the constructor", () => {
      expect(() => createConfig({ inputRoot: "/base", inputRoots: ["/base", "/overlay"] })).toThrow(
        /cannot be combined/,
      );
    });

    it("returns the same absolute list even after chdir'ing away from the construction cwd", () => {
      const config = createConfig({ inputRoots: ["./central", "./overlay"] });
      const snapshot = [...config.getInputRoots()];
      const parent = resolve(originalCwd, "..");
      process.chdir(parent);
      expect([...config.getInputRoots()]).toEqual(snapshot);
    });
  });

  describe("getConfigFilePath", () => {
    it("keeps the absolute path supplied by the resolver", () => {
      const configFilePath = resolve(process.cwd(), "packages", "app", "rulesync.jsonc");
      const config = createConfig({ configFilePath });
      expect(config.getConfigFilePath()).toBe(configFilePath);
    });

    it("falls back to the conventional location next to the input root", () => {
      const inputRoot = resolve(process.cwd(), "central-rules");
      const config = createConfig({ inputRoot });
      expect(config.getConfigFilePath()).toBe(join(inputRoot, RULESYNC_CONFIG_RELATIVE_FILE_PATH));
    });

    it("resolves a relative path to absolute", () => {
      const config = createConfig({ configFilePath: "./nested/rulesync.jsonc" });
      expect(config.getConfigFilePath()).toBe(resolve(process.cwd(), "nested/rulesync.jsonc"));
    });
  });

  describe("source entry schema (npm transport)", () => {
    it("accepts an npm source with registry and tokenEnv", () => {
      const result = parseSources([
        {
          source: "@acme/skills",
          transport: "npm",
          registry: "https://acme.jfrog.io/artifactory/api/npm/npm-local/",
          tokenEnv: "ACME_REGISTRY_TOKEN",
        },
      ]);
      expect(result.success).toBe(true);
    });

    it("accepts an npm source without registry (defaults to npmjs.org)", () => {
      const result = parseSources([{ source: "my-skill-package", transport: "npm" }]);
      expect(result.success).toBe(true);
    });

    it("rejects registry and tokenEnv without the npm transport", () => {
      expect(
        parseSources([{ source: "owner/repo", registry: "https://registry.example.com" }]).success,
      ).toBe(false);
      expect(
        parseSources([{ source: "owner/repo", transport: "git", tokenEnv: "NPM_TOKEN" }]).success,
      ).toBe(false);
    });

    it("rejects a non-http(s) registry URL", () => {
      const result = parseSources([
        { source: "pkg", transport: "npm", registry: "ftp://registry.example.com" },
      ]);
      expect(result.success).toBe(false);
    });

    it("rejects an invalid tokenEnv name", () => {
      const result = parseSources([
        { source: "pkg", transport: "npm", tokenEnv: "not a var; rm -rf" },
      ]);
      expect(result.success).toBe(false);
    });
  });

  describe("source entry rule filtering", () => {
    it("accepts rule filters and an independent rules path", () => {
      const result = parseSources([
        {
          source: "owner/repo",
          skills: ["skill-creator"],
          rules: ["testing-guidelines"],
          path: "exports/skills",
          rulesPath: "exports/rules",
        },
      ]);

      expect(result.success).toBe(true);
    });

    it("rejects unsafe rules paths", () => {
      expect(parseSources([{ source: "owner/repo", rulesPath: "../rules" }]).success).toBe(false);
      expect(parseSources([{ source: "owner/repo", rulesPath: "/rules" }]).success).toBe(false);
    });
  });
});

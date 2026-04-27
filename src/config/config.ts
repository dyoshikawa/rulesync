import { isAbsolute } from "node:path";

import { minLength, optional, refine, z } from "zod/mini";

import {
  ALL_FEATURES,
  Feature,
  FeatureOptions,
  Features,
  GitignoreDestination,
  GitignoreDestinationSchema,
  isFeatureValueEnabled,
  PerFeatureConfig,
  PerTargetFeatures,
  PerTargetFeaturesValue,
  RulesyncFeatures,
  RulesyncFeaturesSchema,
} from "../types/features.js";
import {
  ALL_TOOL_TARGETS,
  isRulesyncConfigTargetsObject,
  RulesyncConfigTargets,
  RulesyncConfigTargetsObject,
  RulesyncConfigTargetsSchema,
  RulesyncTargets,
  ToolTarget,
  ToolTargets,
} from "../types/tool-targets.js";
import { hasControlCharacters } from "../utils/validation.js";

export const GITIGNORE_DESTINATION_KEY = "gitignoreDestination";

/**
 * Schema for a single source entry in the sources array.
 * Declares an external repository from which skills can be fetched.
 */
export const SourceEntrySchema = z.object({
  source: z.string().check(minLength(1, "source must be a non-empty string")),
  skills: optional(z.array(z.string())),
  transport: optional(z.enum(["github", "git"])),
  ref: optional(
    z.string().check(
      refine((v) => !v.startsWith("-"), 'ref must not start with "-"'),
      refine((v) => !hasControlCharacters(v), "ref must not contain control characters"),
    ),
  ),
  path: optional(
    z.string().check(
      refine((v) => !v.includes(".."), 'path must not contain ".."'),
      refine((v) => !isAbsolute(v), "path must not be absolute"),
      refine((v) => !hasControlCharacters(v), "path must not contain control characters"),
    ),
  ),
  // gh-mode-only fields. Ignored by --mode rulesync. Defaults applied at the
  // gh install site (`agent` defaults to "github-copilot", `scope` to "project").
  agent: optional(
    z.enum(["github-copilot", "claude-code", "cursor", "codex", "gemini", "antigravity"]),
  ),
  scope: optional(z.enum(["project", "user"])),
});
export type SourceEntry = z.infer<typeof SourceEntrySchema>;

export const ConfigParamsSchema = z.object({
  baseDirs: z.array(z.string()),
  targets: RulesyncConfigTargetsSchema,
  features: RulesyncFeaturesSchema,
  verbose: z.boolean(),
  delete: z.boolean(),
  // New non-experimental options
  global: optional(z.boolean()),
  silent: optional(z.boolean()),
  simulateCommands: optional(z.boolean()),
  simulateSubagents: optional(z.boolean()),
  simulateSkills: optional(z.boolean()),
  gitignoreTargetsOnly: optional(z.boolean()),
  gitignoreDestination: optional(GitignoreDestinationSchema),
  dryRun: optional(z.boolean()),
  check: optional(z.boolean()),
  inputRoot: optional(z.string()),
  // Declarative skill sources
  sources: optional(z.array(SourceEntrySchema)),
});
// We override the inferred `targets` / `features` types with the hand-written
// unions so that callers can supply a partial per-target / per-feature object
// literal without TS demanding every key be present. At runtime the zod
// schema still accepts the same shapes — `z.record` allows missing keys —
// but the inferred TS type is non-partial.
//
// `targets` and `features` are made optional here because the two fields are
// mutually-exclusive when either is in object form (see
// `assertTargetsFeaturesExclusive`): callers that set one in object form must
// leave the other undefined, so both fields must be representable as absent
// at the type level.
//
// Note: we could have expressed the mutual-exclusivity at the type level via
// a discriminated union, but that would ripple into every `ConfigParams`
// consumer (CLI option types, resolver internals, tests) and complicate
// merge-style code paths in `ConfigResolver` that treat `targets`/`features`
// uniformly. Instead we keep the uniform optional shape and enforce the
// invariant at runtime via `assertTargetsFeaturesExclusive` +
// `assertTargetsOrFeaturesProvided`. Programmatic callers constructing
// `Config` directly must respect these invariants.
type InferredConfigParams = z.infer<typeof ConfigParamsSchema>;
export type ConfigParams = Omit<InferredConfigParams, "targets" | "features"> & {
  targets?: RulesyncConfigTargets;
  features?: RulesyncFeatures;
};

export const PartialConfigParamsSchema = z.partial(ConfigParamsSchema);
type InferredPartialConfigParams = z.infer<typeof PartialConfigParamsSchema>;
export type PartialConfigParams = Omit<InferredPartialConfigParams, "targets" | "features"> & {
  targets?: RulesyncConfigTargets;
  features?: RulesyncFeatures;
};

// Schema for config file that includes $schema property for editor support
export const ConfigFileSchema = z.object({
  $schema: optional(z.string()),
  ...z.partial(ConfigParamsSchema).shape,
});
type InferredConfigFile = z.infer<typeof ConfigFileSchema>;
export type ConfigFile = Omit<InferredConfigFile, "targets" | "features"> & {
  targets?: RulesyncConfigTargets;
  features?: RulesyncFeatures;
};

export const RequiredConfigParamsSchema = z.required(ConfigParamsSchema);
type InferredRequiredConfigParams = z.infer<typeof RequiredConfigParamsSchema>;
export type RequiredConfigParams = Omit<InferredRequiredConfigParams, "targets" | "features"> & {
  targets?: RulesyncConfigTargets;
  features?: RulesyncFeatures;
};

/**
 * Conflicting target pairs that cannot be used together
 */
const CONFLICTING_TARGET_PAIRS: Array<[string, string]> = [
  ["augmentcode", "augmentcode-legacy"],
  ["claudecode", "claudecode-legacy"],
];

/**
 * Legacy targets that should NOT be included in wildcard (*) expansion.
 * These targets must be explicitly specified.
 */
const LEGACY_TARGETS = ["augmentcode-legacy", "claudecode-legacy"] as const;

/**
 * Validates that the user-authored config does not double-define the
 * target set in both `targets` and `features` object forms.
 *
 * Rules:
 * - If `targets` is in object form, `features` must be omitted.
 * - If `features` is in object form, `targets` must be omitted.
 *
 * This is called on *user-authored* config (a file load or an explicit
 * programmatic construction) before defaults are merged in — the defaults
 * only ever use the array forms, so they cannot trigger a false positive.
 *
 * Throws with a message naming the field to remove.
 */
export const assertTargetsFeaturesExclusive = ({
  targets,
  features,
}: {
  targets?: RulesyncConfigTargets;
  features?: RulesyncFeatures;
}): void => {
  const targetsIsObject = targets !== undefined && !Array.isArray(targets);
  const featuresIsObject = features !== undefined && !Array.isArray(features);

  if (targetsIsObject && features !== undefined) {
    throw new Error(
      "Invalid config: when 'targets' is in object form, 'features' must be omitted. " +
        "Declare per-target features inside the 'targets' object instead.",
    );
  }
  if (featuresIsObject && targets !== undefined) {
    throw new Error(
      "Invalid config: when 'features' is in object form, 'targets' must be omitted. " +
        "Migrate to the 'targets' object form, e.g. `targets: { claudecode: [...] }`.",
    );
  }
};

/**
 * Normalizes a post-resolution `ConfigParams` input by rejecting the case
 * where both `targets` and `features` are undefined — a degenerate state
 * that would silently produce a no-op config (no targets, no features).
 *
 * Defaults applied by `ConfigResolver` always supply at least one of the
 * two, so this guard only fires for programmatic `new Config(...)` callers
 * that forgot to pass either field.
 */
const assertTargetsOrFeaturesProvided = ({
  targets,
  features,
}: {
  targets?: RulesyncConfigTargets;
  features?: RulesyncFeatures;
}): void => {
  if (targets === undefined && features === undefined) {
    throw new Error("Invalid config: at least one of 'targets' or 'features' must be provided.");
  }
};

export class Config {
  private readonly baseDirs: string[];
  private readonly targets: RulesyncConfigTargets;
  private readonly features: RulesyncFeatures;
  /**
   * Cached list of validated `ToolTarget` keys for the object form of
   * `targets`. Populated in the constructor after `validateObjectFormTargetKeys`
   * so `getTargets()` does not rebuild the `ALL_TOOL_TARGETS` set on every call.
   * Undefined when `this.targets` is in array form.
   */
  private readonly objectFormTargetKeys: ToolTarget[] | undefined;
  private readonly verbose: boolean;
  private readonly delete: boolean;
  private readonly global: boolean;
  private readonly silent: boolean;
  private readonly simulateCommands: boolean;
  private readonly simulateSubagents: boolean;
  private readonly simulateSkills: boolean;
  private readonly gitignoreTargetsOnly: boolean;
  private readonly gitignoreDestination: GitignoreDestination;
  private readonly dryRun: boolean;
  private readonly check: boolean;
  private readonly inputRoot: string | undefined;
  private readonly sources: SourceEntry[];

  constructor({
    baseDirs,
    targets,
    features,
    verbose,
    delete: isDelete,
    global,
    silent,
    simulateCommands,
    simulateSubagents,
    simulateSkills,
    gitignoreTargetsOnly,
    gitignoreDestination,
    dryRun,
    check,
    inputRoot,
    sources,
  }: ConfigParams) {
    // Defense-in-depth: enforce the same mutual-exclusivity rule that the
    // file loader applies, so programmatic `new Config(...)` callers can't
    // silently enter the double-defined state. `assertTargetsFeaturesExclusive`
    // is safe to run twice on file-loader inputs — the check is idempotent.
    assertTargetsFeaturesExclusive({ targets, features });
    // Reject the degenerate "both undefined" state so `new Config(...)` callers
    // can't accidentally produce a no-op config. Defaults in `ConfigResolver`
    // always populate at least one side, so this only fires for programmatic
    // construction paths.
    assertTargetsOrFeaturesProvided({ targets, features });

    // Note: the deprecation warning for the object form under `features` is
    // emitted once by `ConfigResolver` after merging configs. We intentionally
    // do NOT emit it from the constructor to avoid surprise logs in tests or
    // programmatic callers that construct `Config` directly; callers wanting
    // the warning should go through `ConfigResolver.resolve`.

    const resolvedTargets: RulesyncConfigTargets = targets ?? [];
    const resolvedFeatures: RulesyncFeatures = features ?? [];

    // Reject unknown keys in the object form of `targets`. Array-form values
    // are already validated at the Zod schema level.
    this.validateObjectFormTargetKeys(resolvedTargets);

    // Validate conflicting targets (accepts array and object forms)
    this.validateConflictingTargets(resolvedTargets);

    // Validate --dry-run and --check are mutually exclusive
    if (dryRun && check) {
      throw new Error("--dry-run and --check cannot be used together");
    }

    this.baseDirs = baseDirs;
    this.targets = resolvedTargets;
    this.features = resolvedFeatures;
    this.objectFormTargetKeys = isRulesyncConfigTargetsObject(resolvedTargets)
      ? Config.filterValidToolTargets(Object.keys(resolvedTargets))
      : undefined;
    this.verbose = verbose;
    this.delete = isDelete;

    this.global = global ?? false;
    this.silent = silent ?? false;
    this.simulateCommands = simulateCommands ?? false;
    this.simulateSubagents = simulateSubagents ?? false;
    this.simulateSkills = simulateSkills ?? false;
    this.gitignoreTargetsOnly = gitignoreTargetsOnly ?? true;
    this.gitignoreDestination = gitignoreDestination ?? "gitignore";
    this.dryRun = dryRun ?? false;
    this.check = check ?? false;
    this.inputRoot = inputRoot;
    this.sources = sources ?? [];
  }

  /**
   * Rejects unknown keys (and the special `*` key) in the object form of
   * `targets`. For the array form this is already enforced at the Zod schema
   * level via `z.enum(ALL_TOOL_TARGETS_WITH_WILDCARD)`; for the object form
   * `z.record(z.string(), ...)` intentionally accepts any string key (to work
   * around zod's `z.record(z.enum(...))` requiring ALL enum members), so
   * runtime validation lives here instead.
   */
  private validateObjectFormTargetKeys(targets: RulesyncConfigTargets): void {
    if (Array.isArray(targets)) return;
    const validTargets = new Set<string>(ALL_TOOL_TARGETS);
    for (const key of Object.keys(targets)) {
      if (key === "*") {
        throw new Error(
          "Invalid target '*' in object form: wildcard is only supported in the " +
            "array form `targets: ['*']`. Per-target options cannot be attached to a wildcard.",
        );
      }
      if (!validTargets.has(key)) {
        throw new Error(`Unknown target '${key}'. Valid targets: ${ALL_TOOL_TARGETS.join(", ")}.`);
      }
    }
  }

  private validateConflictingTargets(targets: RulesyncConfigTargets): void {
    // Wildcard (*) doesn't include legacy targets, so conflicts can only
    // occur when both sides of a conflicting pair are explicitly present.
    // For the object form this means "both keys are present"; for the
    // array form this means "both values are present".
    const has = (target: string): boolean => {
      if (Array.isArray(targets)) {
        // eslint-disable-next-line no-type-assertion/no-type-assertion
        return targets.includes(target as RulesyncTargets[number]);
      }
      return Object.prototype.hasOwnProperty.call(targets, target);
    };
    for (const [target1, target2] of CONFLICTING_TARGET_PAIRS) {
      if (has(target1) && has(target2)) {
        throw new Error(
          `Conflicting targets: '${target1}' and '${target2}' cannot be used together. Please choose one.`,
        );
      }
    }
  }

  public getBaseDirs(): string[] {
    return this.baseDirs;
  }

  /**
   * Filter an arbitrary string-key list down to the known `ToolTarget` set,
   * skipping `*` (which is only meaningful as an array element, not a key).
   */
  private static filterValidToolTargets(keys: Iterable<string>): ToolTarget[] {
    const validTargets = new Set<string>(ALL_TOOL_TARGETS);
    const result: ToolTarget[] = [];
    for (const key of keys) {
      if (key === "*") continue;
      if (!validTargets.has(key)) continue;
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      result.push(key as ToolTarget);
    }
    return result;
  }

  public getTargets(): ToolTargets {
    // Object form on `targets`: the validated key list was cached in the
    // constructor, so this returns the pre-computed array without re-scanning.
    if (this.objectFormTargetKeys !== undefined) {
      return this.objectFormTargetKeys;
    }

    // At this point `this.targets` is narrowed to the array form (the
    // object form was handled above).
    const arrayTargets: RulesyncTargets = Array.isArray(this.targets) ? this.targets : [];

    // Object form on `features` (legacy / deprecated path): derive the
    // target list from the `features` object keys. `assertTargetsFeaturesExclusive`
    // guarantees that when `features` is an object, the user cannot also have
    // provided `targets`, so there is no intersection to compute here.
    if (!Array.isArray(this.features)) {
      return Config.filterValidToolTargets(Object.keys(this.features));
    }

    if (arrayTargets.includes("*")) {
      // Exclude legacy targets from wildcard expansion
      // Legacy targets must be explicitly specified
      return ALL_TOOL_TARGETS.filter(
        // eslint-disable-next-line no-type-assertion/no-type-assertion
        (target) => !LEGACY_TARGETS.includes(target as (typeof LEGACY_TARGETS)[number]),
      );
    }

    return arrayTargets.filter((target): target is ToolTarget => target !== "*");
  }

  public getFeatures(): Features;
  public getFeatures(target: ToolTarget): Features;
  public getFeatures(target?: ToolTarget): Features {
    // New object form on `targets`: per-target features come from the
    // targets object values.
    if (isRulesyncConfigTargetsObject(this.targets)) {
      if (target) {
        const value = this.targets[target];
        if (!value) return [];
        return Config.normalizeTargetFeatures(value);
      }
      return Config.collectAllFeatures(Object.values(this.targets));
    }

    // Legacy object form on `features` (deprecated).
    if (!Array.isArray(this.features)) {
      const perTargetFeatures: PerTargetFeatures = this.features;
      if (target) {
        const targetFeatures = perTargetFeatures[target];
        if (!targetFeatures) {
          return [];
        }
        return Config.normalizeTargetFeatures(targetFeatures);
      }
      return Config.collectAllFeatures(Object.values(perTargetFeatures));
    }

    // Array format - traditional behavior
    if (this.features.includes("*")) {
      return [...ALL_FEATURES];
    }

    return this.features.filter((feature): feature is Feature => feature !== "*");
  }

  /**
   * Normalize a per-target features value (array or per-feature object) into
   * the flat list of enabled features.
   */
  private static normalizeTargetFeatures(value: PerTargetFeaturesValue): Features {
    if (Array.isArray(value)) {
      if (value.length === 0) return [];
      if (value.includes("*")) return [...ALL_FEATURES];
      return value.filter((feature): feature is Feature => feature !== "*");
    }
    // Per-feature object form: keys with truthy values are enabled.
    if (isFeatureValueEnabled(value["*"])) {
      return [...ALL_FEATURES];
    }
    const enabled: Feature[] = [];
    for (const [key, val] of Object.entries(value)) {
      if (key === "*") continue;
      if (!isFeatureValueEnabled(val)) continue;
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      enabled.push(key as Feature);
    }
    return enabled;
  }

  /**
   * Collect the union of features across all per-target values.
   * Used when `getFeatures()` is called without a target in object mode.
   */
  private static collectAllFeatures(
    values: Iterable<PerTargetFeaturesValue | undefined>,
  ): Features {
    const allFeatures: Feature[] = [];
    for (const value of values) {
      if (!value) continue;
      const normalized = Config.normalizeTargetFeatures(value);
      for (const feature of normalized) {
        if (!allFeatures.includes(feature)) {
          allFeatures.push(feature);
        }
      }
      if (allFeatures.length === ALL_FEATURES.length) {
        return allFeatures;
      }
    }
    return allFeatures;
  }

  /**
   * Returns the per-feature options object for a given target/feature, if any.
   * Returns `undefined` when no per-feature options were provided or when the
   * feature is not enabled for the given target.
   */
  public getFeatureOptions(target: ToolTarget, feature: Feature): FeatureOptions | undefined {
    const value = isRulesyncConfigTargetsObject(this.targets)
      ? this.targets[target]
      : !Array.isArray(this.features)
        ? this.features[target]
        : undefined;
    if (!value || Array.isArray(value)) {
      return undefined;
    }
    const perFeature: PerFeatureConfig = value;
    const featureValue = perFeature[feature];
    if (featureValue && typeof featureValue === "object" && isFeatureValueEnabled(featureValue)) {
      return featureValue;
    }
    return undefined;
  }

  public getGitignoreDestination(target: ToolTarget, feature?: Feature): GitignoreDestination {
    const rootLevel = this.gitignoreDestination;
    if (!isRulesyncConfigTargetsObject(this.targets)) {
      return rootLevel;
    }
    const targetValue = this.targets[target];
    if (!targetValue || Array.isArray(targetValue)) {
      return rootLevel;
    }

    const perFeature: PerFeatureConfig = targetValue;
    const toolLevel = Config.parseGitignoreDestination(perFeature[GITIGNORE_DESTINATION_KEY]);
    if (feature) {
      const featureValue = perFeature[feature];
      if (featureValue && typeof featureValue === "object" && !Array.isArray(featureValue)) {
        const featureLevel = Config.parseGitignoreDestination(
          featureValue[GITIGNORE_DESTINATION_KEY],
        );
        if (featureLevel) {
          return featureLevel;
        }
      }
    }
    return toolLevel ?? rootLevel;
  }

  private static parseGitignoreDestination(value: unknown): GitignoreDestination | undefined {
    if (value === "gitignore" || value === "gitattributes") {
      return value;
    }
    return undefined;
  }

  /**
   * Check if per-target features configuration is being used.
   */
  public hasPerTargetFeatures(): boolean {
    return isRulesyncConfigTargetsObject(this.targets) || !Array.isArray(this.features);
  }

  /**
   * Returns true if the deprecated object form under `features` is in use.
   * Callers can use this to emit a migration warning.
   */
  public hasDeprecatedFeaturesObjectForm(): boolean {
    return !Array.isArray(this.features);
  }

  public getVerbose(): boolean {
    return this.verbose;
  }

  public getDelete(): boolean {
    return this.delete;
  }

  public getGlobal(): boolean {
    return this.global;
  }

  public getSilent(): boolean {
    return this.silent;
  }

  public getSimulateCommands(): boolean {
    return this.simulateCommands;
  }

  public getSimulateSubagents(): boolean {
    return this.simulateSubagents;
  }

  public getSimulateSkills(): boolean {
    return this.simulateSkills;
  }

  public getGitignoreTargetsOnly(): boolean {
    return this.gitignoreTargetsOnly;
  }

  public getDryRun(): boolean {
    return this.dryRun;
  }

  public getCheck(): boolean {
    return this.check;
  }

  /**
   * Returns the directory containing the `.rulesync/` source files. The value
   * is always an absolute path captured at config-construction time, so this
   * accessor is pure and never depends on a live `process.cwd()` read.
   *
   * `ConfigResolver` defaults this to the captured CWD when no `inputRoot`
   * was supplied; programmatic callers constructing `new Config(...)` should
   * pass an absolute `inputRoot` (the legacy behavior of falling back to
   * `process.cwd()` is retained for those callers only).
   */
  public getInputRoot(): string {
    return this.inputRoot ?? process.cwd();
  }

  public getSources(): SourceEntry[] {
    return this.sources;
  }

  /**
   * Returns true if either dry-run or check mode is enabled.
   * In both modes, no files should be written.
   */
  public isPreviewMode(): boolean {
    return this.dryRun || this.check;
  }
}

// Exported for use by callers that need to reference the object form
// explicitly (e.g., docs generators, type-narrowing outside this module).
export type { RulesyncConfigTargetsObject };

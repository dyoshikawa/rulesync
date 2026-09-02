import { dirname, isAbsolute, join, resolve } from "node:path";

import { minLength, optional, refine, z } from "zod/mini";

import {
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import {
  ALL_FEATURES,
  Feature,
  FeatureOptions,
  Features,
  FlattenedCommandNaming,
  FlattenedCommandNamingSchema,
  GitignoreDestination,
  GitignoreDestinationSchema,
  isFeatureValueEnabled,
  PerFeatureConfig,
  PerTargetFeaturesValue,
  RulesyncFeatures,
  RulesyncFeaturesSchema,
} from "../types/features.js";
import { Language, LanguageSchema } from "../types/language.js";
import {
  ALL_TOOL_TARGETS,
  PACKAGING_TOOL_TARGETS,
  isRulesyncConfigTargetsObject,
  RulesyncConfigTargets,
  RulesyncConfigTargetsSchema,
  RulesyncTargets,
  ToolTarget,
  ToolTargets,
} from "../types/tool-targets.js";
import { hasControlCharacters } from "../utils/validation.js";

/**
 * Key accepted alongside feature names in the per-feature object form of
 * `targets`. Exported so `rulesync doctor` treats the same key as valid.
 */
export const GITIGNORE_DESTINATION_KEY = "gitignoreDestination";

/**
 * Schema for a single source entry in the sources array.
 * Declares an external repository from which rules and skills can be fetched.
 */
export const SourceEntrySchema = z
  .object({
    source: z.string().check(minLength(1, "source must be a non-empty string")),
    skills: optional(z.array(z.string())),
    rules: optional(z.array(z.string())),
    transport: optional(z.enum(["github", "git", "npm"])),
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
    rulesPath: optional(
      z.string().check(
        refine((v) => !v.includes(".."), 'rulesPath must not contain ".."'),
        refine((v) => !isAbsolute(v), "rulesPath must not be absolute"),
        refine((v) => !hasControlCharacters(v), "rulesPath must not contain control characters"),
      ),
    ),
    // npm-transport-only fields (EXPERIMENTAL). `registry` points at an
    // npm-compatible registry (npmjs.org, Artifactory, Nexus, Verdaccio, ...);
    // `tokenEnv` names the environment variable holding the registry token.
    registry: optional(
      z.string().check(
        refine(
          (v) => v.startsWith("https://") || v.startsWith("http://"),
          "registry must be an http(s) URL",
        ),
        refine((v) => !hasControlCharacters(v), "registry must not contain control characters"),
      ),
    ),
    tokenEnv: optional(
      z
        .string()
        .check(
          refine(
            (v) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(v),
            "tokenEnv must be a valid environment variable name",
          ),
        ),
    ),
    // gh-mode-only fields. Ignored by --mode rulesync. Defaults applied at the
    // gh install site (`agent` defaults to "github-copilot", `scope` to "project").
    agent: optional(
      z.enum(["github-copilot", "claude-code", "cursor", "codex", "gemini", "antigravity"]),
    ),
    scope: optional(z.enum(["project", "user"])),
  })
  .check(
    refine(
      (entry) =>
        (entry.registry === undefined && entry.tokenEnv === undefined) || entry.transport === "npm",
      '"registry" and "tokenEnv" are only valid with transport "npm"',
    ),
  );
export type SourceEntry = z.infer<typeof SourceEntrySchema>;

export const ConfigParamsSchema = z.object({
  outputRoots: z.union([
    z.array(z.string()),
    z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  ]),
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
  flattenedCommandNaming: optional(FlattenedCommandNamingSchema),
  /**
   * Response language the generated rules steer the AI toward. Config-file
   * only (no CLI flag): it is a property of the project, not of one run.
   * Absent means "say nothing about language", which is why `en` is a real
   * value rather than the default.
   */
  language: optional(LanguageSchema),
  gitignoreTargetsOnly: optional(z.boolean()),
  gitignoreDestination: optional(GitignoreDestinationSchema),
  dryRun: optional(z.boolean()),
  check: optional(z.boolean()),
  // Deprecated: parent-of-`.rulesync/` shorthand kept for backward
  // compatibility. Expanded to `inputRoots: [join(inputRoot, ".rulesync")]`
  // (see `normalizeInputRoots`). Prefer the plural `inputRoots` field and
  // point it directly at your source tree(s).
  inputRoot: optional(z.string()),
  // Ordered list of rulesync source-tree directories (e.g. `.rulesync`,
  // `.rulesync.local`). Each entry is a source tree itself — the directory
  // that directly contains `rules/`, `skills/`, `mcp.jsonc`, etc. No
  // implicit `.rulesync/` join is applied. The first root is required; later
  // roots are optional overlays and may be absent. Later entries override
  // earlier ones when the same relative source path appears in more than one
  // root.
  //
  // The two fields are rejected together inside a single file via
  // `assertInputRootFieldsExclusive` (called from `loadConfigFromFile`). A
  // base file with `inputRoot` and a local file with `inputRoots` (or vice
  // versa) merge into a state where `inputRoots` wins, so no cross-file
  // error is raised.
  inputRoots: optional(z.array(z.string()).check(minLength(1, "inputRoots must be non-empty"))),
  // Declarative rule and skill sources
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
export type OutputRoots = string[] | Partial<Record<ToolTarget, string | string[]>>;
export type ConfigParams = Omit<InferredConfigParams, "targets" | "features"> & {
  outputRoots: OutputRoots;
  targets?: RulesyncConfigTargets;
  features?: RulesyncFeatures;
  configFileTargets?: ToolTarget[];
  // Absolute path of the configuration file this config was loaded from. Set
  // by `ConfigResolver`; it is process state rather than a user-settable
  // option, so it deliberately stays out of `ConfigParamsSchema` (and thus out
  // of the `rulesync.jsonc` schema).
  configFilePath?: string;
};

const PartialConfigParamsSchema = z.partial(ConfigParamsSchema);
type InferredPartialConfigParams = z.infer<typeof PartialConfigParamsSchema>;
export type PartialConfigParams = Omit<InferredPartialConfigParams, "targets" | "features"> & {
  outputRoots?: OutputRoots;
  targets?: RulesyncConfigTargets;
  features?: RulesyncFeatures;
};

// Schema for config file that includes $schema property for editor support.
export const ConfigFileSchema = z.object({
  $schema: optional(z.string()),
  ...z.partial(ConfigParamsSchema).shape,
});
type InferredConfigFile = z.infer<typeof ConfigFileSchema>;
export type ConfigFile = Omit<InferredConfigFile, "targets" | "features"> & {
  outputRoots?: OutputRoots;
  targets?: RulesyncConfigTargets;
  features?: RulesyncFeatures;
};

const RequiredConfigParamsSchema = z.required(ConfigParamsSchema);
type InferredRequiredConfigParams = z.infer<typeof RequiredConfigParamsSchema>;
export type RequiredConfigParams = Omit<InferredRequiredConfigParams, "targets" | "features"> & {
  outputRoots: OutputRoots;
  targets?: RulesyncConfigTargets;
  features?: RulesyncFeatures;
};

/**
 * Normalizes the configuration file location to an absolute path.
 *
 * `ConfigResolver` always supplies the path it actually loaded; the fallback
 * only covers direct programmatic construction. `anchorDir` is the directory
 * the config file lives next to — for the default `.rulesync/` layout this
 * is the parent of the primary source tree.
 */
function normalizeConfigFilePath({
  configFilePath,
  anchorDir,
}: {
  configFilePath: string | undefined;
  anchorDir: string;
}): string {
  if (configFilePath === undefined) {
    return join(anchorDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH);
  }

  return isAbsolute(configFilePath) ? configFilePath : resolve(configFilePath);
}

/**
 * Resolves any accepted input-root shape (`inputRoot`, `inputRoots`, or
 * neither) to the canonical non-empty tuple of absolute paths that
 * `Config` stores. Relative entries are resolved against the current
 * working directory at call time.
 *
 * Semantics (post-refactor):
 * - Each entry in `inputRoots` is a rulesync **source tree** (the directory
 *   that directly holds `rules/`, `skills/`, `mcp.jsonc`, etc.). No implicit
 *   `.rulesync/` join is applied.
 * - The legacy singular `inputRoot` is a shorthand for "parent of the
 *   default `.rulesync/` source tree", and is expanded to
 *   `[join(inputRoot, ".rulesync")]` before hitting any consumer. This is
 *   the ONLY place `.rulesync` is appended by convention.
 * - The "nothing configured" default expands to `[join(cwd, ".rulesync")]`
 *   so existing projects with a single `.rulesync/` tree keep working
 *   unchanged.
 *
 * Callers must have already run `assertInputRootFieldsExclusive`.
 */
function normalizeInputRoots({
  inputRoot,
  inputRoots,
}: {
  inputRoot?: string;
  inputRoots?: string[];
}): [string, ...string[]] {
  const source =
    inputRoots !== undefined && inputRoots.length > 0
      ? inputRoots
      : inputRoot !== undefined
        ? [join(inputRoot, RULESYNC_RELATIVE_DIR_PATH)]
        : [join(process.cwd(), RULESYNC_RELATIVE_DIR_PATH)];

  const resolved = source.map((entry) => (isAbsolute(entry) ? entry : resolve(entry)));

  // Non-emptiness is guaranteed above: either `inputRoots.length > 0`, the
  // `[inputRoot]`-derived singleton branch, or the `cwd`-derived fallback.
  return [resolved[0]!, ...resolved.slice(1)];
}

/**
 * Conflicting target pairs that cannot be used together.
 * Exported so `rulesync doctor` can report the same conflicts as diagnostics
 * without duplicating the list.
 */
export const CONFLICTING_TARGET_PAIRS: Array<[string, string]> = [
  ["augmentcode", "augmentcode-legacy"],
  ["claudecode", "claudecode-legacy"],
];

/**
 * Legacy targets that should NOT be included in wildcard (*) expansion.
 * These targets must be explicitly specified.
 */
const LEGACY_TARGETS = ["augmentcode-legacy", "claudecode-legacy"] as const;
/**
 * Expand the wildcard target (`*`) to every ordinary non-legacy tool target.
 * Legacy aliases and package-root targets are excluded because they must be
 * requested explicitly. Shared by `Config.getTargets()` and
 * `extractConfigFileTargets()` so the two never drift.
 */
export function expandWildcardTargets(): ToolTarget[] {
  return ALL_TOOL_TARGETS.filter(
    (target) =>
      !LEGACY_TARGETS.includes(target as (typeof LEGACY_TARGETS)[number]) &&
      !PACKAGING_TOOL_TARGETS.includes(target as (typeof PACKAGING_TOOL_TARGETS)[number]),
  );
}

/**
 * Validates that the user-authored config does not double-define the
 * target set by combining the object form of `targets` with `features`.
 *
 * Rule: if `targets` is in object form, `features` must be omitted (the
 * per-target feature config lives inside the `targets` object).
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

  if (targetsIsObject && features !== undefined) {
    throw new Error(
      "Invalid config: when 'targets' is in object form, 'features' must be omitted. " +
        "Declare per-target features inside the 'targets' object instead.",
    );
  }
};

/**
 * Rejects a single user-authored config file (or a single programmatic
 * construction) that defines both `inputRoot` and `inputRoots` — the two
 * fields express the same setting at singular vs. list level and cannot
 * be combined within one file without ambiguity.
 *
 * The check is intentionally per-file: base and local config files can each
 * be valid in isolation and merge into a state where both survive, and the
 * resolver picks `inputRoots` in that case (see `resolveEffectiveInputRoots`).
 * Only a single file declaring both is a genuine authoring error.
 */
export const assertInputRootFieldsExclusive = ({
  inputRoot,
  inputRoots,
}: {
  inputRoot?: string;
  inputRoots?: string[];
}): void => {
  if (inputRoot !== undefined && inputRoots !== undefined) {
    throw new Error(
      "Invalid config: 'inputRoot' and 'inputRoots' cannot be combined. " +
        "Remove 'inputRoot' and keep 'inputRoots', or reduce 'inputRoots' to a single-element " +
        "'inputRoot' string.",
    );
  }
};

/**
 * Rejects an explicitly supplied empty `inputRoots` list. Omitting the field
 * selects the conventional default, while an empty list has no meaningful
 * source-tree semantics and must not be treated as an absent override.
 */
export const assertInputRootsNonEmpty = ({ inputRoots }: { inputRoots?: string[] }): void => {
  if (inputRoots !== undefined && inputRoots.length === 0) {
    throw new Error("Invalid config: 'inputRoots' must be non-empty.");
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
  private readonly outputRoots: OutputRoots;
  private readonly targets: RulesyncConfigTargets;
  private readonly features: RulesyncFeatures;
  /**
   * Cached list of validated `ToolTarget` keys for the object form of
   * `targets`. Populated in the constructor after `validateObjectFormTargetKeys`
   * so `getTargets()` does not rebuild the `ALL_TOOL_TARGETS` set on every call.
   * Undefined when `this.targets` is in array form.
   */
  private readonly objectFormTargetKeys: ToolTarget[] | undefined;
  private readonly configFileTargets: ToolTarget[] | undefined;
  private readonly verbose: boolean;
  private readonly delete: boolean;
  private readonly global: boolean;
  private readonly silent: boolean;
  private readonly simulateCommands: boolean;
  private readonly simulateSubagents: boolean;
  private readonly simulateSkills: boolean;
  private readonly flattenedCommandNaming: FlattenedCommandNaming;
  private readonly language: Language | undefined;
  private readonly gitignoreTargetsOnly: boolean;
  private readonly gitignoreDestination: GitignoreDestination;
  private readonly dryRun: boolean;
  private readonly check: boolean;
  /**
   * Ordered, absolute-path list of rulesync source trees. Each entry is a
   * source tree itself — the directory that directly contains `rules/`,
   * `skills/`, `mcp.jsonc`, etc. No implicit `.rulesync/` join is applied.
   *
   * Always non-empty by construction — the constructor either normalizes
   * an `inputRoot`/`inputRoots` input or falls back to a single-element
   * list containing `join(<cwd>, ".rulesync")`.
   *
   * `inputRoot` (singular) is a deprecated backward-compatibility alias
   * that expands to `[join(inputRoot, ".rulesync")]`.
   *
   * Typed as a non-empty tuple so the one internal caller that legitimately
   * needs "the primary root" (`normalizeConfigFilePath` fallback) can index
   * `[0]` without a runtime null-check.
   */
  private readonly inputRoots: [string, ...string[]];
  private readonly configFilePath: string;
  private readonly sources: SourceEntry[];

  constructor({
    outputRoots,
    targets,
    features,
    verbose,
    delete: isDelete,
    global,
    silent,
    simulateCommands,
    simulateSubagents,
    simulateSkills,
    flattenedCommandNaming,
    language,
    gitignoreTargetsOnly,
    gitignoreDestination,
    dryRun,
    check,
    inputRoot,
    inputRoots,
    configFilePath,
    sources,
    configFileTargets,
  }: ConfigParams) {
    // Defense-in-depth: enforce the same mutual-exclusivity rule that the
    // file loader applies, so programmatic `new Config(...)` callers can't
    // silently enter the double-defined state. `assertTargetsFeaturesExclusive`
    // is safe to run twice on file-loader inputs — the check is idempotent.
    assertTargetsFeaturesExclusive({ targets, features });
    assertInputRootFieldsExclusive({ inputRoot, inputRoots });
    assertInputRootsNonEmpty({ inputRoots });
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
    this.validateObjectFormOutputRootKeys(outputRoots);

    // Validate conflicting targets (accepts array and object forms)
    this.validateConflictingTargets(resolvedTargets);

    // Validate --dry-run and --check are mutually exclusive
    if (dryRun && check) {
      throw new Error("--dry-run and --check cannot be used together");
    }

    this.outputRoots = outputRoots;
    this.targets = resolvedTargets;
    this.features = resolvedFeatures;
    this.objectFormTargetKeys = isRulesyncConfigTargetsObject(resolvedTargets)
      ? Config.filterValidToolTargets(Object.keys(resolvedTargets))
      : undefined;
    this.configFileTargets = configFileTargets;
    this.verbose = verbose;
    this.delete = isDelete;

    this.global = global ?? false;
    this.silent = silent ?? false;
    this.simulateCommands = simulateCommands ?? false;
    this.simulateSubagents = simulateSubagents ?? false;
    this.simulateSkills = simulateSkills ?? false;
    this.flattenedCommandNaming = flattenedCommandNaming ?? "basename";
    this.language = language;
    this.gitignoreTargetsOnly = gitignoreTargetsOnly ?? true;
    this.gitignoreDestination = gitignoreDestination ?? "gitignore";
    this.dryRun = dryRun ?? false;
    this.check = check ?? false;
    // Capture the input roots once at construction time so subsequent
    // `getInputRoots()` calls are pure (independent of any later `chdir`).
    // Relative entries are resolved against the current working directory
    // eagerly for the same reason; the schema accepts them because they're
    // a legitimate input form, and we normalize them here.
    //
    // The `process.cwd()` fallback only fires for direct programmatic
    // construction (e.g. `new Config({ ... })` in tests or `src/lib/init.ts`).
    // The standard `ConfigResolver.resolve` path always supplies a
    // pre-resolved absolute list, so this branch is unreachable from the
    // CLI / programmatic-API surface.
    this.inputRoots = normalizeInputRoots({ inputRoot, inputRoots });

    // `inputRoots[0]` is now the primary source tree itself (e.g. `.rulesync`
    // or `.rulesync.local`); the config file conventionally lives one level
    // up from it, so anchor the fallback there.
    this.configFilePath = normalizeConfigFilePath({
      configFilePath,
      anchorDir: dirname(this.inputRoots[0]),
    });

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

  private validateObjectFormOutputRootKeys(outputRoots: OutputRoots): void {
    if (Array.isArray(outputRoots)) return;
    const validTargets = new Set<string>(ALL_TOOL_TARGETS);
    for (const key of Object.keys(outputRoots)) {
      if (!validTargets.has(key)) {
        throw new Error(
          `Unknown outputRoots target '${key}'. Valid targets: ${ALL_TOOL_TARGETS.join(", ")}.`,
        );
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

  public getOutputRoots(): string[];
  public getOutputRoots(target: ToolTarget): string[];
  public getOutputRoots(target?: ToolTarget): string[] {
    if (Array.isArray(this.outputRoots)) {
      return this.outputRoots;
    }

    if (target) {
      const targetOutputRoots = this.outputRoots[target];
      if (targetOutputRoots === undefined) return [];
      return Array.isArray(targetOutputRoots) ? targetOutputRoots : [targetOutputRoots];
    }

    const allRoots: string[] = [];
    for (const value of Object.values(this.outputRoots)) {
      if (value === undefined) continue;
      allRoots.push(...(Array.isArray(value) ? value : [value]));
    }
    return [...new Set(allRoots)];
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

    if (arrayTargets.includes("*")) {
      return [
        ...new Set([
          ...expandWildcardTargets(),
          ...arrayTargets.filter((target): target is ToolTarget => target !== "*"),
        ]),
      ];
    }

    return arrayTargets.filter((target): target is ToolTarget => target !== "*");
  }

  public getConfigFileTargets(): ToolTarget[] {
    return this.configFileTargets ?? this.getTargets();
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
    const value = isRulesyncConfigTargetsObject(this.targets) ? this.targets[target] : undefined;
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
    return isRulesyncConfigTargetsObject(this.targets);
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

  public getFlattenedCommandNaming(): FlattenedCommandNaming {
    return this.flattenedCommandNaming;
  }

  /**
   * The configured response language, or `undefined` when `rulesync.jsonc`
   * does not set one — in which case generation leaves language alone.
   */
  public getLanguage(): Language | undefined {
    return this.language;
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
   * Returns the ordered list of rulesync source trees. Each entry is the
   * source tree itself — the directory that directly contains `rules/`,
   * `skills/`, `mcp.jsonc`, etc. Values are absolute paths captured at
   * config-construction time, so this accessor is pure and never depends on
   * a live `process.cwd()` read.
   *
   * The returned tuple is always non-empty: when no `inputRoot`/`inputRoots`
   * was supplied, `[join(process.cwd(), ".rulesync")]` is snapshotted once
   * during construction. The first entry is the required base source tree.
   * Later entries are optional overlays and may be absent; when present, they
   * take precedence when the same relative source path exists in more than
   * one root (see per-feature merge policies in the processor
   * `loadRulesync*` methods).
   */
  public getInputRoots(): readonly [string, ...string[]] {
    return this.inputRoots;
  }

  /**
   * Returns the absolute path of the configuration file this config was
   * resolved from. The file itself may not exist — `rulesync` runs fine
   * without one — so callers must treat this as a location, not a guarantee.
   */
  public getConfigFilePath(): string {
    return this.configFilePath;
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

import { join } from "node:path";

import {
  TAKT_CONFIG_FILE_NAME,
  TAKT_DIR,
  TAKT_RUNTIME_CONFIG_FILE_NAME,
} from "../../constants/takt-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { getHomeDirectory, readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isPlainObject } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  mergeSharedConfigDeep,
  parseSharedConfig,
  TAKT_CONFIG_SHARED_FILE_KEY,
} from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

// Takt config keys (`.takt/config.yaml`).
// https://github.com/nrslib/takt/blob/main/docs/configuration.md
const TAKT_PROVIDER_KEY = "provider";
const TAKT_PROVIDER_PROFILES_KEY = "provider_profiles";
const TAKT_DEFAULT_PERMISSION_MODE_KEY = "default_permission_mode";
// Per-workflow-step mode map inside a provider profile (`<step>` →
// readonly/edit/full); routed through the `takt` override.
const TAKT_STEP_PERMISSION_OVERRIDES_KEY = "step_permission_overrides";
// Top-level, per-provider sandbox/network options table; routed through the
// `takt` override.
const TAKT_PROVIDER_OPTIONS_KEY = "provider_options";

// Keys of Takt's runtime provider config (`runtime.yaml`, Takt 0.56.0+). Only
// read, never written: rulesync resolves the active provider from it and lifts
// each profile's flat `options` bag back out on import.
// https://github.com/nrslib/takt/blob/main/docs/configuration.md
const TAKT_RUNTIME_PROVIDER_KEY = "provider";
const TAKT_RUNTIME_DEFAULTS_KEY = "defaults";
const TAKT_RUNTIME_PROFILES_KEY = "profiles";
const TAKT_RUNTIME_TARGETS_KEY = "targets";
const TAKT_RUNTIME_AUTO_ROUTING_KEY = "auto_routing";
const TAKT_RUNTIME_PROFILE_KEY = "profile";
const TAKT_RUNTIME_OPTIONS_KEY = "options";

// Takt's default-deny "workflow security policies": each admits one class of
// user-supplied code (an Arpeggio module, a runtime-prepare script, a
// workflow-declared command gate, a sync-conflict tool) or re-enables git hooks
// and filters during Takt-managed commits. All are top-level keys of
// `config.yaml` in both scopes, and all are routed through the `takt` override
// because none maps onto a canonical permission category.
// https://github.com/nrslib/takt/blob/main/docs/configuration.md
// Each entry names the sub-keys Takt's own schema declares, or `null` for the
// two plain booleans. The sub-keys are checked rather than passed through:
// Takt's schemas are `.strict()`, so one misspelled flag makes it reject the
// whole config.yaml — a typo in `.rulesync/permissions.*` would take the user's
// Takt install down rather than leave one capability denied.
// https://github.com/nrslib/takt/blob/main/docs/configuration.md
const TAKT_SECURITY_POLICIES: Record<string, readonly string[] | null> = {
  workflow_arpeggio: ["custom_data_source_modules", "custom_merge_inline_js", "custom_merge_files"],
  workflow_runtime_prepare: ["custom_scripts"],
  workflow_command_gates: ["custom_scripts"],
  sync_conflict_resolver: ["auto_approve_tools"],
  allow_git_hooks: null,
  allow_git_filters: null,
};

const TAKT_SECURITY_POLICY_KEYS = Object.keys(TAKT_SECURITY_POLICIES);

// Takt's three coarse permission modes, ordered readonly < edit < full.
type TaktPermissionMode = "readonly" | "edit" | "full";

// Default provider when the config has no top-level `provider:` and no profiles.
const TAKT_DEFAULT_PROVIDER = "claude";

// rulesync canonical catch-all pattern (Takt's mode is coarse, so only a
// catch-all maps cleanly back on import).
const CATCH_ALL_PATTERN = "*";

/**
 * Permissions adapter for Takt (`.takt/config.yaml`).
 *
 * Takt has no per-pattern permission rules. Tool gating is a single coarse mode
 * per provider profile (`default_permission_mode`), ordered
 * `readonly` < `edit` < `full`:
 *   - `readonly` — the agent may only read.
 *   - `edit` — the agent may read and edit/write files.
 *   - `full` — the agent may also run shell commands.
 *
 * The mode lives under `provider_profiles.<provider>.default_permission_mode` in
 * `.takt/config.yaml` (project) / `~/.takt/config.yaml` (global), where
 * `<provider>` is the active provider named by the top-level `provider:` key.
 *
 * rulesync's permission model is per-category, per-pattern `allow`/`ask`/`deny`,
 * so the mapping is **lossy** (a single mode cannot express per-pattern rules):
 *   - Generate: derive a single mode with this precedence —
 *     1. any `deny` rule anywhere ⇒ `readonly` (conservative — keep the
 *        narrowest mode whenever the user expressed any restriction);
 *     2. else any `edit`/`write` category `allow` rule ⇒ `edit`;
 *     3. else any `bash` category `allow` rule ⇒ `full`;
 *     4. else ⇒ `readonly` (safe default).
 *   - Import: `full` ⇒ `bash: { "*": "allow" }`; `edit` ⇒
 *     `edit: { "*": "allow" }`; `readonly` (or unset/unknown) ⇒
 *     `bash: { "*": "deny" }`. These round-trip the generate mapping.
 *
 * Both project and global scope are supported. The shared config is merged in
 * place: `provider_profiles.<provider>.default_permission_mode` is set from the
 * derived mode; every other provider profile and all other top-level keys are
 * preserved. The file is never deleted.
 *
 * Two Takt-specific surfaces with no canonical category round-trip through the
 * `takt` override (see `TaktPermissionsOverrideSchema`):
 * `step_permission_overrides` (a per-step mode map inside the active provider
 * profile, layered on top of `default_permission_mode`) and `provider_options`
 * (a top-level per-provider sandbox/network table). Both are authored on
 * generate and re-extracted on import.
 *
 * Takt 0.56.0 moved provider configuration into a separate `runtime.yaml`
 * (`.takt/runtime.yaml`, `~/.takt/runtime.yaml`). Once its `provider:` section
 * carries an assignment ("runtime mode" — the state a freshly installed Takt is
 * in, since it generates an active global runtime.yaml on first launch), any
 * legacy provider setting left in `config.yaml` makes Takt stop before running
 * an agent with "Mixed provider configuration detected". rulesync only reads
 * that file, in two places:
 *   - the active provider is resolved from it first (the `provider_profiles`
 *     key that carries the permission mode is still keyed by provider name, and
 *     `provider_profiles` is not itself a legacy signal);
 *   - an authored `provider_options` is refused with a warning rather than
 *     written while runtime mode is active, and its runtime-side counterpart
 *     (`provider.profiles.*.options`) is lifted back out on import.
 * Installs with no runtime.yaml, or an inactive one, keep the legacy behavior
 * unchanged.
 */
export class TaktPermissions extends ToolPermissions {
  /**
   * The sibling `runtime.yaml` as read from the same scope, or `""` when the
   * install has none. Import needs it — `toRulesyncPermissions()` is
   * synchronous, so the file is read alongside config.yaml in `fromFile()`.
   */
  private readonly runtimeFileContent: string;

  constructor({ runtimeFileContent, ...params }: AiFileParams & { runtimeFileContent?: string }) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
    });
    this.runtimeFileContent = runtimeFileContent ?? "";
  }

  override isDeletable(): boolean {
    // config.yaml holds other Takt settings, so it must never be removed
    // wholesale; permission changes happen via an in-place merge instead.
    return false;
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolPermissionsSettablePaths {
    // Project: `.takt/config.yaml`; global: `~/.takt/config.yaml` (the home
    // directory is resolved by the processor through outputRoot).
    return {
      relativeDirPath: TAKT_DIR,
      relativeFilePath: TAKT_CONFIG_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<TaktPermissions> {
    const paths = TaktPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";
    // Same scope only: import reads the tree it was pointed at, so it must not
    // reach into the home directory for a file the source tree does not have.
    const runtimeFileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, TAKT_RUNTIME_CONFIG_FILE_NAME),
      )) ?? "";
    return new TaktPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      runtimeFileContent,
      validate,
      global,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    global = false,
    logger,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<TaktPermissions> {
    const paths = TaktPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so a dry-run/check does not create the user's
    // config.yaml as a side effect (mirrors the Goose/Grok adapters).
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const config = parseSharedConfig({
      format: "yaml",
      fileContent: existingContent,
      filePath,
      invalidRootPolicy: "error",
    });

    const runtime = await readTaktRuntimeConfig({ outputRoot, logger });

    const rulesyncJson = rulesyncPermissions.getJson();
    const provider = resolveActiveProvider({
      config,
      runtime: runtime.active ? runtime.config : undefined,
    });
    const mode = deriveTaktPermissionMode(rulesyncJson);
    const override = isPlainObject(rulesyncJson.takt) ? rulesyncJson.takt : undefined;

    // `step_permission_overrides` lives inside the active provider profile,
    // alongside the derived coarse `default_permission_mode`; Takt layers the
    // per-step mode on top of the default, so the two coexist without conflict.
    const stepOverrides = isPlainObject(override?.[TAKT_STEP_PERMISSION_OVERRIDES_KEY])
      ? override[TAKT_STEP_PERMISSION_OVERRIDES_KEY]
      : undefined;
    // `provider_options` is a top-level table keyed by provider name, each
    // holding an options object orthogonal to the permission mode.
    const authoredProviderOptions = isPlainObject(override?.[TAKT_PROVIDER_OPTIONS_KEY])
      ? override[TAKT_PROVIDER_OPTIONS_KEY]
      : undefined;
    // Under runtime mode `provider_options` in config.yaml is a legacy provider
    // signal: Takt stops before running any agent with "Mixed provider
    // configuration detected". Writing it would take the user's Takt install
    // down, so it is refused rather than emitted — the option belongs in
    // runtime.yaml, which rulesync does not write (a profile is provider- and
    // scope-specific, and upstream replaces a same-named profile wholesale
    // rather than merging it, so there is no safe key for rulesync to own).
    const runtimeModeRefusesProviderOptions =
      authoredProviderOptions !== undefined && runtime.active;
    if (runtimeModeRefusesProviderOptions) {
      logger?.warn(
        `Takt permissions: not writing "${TAKT_PROVIDER_OPTIONS_KEY}" to ${filePath} because ` +
          `${runtime.filePaths.join(" + ")} puts Takt in runtime provider mode (Takt 0.56.0+), ` +
          `where any legacy provider setting in config.yaml makes Takt fail with "Mixed provider ` +
          `configuration detected". Move those options to ` +
          `\`provider.profiles.<profile>.options\` in runtime.yaml, and remove them from the ` +
          `\`takt\` block of the rulesync source. A "${TAKT_PROVIDER_OPTIONS_KEY}" already in ` +
          `${filePath} is left untouched — rulesync does not own that key.`,
      );
    }
    const overrideProviderOptions = runtimeModeRefusesProviderOptions
      ? undefined
      : authoredProviderOptions;

    const authoredPolicies = pickSecurityPolicies(override, {
      filePath,
      logger,
      source: "the `takt` override block",
    });
    const patch: Record<string, unknown> = {
      [TAKT_PROVIDER_PROFILES_KEY]: {
        [provider]: {
          [TAKT_DEFAULT_PERMISSION_MODE_KEY]: mode,
          ...(stepOverrides !== undefined && {
            [TAKT_STEP_PERMISSION_OVERRIDES_KEY]: stepOverrides,
          }),
        },
      },
      ...(overrideProviderOptions !== undefined && {
        [TAKT_PROVIDER_OPTIONS_KEY]: overrideProviderOptions,
      }),
      // Every policy key is present in the patch — an authored value, or
      // `undefined` for one the source no longer states. The gateway replaces
      // these keys wholesale and an `undefined` drops out of the written
      // document, so revoking a capability in `.rulesync/permissions.*` revokes
      // it in config.yaml instead of leaving the old `true` behind.
      ...Object.fromEntries(TAKT_SECURITY_POLICY_KEYS.map((key) => [key, authoredPolicies[key]])),
    };

    // These keys are owned, so one the source does not state is removed even if
    // rulesync never wrote it. The checks adapter announces the same kind of
    // removal, and without this a user who adds a policy by hand — after Takt
    // refused to run something — watches it disappear on the next generate with
    // no idea why.
    // Sub-key granularity: a table is replaced wholesale, so a flag the user set
    // by hand beside the authored one goes too and is worth naming on its own.
    const existingPolicies = pickSecurityPolicies(config);
    const removedPolicies = TAKT_SECURITY_POLICY_KEYS.flatMap((key) => {
      const existing = existingPolicies[key];
      if (existing === undefined) {
        return [];
      }
      const authored = authoredPolicies[key];
      if (authored === undefined) {
        return [key];
      }
      if (!isPlainObject(existing) || !isPlainObject(authored)) {
        return [];
      }
      return Object.keys(existing)
        .filter((subKey) => authored[subKey] === undefined)
        .map((subKey) => `${key}.${subKey}`);
    });
    if (removedPolicies.length > 0) {
      logger?.warn(
        `Takt permissions: removing ${removedPolicies.map((key) => `"${key}"`).join(", ")} from ` +
          `${filePath} because the \`takt\` block of the rulesync source does not state them. ` +
          `That is the revocation if you removed them there; if you added them to config.yaml by ` +
          `hand, author them in the rulesync source instead — these keys are rewritten on every ` +
          `generate.`,
      );
    }

    return new TaktPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: TAKT_CONFIG_SHARED_FILE_KEY,
        feature: "permissions",
        existingContent,
        patch,
        filePath,
      }),
      validate: true,
      global,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const config = parseSharedConfig({
      format: "yaml",
      fileContent: this.getFileContent(),
      filePath: join(this.getRelativeDirPath(), this.getRelativeFilePath()),
      invalidRootPolicy: "error",
    });

    const runtimeFilePath = join(this.getRelativeDirPath(), TAKT_RUNTIME_CONFIG_FILE_NAME);
    const runtime = parseSharedConfig({
      format: "yaml",
      fileContent: this.runtimeFileContent,
      filePath: runtimeFilePath,
    });
    const runtimeActive = isRuntimeModeActive(runtime);

    const provider = resolveActiveProvider({
      config,
      runtime: runtimeActive ? runtime : undefined,
    });
    const profiles = isPlainObject(config[TAKT_PROVIDER_PROFILES_KEY])
      ? config[TAKT_PROVIDER_PROFILES_KEY]
      : {};
    const profile = isPlainObject(profiles[provider]) ? profiles[provider] : {};
    const mode = profile[TAKT_DEFAULT_PERMISSION_MODE_KEY];

    const rulesyncConfig: PermissionsConfig = taktModeToRulesyncConfig(mode);

    // Route Takt's step-permission map and provider-options table into the
    // `takt` override — neither has a canonical category. The step map is lifted
    // from the active provider profile; `provider_options` round-trips whole.
    const stepOverrides = isPlainObject(profile[TAKT_STEP_PERMISSION_OVERRIDES_KEY])
      ? profile[TAKT_STEP_PERMISSION_OVERRIDES_KEY]
      : undefined;
    // Provider options can sit on either side of the 0.56.0 split: the legacy
    // `provider_options` table in config.yaml, and — under runtime mode — the
    // per-profile `options` bags in runtime.yaml, re-keyed by each profile's
    // provider. Both are lifted so nothing is lost on import; the runtime side
    // wins on a collision, since a config.yaml still carrying the legacy key in
    // runtime mode is precisely the state Takt refuses to run.
    const legacyProviderOptions = isPlainObject(config[TAKT_PROVIDER_OPTIONS_KEY])
      ? config[TAKT_PROVIDER_OPTIONS_KEY]
      : {};
    const runtimeProviderOptions = runtimeActive ? collectRuntimeProviderOptions(runtime) : {};
    const providerOptions = mergeSharedConfigDeep({
      base: legacyProviderOptions,
      patch: runtimeProviderOptions,
    });
    const taktOverride: Record<string, unknown> = {};
    if (stepOverrides && Object.keys(stepOverrides).length > 0) {
      taktOverride[TAKT_STEP_PERMISSION_OVERRIDES_KEY] = stepOverrides;
    }
    if (providerOptions && Object.keys(providerOptions).length > 0) {
      taktOverride[TAKT_PROVIDER_OPTIONS_KEY] = providerOptions;
    }
    Object.assign(taktOverride, pickSecurityPolicies(config));

    const result: Record<string, unknown> = { ...rulesyncConfig };
    if (Object.keys(taktOverride).length > 0) {
      result.takt = taktOverride;
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(result, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolPermissionsForDeletionParams): TaktPermissions {
    return new TaktPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}

/**
 * Resolve the active Takt provider.
 *
 * Under runtime mode (Takt 0.56.0+) the real provider assignment lives in
 * `runtime.yaml`, and `config.yaml:provider` cannot coexist with it, so the
 * runtime document is consulted first: the provider of the profile named by
 * `provider.defaults.profile`. Everything else falls through to the legacy
 * chain — the top-level `provider:` value, else the sole key in
 * `provider_profiles`, else the `claude` default.
 */
function resolveActiveProvider({
  config,
  runtime,
}: {
  config: Record<string, unknown>;
  runtime?: Record<string, unknown> | undefined;
}): string {
  const fromRuntime = runtime === undefined ? undefined : resolveRuntimeProvider(runtime);
  if (fromRuntime !== undefined) {
    return fromRuntime;
  }
  if (typeof config[TAKT_PROVIDER_KEY] === "string" && config[TAKT_PROVIDER_KEY].trim() !== "") {
    return config[TAKT_PROVIDER_KEY];
  }
  const profiles = config[TAKT_PROVIDER_PROFILES_KEY];
  if (isPlainObject(profiles)) {
    const keys = Object.keys(profiles);
    if (keys.length === 1) {
      return keys[0]!;
    }
  }
  return TAKT_DEFAULT_PROVIDER;
}

/** A plain object carrying at least one entry (Takt's "assignment" test). */
function hasEntries(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && Object.keys(value).length > 0;
}

function runtimeProfiles(runtime: Record<string, unknown>): Record<string, unknown> {
  const provider = runtime[TAKT_RUNTIME_PROVIDER_KEY];
  if (!isPlainObject(provider)) {
    return {};
  }
  const profiles = provider[TAKT_RUNTIME_PROFILES_KEY];
  return isPlainObject(profiles) ? profiles : {};
}

/**
 * Whether a parsed `runtime.yaml` puts Takt into runtime mode, mirroring
 * upstream's mode detection: the `provider:` section must carry an actual
 * assignment — a non-empty `defaults`, `profiles` or `auto_routing`, or a
 * `targets` map with at least one non-empty nested map. The file existing is not
 * enough, and empty nested maps (`defaults: {}`, `targets: { personas: {} }`)
 * must not flip the mode.
 * https://github.com/nrslib/takt/blob/main/src/infra/config/runtime-provider/mode.ts
 */
function isRuntimeModeActive(runtime: Record<string, unknown>): boolean {
  const provider = runtime[TAKT_RUNTIME_PROVIDER_KEY];
  if (!isPlainObject(provider)) {
    return false;
  }
  if (
    hasEntries(provider[TAKT_RUNTIME_DEFAULTS_KEY]) ||
    hasEntries(provider[TAKT_RUNTIME_PROFILES_KEY]) ||
    hasEntries(provider[TAKT_RUNTIME_AUTO_ROUTING_KEY])
  ) {
    return true;
  }
  const targets = provider[TAKT_RUNTIME_TARGETS_KEY];
  return isPlainObject(targets) && Object.values(targets).some(hasEntries);
}

/** The provider named by the runtime profile Takt would use by default. */
function resolveRuntimeProvider(runtime: Record<string, unknown>): string | undefined {
  const provider = runtime[TAKT_RUNTIME_PROVIDER_KEY];
  const profiles = runtimeProfiles(runtime);
  const providerOf = (profileName: string | undefined): string | undefined => {
    if (profileName === undefined) {
      return undefined;
    }
    const profile = profiles[profileName];
    if (!isPlainObject(profile)) {
      return undefined;
    }
    const value = profile[TAKT_RUNTIME_PROVIDER_KEY];
    return typeof value === "string" && value.trim() !== "" ? value : undefined;
  };

  if (!isPlainObject(provider)) {
    return undefined;
  }
  const defaults = provider[TAKT_RUNTIME_DEFAULTS_KEY];
  if (!isPlainObject(defaults) || typeof defaults[TAKT_RUNTIME_PROFILE_KEY] !== "string") {
    // Upstream names no provider without `defaults.profile` — a lone profile is
    // not promoted to the default, and `defaults.pool`/ladder forms resolve at
    // run time. Falling through keeps the legacy chain (and ultimately Takt's
    // own `claude` default) rather than inventing a resolution Takt lacks.
    return undefined;
  }
  return providerOf(defaults[TAKT_RUNTIME_PROFILE_KEY]);
}

/**
 * Lift the runtime profiles' flat `options` bags back into the per-provider
 * shape the `takt` override uses. Each profile's options belong to that
 * profile's own provider; when several profiles name the same provider they are
 * merged in document order, so a later profile wins on a colliding option key.
 */
function collectRuntimeProviderOptions(runtime: Record<string, unknown>): Record<string, unknown> {
  const collected: Record<string, unknown> = {};
  for (const profile of Object.values(runtimeProfiles(runtime))) {
    if (!isPlainObject(profile)) {
      continue;
    }
    const providerName = profile[TAKT_RUNTIME_PROVIDER_KEY];
    const options = profile[TAKT_RUNTIME_OPTIONS_KEY];
    if (typeof providerName !== "string" || providerName.trim() === "" || !hasEntries(options)) {
      continue;
    }
    const existing = collected[providerName];
    collected[providerName] = { ...(isPlainObject(existing) ? existing : {}), ...options };
  }
  return collected;
}

/**
 * Read one `runtime.yaml`. A file that cannot be parsed reports `unparsable`
 * rather than a document: Takt refuses to start on a broken runtime.yaml, and
 * treating it as legacy would be the one outcome that writes the
 * mixed-configuration key into the user's config.yaml.
 */
async function readTaktRuntimeFile({
  filePath,
  logger,
}: {
  filePath: string;
  logger?: Logger | undefined;
}): Promise<{ config: Record<string, unknown>; unparsable: boolean } | undefined> {
  const fileContent = await readFileContentOrNull(filePath);
  if (fileContent === null) {
    return undefined;
  }
  try {
    return {
      config: parseSharedConfig({ format: "yaml", fileContent, filePath }),
      unparsable: false,
    };
  } catch (error) {
    logger?.warn(
      `Takt permissions: could not parse ${filePath} (${formatError(error)}); assuming Takt's ` +
        `runtime provider mode is active so no legacy provider setting is written to config.yaml.`,
    );
    return { config: {}, unparsable: true };
  }
}

/**
 * Collapse the project and global `runtime.yaml` into the single document Takt
 * itself resolves against, matching upstream's loader: `profiles` is a union
 * with the project definition of a same-named profile replacing the global one,
 * while `defaults`, `targets` and `auto_routing` are taken from the project file
 * whole whenever it states them at all (`??`, so a project `targets: {}` masks
 * the global one rather than merging with it).
 * https://github.com/nrslib/takt/blob/main/src/infra/config/runtime-provider/loader.ts
 *
 * Merging before mode detection matters in both directions: a project file
 * active only through `targets:` still resolves its provider from the global
 * file's `defaults`/`profiles`, and a project section that masks the global one
 * leaves the merged document inactive even though the global file alone was not.
 */
function mergeTaktRuntimeConfigs({
  project,
  global: globalConfig,
}: {
  project: Record<string, unknown> | undefined;
  global: Record<string, unknown> | undefined;
}): Record<string, unknown> {
  const sectionOf = (config: Record<string, unknown> | undefined): Record<string, unknown> => {
    const provider = config?.[TAKT_RUNTIME_PROVIDER_KEY];
    return isPlainObject(provider) ? provider : {};
  };
  const projectSection = sectionOf(project);
  const globalSection = sectionOf(globalConfig);
  const replaced = (key: string): unknown => projectSection[key] ?? globalSection[key];

  const profilesOf = (section: Record<string, unknown>): Record<string, unknown> | undefined =>
    isPlainObject(section[TAKT_RUNTIME_PROFILES_KEY])
      ? section[TAKT_RUNTIME_PROFILES_KEY]
      : undefined;
  const globalProfiles = profilesOf(globalSection);
  const projectProfiles = profilesOf(projectSection);

  const provider: Record<string, unknown> = {};
  if (globalProfiles !== undefined || projectProfiles !== undefined) {
    provider[TAKT_RUNTIME_PROFILES_KEY] = { ...globalProfiles, ...projectProfiles };
  }
  for (const key of [
    TAKT_RUNTIME_DEFAULTS_KEY,
    TAKT_RUNTIME_TARGETS_KEY,
    TAKT_RUNTIME_AUTO_ROUTING_KEY,
  ]) {
    const value = replaced(key);
    if (value !== undefined) {
      provider[key] = value;
    }
  }
  return { [TAKT_RUNTIME_PROVIDER_KEY]: provider };
}

/**
 * The runtime provider configuration in force for a generate run: the project
 * and global `runtime.yaml` merged the way Takt merges them, plus whether the
 * result puts Takt in runtime mode.
 *
 * Both scopes are read whichever scope is being generated: Takt collects legacy
 * signals from the project and global `config.yaml` alike, so a global
 * `runtime.yaml` — the one Takt generates on first launch — makes a legacy key
 * in the project config.yaml a hard failure just the same.
 */
async function readTaktRuntimeConfig({
  outputRoot,
  logger,
}: {
  outputRoot: string;
  logger?: Logger | undefined;
}): Promise<{ filePaths: string[]; config: Record<string, unknown>; active: boolean }> {
  const projectPath = join(outputRoot, TAKT_DIR, TAKT_RUNTIME_CONFIG_FILE_NAME);
  let globalPath: string | undefined;
  try {
    // In global scope `outputRoot` already is the home directory, hence the
    // dedupe. `getHomeDirectory()` throws when it cannot be resolved (and in
    // tests unless mocked), which just means "no global runtime.yaml here".
    const resolved = join(getHomeDirectory(), TAKT_DIR, TAKT_RUNTIME_CONFIG_FILE_NAME);
    globalPath = resolved === projectPath ? undefined : resolved;
  } catch {
    // Ignored on purpose: an unresolvable home directory is not a generate error.
  }

  const [project, globalFile] = await Promise.all([
    readTaktRuntimeFile({ filePath: projectPath, logger }),
    globalPath === undefined
      ? Promise.resolve(undefined)
      : readTaktRuntimeFile({ filePath: globalPath, logger }),
  ]);

  const filePaths = [
    ...(project === undefined ? [] : [projectPath]),
    ...(globalFile === undefined || globalPath === undefined ? [] : [globalPath]),
  ];
  const config = mergeTaktRuntimeConfigs({
    project: project?.config,
    global: globalFile?.config,
  });
  const unparsable = project?.unparsable === true || globalFile?.unparsable === true;
  return { filePaths, config, active: unparsable || isRuntimeModeActive(config) };
}

/**
 * Collapse a rulesync permissions config into Takt's single coarse mode.
 *
 * Precedence: any `deny` ⇒ `readonly`; else an `edit`/`write` `allow` ⇒ `edit`;
 * else a `bash` `allow` ⇒ `full`; else the safe default `readonly`.
 */
function deriveTaktPermissionMode(config: PermissionsConfig): TaktPermissionMode {
  let hasEditAllow = false;
  let hasBashAllow = false;

  for (const [category, rules] of Object.entries(config.permission)) {
    for (const action of Object.values(rules)) {
      if (action === "deny") {
        return "readonly";
      }
      if (action === "allow") {
        if (category === "edit" || category === "write") {
          hasEditAllow = true;
        } else if (category === "bash") {
          hasBashAllow = true;
        }
      }
    }
  }

  if (hasEditAllow) {
    return "edit";
  }
  if (hasBashAllow) {
    return "full";
  }
  return "readonly";
}

/**
 * Map a Takt permission mode back into a rulesync permissions config. This
 * round-trips the generate mapping; unset/unknown modes fall back to the safe
 * `readonly` projection (`bash: { "*": "deny" }`).
 */
function taktModeToRulesyncConfig(mode: unknown): PermissionsConfig {
  switch (mode) {
    case "full":
      return { permission: { bash: { [CATCH_ALL_PATTERN]: "allow" } } };
    case "edit":
      return { permission: { edit: { [CATCH_ALL_PATTERN]: "allow" } } };
    default:
      // `readonly` and any unset/unknown mode.
      return { permission: { bash: { [CATCH_ALL_PATTERN]: "deny" } } };
  }
}

/**
 * Lift Takt's security-policy keys out of a source object, keeping only the
 * shapes Takt itself accepts (a boolean, or a table of booleans). Used in both
 * directions: from the `takt` override on generate, and from `config.yaml` on
 * import.
 */
function pickSecurityPolicies(
  source: Record<string, unknown> | undefined,
  report?: { filePath: string; logger?: Logger; source: string },
): Record<string, unknown> {
  if (!source) {
    return {};
  }
  const picked: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, subKeys] of Object.entries(TAKT_SECURITY_POLICIES)) {
    const value = source[key];
    // `null` reads as "not set" rather than as a value of the wrong type.
    if (value === undefined || value === null) {
      continue;
    }
    if (subKeys === null) {
      if (typeof value === "boolean") {
        picked[key] = value;
      } else {
        dropped.push(key);
      }
      continue;
    }
    if (!isPlainObject(value)) {
      dropped.push(key);
      continue;
    }
    const flags = Object.fromEntries(
      subKeys
        .filter((subKey) => typeof value[subKey] === "boolean")
        .map((subKey) => [subKey, value[subKey]]),
    );
    dropped.push(
      // Own-property check: a sub-key named `toString` would otherwise resolve
      // to something off `Object.prototype` and go unreported.
      ...Object.keys(value)
        .filter((subKey) => !Object.hasOwn(flags, subKey))
        .map((subKey) => `${key}.${subKey}`),
    );
    if (Object.keys(flags).length > 0) {
      picked[key] = flags;
    }
  }
  // Dropping keeps Takt loadable — its schemas reject the whole file on an
  // unknown key — but a capability the user meant to grant stays denied, which
  // is worth saying out loud.
  if (dropped.length > 0 && report) {
    report.logger?.warn(
      `Takt permissions: ignoring ${dropped.map((key) => `"${key}"`).join(", ")} from ` +
        `${report.source}; Takt declares no such workflow security policy, or not with that ` +
        `type, and writing it would make it reject ${report.filePath}.`,
    );
  }
  return picked;
}

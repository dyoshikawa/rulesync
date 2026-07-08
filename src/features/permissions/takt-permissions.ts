import { join } from "node:path";

import { TAKT_CONFIG_FILE_NAME, TAKT_DIR } from "../../constants/takt-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionsConfig } from "../../types/permissions.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { isPlainObject } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
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
 */
export class TaktPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
    });
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
    return new TaktPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    global = false,
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

    const rulesyncJson = rulesyncPermissions.getJson();
    const provider = resolveActiveProvider(config);
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
    const overrideProviderOptions = isPlainObject(override?.[TAKT_PROVIDER_OPTIONS_KEY])
      ? override[TAKT_PROVIDER_OPTIONS_KEY]
      : undefined;

    // The gateway's declared deep-merge policy preserves every sibling key the
    // user set at any depth (other provider profiles, other keys in the active
    // profile, sibling per-provider options), so only the authored values are
    // stated here.
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
    };

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

    const provider = resolveActiveProvider(config);
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
    const providerOptions = isPlainObject(config[TAKT_PROVIDER_OPTIONS_KEY])
      ? config[TAKT_PROVIDER_OPTIONS_KEY]
      : undefined;
    const taktOverride: Record<string, unknown> = {};
    if (stepOverrides && Object.keys(stepOverrides).length > 0) {
      taktOverride[TAKT_STEP_PERMISSION_OVERRIDES_KEY] = stepOverrides;
    }
    if (providerOptions && Object.keys(providerOptions).length > 0) {
      taktOverride[TAKT_PROVIDER_OPTIONS_KEY] = providerOptions;
    }

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
 * Resolve the active Takt provider: the top-level `provider:` value, else the
 * sole key in `provider_profiles`, else the `claude` default.
 */
function resolveActiveProvider(config: Record<string, unknown>): string {
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

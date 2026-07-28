import { uniq } from "es-toolkit";
import { dump } from "js-yaml";
import {
  parse as parseJsonc,
  type ParseError as JsoncParseError,
  printParseErrorCode,
} from "jsonc-parser";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import { CODEXCLI_OVERRIDE_KEYS } from "../../constants/codexcli-paths.js";
import {
  TAKT_WORKFLOW_MCP_SERVERS_KEY,
  TAKT_WORKFLOW_OVERRIDES_KEY,
} from "../../constants/takt-paths.js";
import type { ClaudeSettingsJson } from "../../types/claude-settings.js";
import type { Feature } from "../../types/features.js";
import { formatError } from "../../utils/error.js";
import type { Logger } from "../../utils/logger.js";
import {
  omitPrototypePollutionKeys,
  PROTOTYPE_POLLUTION_KEYS,
} from "../../utils/prototype-pollution.js";
import { isPlainObject } from "../../utils/type-guards.js";
import { loadYaml } from "../../utils/yaml.js";

/**
 * Single gateway for the shared config files that several rulesync features
 * read-modify-write (`.claude/settings.json`, `.hermes/config.yaml`,
 * `.takt/config.yaml`, `opencode.json`, ...). It unifies the three concerns
 * that used to be scattered across per-file helper modules
 * (claudecode-settings-gateway / hermes-config / takt-config / opencode-config):
 *
 * 1. **Format codecs** — parsing and serializing YAML/JSON/JSONC with one
 *    empty-file rule and one prototype-pollution hardening pass.
 * 2. **Conflict policies** — the named merge semantics a feature can declare
 *    (`replace-owned-keys`, `deep-merge`), implemented once instead of being
 *    re-spelled per tool (the takt `provider_options` sibling-clobber and the
 *    hermes-class merge bugs were re-implementations going subtly wrong).
 * 3. **Ownership declarations** — {@link SHARED_CONFIG_OWNERSHIP} states, per
 *    file and per feature, which keys the feature owns and which policy
 *    resolves conflicts. {@link applySharedConfigPatch} executes the declared
 *    policy, and rejects writes outside the declared ownership.
 *
 * The cross-feature *order* in which these writers run is derived from the
 * registry in `src/lib/shared-file-derive.ts` (`SHARED_WRITE_FEATURE_ORDER`),
 * and the no-data-loss contract is enforced end-to-end by
 * `src/lib/shared-file-contract.test.ts`.
 */

// ---------------------------------------------------------------------------
// Format codecs
// ---------------------------------------------------------------------------

export type SharedConfigFormat = "yaml" | "json" | "jsonc" | "toml";

export type SharedConfigDocument = Record<string, unknown>;

/**
 * How {@link parseSharedConfig} treats a syntactically valid document whose
 * root is not a mapping: coerce it to `{}` (tolerant readers) or throw
 * (writers that would otherwise silently discard the user's file).
 */
export type SharedConfigInvalidRootPolicy = "coerce-empty" | "error";

/**
 * How {@link parseSharedConfig} treats JSONC syntax errors: `tolerate` keeps
 * jsonc-parser's best-effort recovery (the historical opencode/kilo behavior),
 * `error` refuses to read-modify-write a file it could not fully parse
 * (fail-closed, so a partial parse can't silently drop user content on the
 * write-back).
 */
export type SharedConfigJsoncParseErrorsPolicy = "tolerate" | "error";

function sanitizeSharedConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeSharedConfigValue);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const result: SharedConfigDocument = {};
  for (const [key, nested] of Object.entries(omitPrototypePollutionKeys(value))) {
    result[key] = sanitizeSharedConfigValue(nested);
  }
  return result;
}

/**
 * Parse a shared config file into a plain document: an empty/whitespace file
 * is `{}`, prototype-pollution keys are dropped recursively, and a non-mapping
 * root follows `invalidRootPolicy`. Syntax errors are wrapped with the file
 * path when one is given.
 */
export function parseSharedConfig({
  format,
  fileContent,
  filePath,
  invalidRootPolicy = "coerce-empty",
  jsoncParseErrors = "tolerate",
}: {
  format: SharedConfigFormat;
  fileContent: string;
  filePath?: string | undefined;
  invalidRootPolicy?: SharedConfigInvalidRootPolicy;
  jsoncParseErrors?: SharedConfigJsoncParseErrorsPolicy;
}): SharedConfigDocument {
  if (fileContent.trim() === "") {
    return {};
  }

  const at = filePath === undefined ? "" : ` at ${filePath}`;
  let parsed: unknown;
  try {
    if (format === "yaml") {
      parsed = loadYaml(fileContent);
    } else if (format === "toml") {
      parsed = parseToml(fileContent);
    } else if (format === "json") {
      parsed = JSON.parse(fileContent);
    } else if (jsoncParseErrors === "error") {
      const errors: JsoncParseError[] = [];
      parsed = parseJsonc(fileContent, errors, { allowTrailingComma: true });
      if (errors.length > 0) {
        const details = errors
          .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
          .join(", ");
        throw new Error(details);
      }
    } else {
      parsed = parseJsonc(fileContent);
    }
  } catch (error) {
    throw new Error(`Failed to parse shared config${at}: ${formatError(error)}`, { cause: error });
  }

  if (parsed === undefined || parsed === null) {
    return {};
  }
  if (!isPlainObject(parsed)) {
    if (invalidRootPolicy === "error") {
      throw new Error(`Failed to parse shared config${at}: expected a mapping at the root`);
    }
    return {};
  }
  return sanitizeSharedConfigValue(parsed) as SharedConfigDocument;
}

/**
 * Serialize a shared config document. YAML output always ends with exactly one
 * newline; JSON output matches the 2-space `JSON.stringify` shape the JSON
 * writers have always emitted (no trailing newline); TOML output matches the
 * `smol-toml` `stringify` shape the TOML writers have always emitted.
 */
export function stringifySharedConfig({
  format,
  document,
}: {
  format: SharedConfigFormat;
  document: SharedConfigDocument;
}): string {
  if (format === "yaml") {
    return dump(document, { noRefs: true, sortKeys: false }).trimEnd() + "\n";
  }
  if (format === "toml") {
    return stringifyToml(document);
  }
  return JSON.stringify(document, null, 2);
}

// ---------------------------------------------------------------------------
// Conflict policies
// ---------------------------------------------------------------------------

/**
 * Shallow merge: every top-level key in `patch` replaces the base key
 * wholesale; all other base keys are preserved. The policy for a feature that
 * owns a fixed set of top-level keys.
 */
export function mergeSharedConfigShallow({
  base,
  patch,
}: {
  base: SharedConfigDocument;
  patch: SharedConfigDocument;
}): SharedConfigDocument {
  return { ...base, ...(sanitizeSharedConfigValue(patch) as SharedConfigDocument) };
}

/**
 * Deep merge (`patch` wins): nested plain objects are merged key-by-key; every
 * other value (arrays, scalars) is replaced wholesale. The policy for a
 * feature whose contribution interleaves with user-authored siblings at any
 * depth (e.g. permissions overlays onto `approvals`/`security` structures, or
 * per-provider option tables) — nested sibling keys are preserved by
 * construction instead of by per-tool re-implementation. Prototype-pollution
 * keys are dropped.
 */
export function mergeSharedConfigDeep({
  base,
  patch,
}: {
  base: SharedConfigDocument;
  patch: SharedConfigDocument;
}): SharedConfigDocument {
  const result: SharedConfigDocument = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    const baseValue = result[key];
    if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
      result[key] = mergeSharedConfigDeep({ base: baseValue, patch: patchValue });
    } else {
      result[key] = sanitizeSharedConfigValue(patchValue);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Ownership declarations
// ---------------------------------------------------------------------------

export type SharedConfigConflictPolicy =
  | {
      /** The feature owns `ownedKeys` outright; a patch may only set those. */
      readonly kind: "replace-owned-keys";
      readonly ownedKeys: readonly string[];
    }
  | {
      /**
       * The feature's patch deep-merges into the document; `replaceKeys` are
       * authoritative snapshots replaced wholesale (a deep merge would
       * resurrect entries the user deleted from the rulesync source).
       */
      readonly kind: "deep-merge";
      readonly replaceKeys?: readonly string[];
    }
  | {
      /**
       * The merge needs entry-level ownership rules that the generic policies
       * cannot express; `policyFunction` names the exported function in this
       * module that implements it.
       */
      readonly kind: "custom";
      readonly policyFunction: string;
    };

export type SharedConfigFileDeclaration = {
  readonly format: SharedConfigFormat;
  readonly invalidRootPolicy?: SharedConfigInvalidRootPolicy;
  readonly jsoncParseErrors?: SharedConfigJsoncParseErrorsPolicy;
  readonly features: Partial<Record<Feature, SharedConfigConflictPolicy>>;
};

// `dir/file` tokens matching `deriveSharedFileWriters()` — always POSIX
// separators, independent of the platform-specific path constants.
export const CLAUDE_SETTINGS_SHARED_FILE_KEY = ".claude/settings.json";
export const HERMES_CONFIG_SHARED_FILE_KEY = ".hermes/config.yaml";
export const TAKT_CONFIG_SHARED_FILE_KEY = ".takt/config.yaml";
export const CODEXCLI_CONFIG_SHARED_FILE_KEY = ".codex/config.toml";
export const GROKCLI_CONFIG_SHARED_FILE_KEY = ".grok/config.toml";
export const VIBE_CONFIG_SHARED_FILE_KEY = ".vibe/config.toml";
export const KIMI_CODE_CONFIG_SHARED_FILE_KEY = ".kimi-code/config.toml";
export const REASONIX_PROJECT_CONFIG_SHARED_FILE_KEY = "reasonix.toml";
export const REASONIX_GLOBAL_CONFIG_SHARED_FILE_KEY = ".reasonix/config.toml";

/**
 * Build the `SHARED_CONFIG_OWNERSHIP` lookup key from a tool's settable paths.
 * Mirrors `sharedFileKey` in `src/lib/shared-file-derive.ts` (kept separate so
 * feature classes don't pull the processor registry through this module and
 * create an import cycle); the ownership lock-step test keeps the two aligned.
 * Lets a tool whose file lives at a scope-dependent path (`.zed/settings.json`
 * vs `.config/zed/settings.json`) resolve its declaration from the settable
 * paths it already holds.
 */
export const sharedConfigFileKey = ({
  relativeDirPath,
  relativeFilePath,
}: {
  relativeDirPath: string;
  relativeFilePath: string;
}): string => {
  const dir = relativeDirPath.replace(/\\/g, "/").replace(/\/$/, "");
  const file = relativeFilePath.replace(/\\/g, "/");
  return dir === "" || dir === "." ? file : `${dir}/${file}`;
};

/**
 * Who owns what in each gateway-managed shared config file, and which policy
 * resolves conflicts. Keys are `dir/file` tokens matching
 * `deriveSharedFileWriters()`; a test keeps each entry's feature set in
 * lock-step with the writers derived from the processor registry, so an
 * undeclared writer fails CI instead of merging by accident.
 */
export const SHARED_CONFIG_OWNERSHIP: Readonly<Record<string, SharedConfigFileDeclaration>> = {
  [CLAUDE_SETTINGS_SHARED_FILE_KEY]: {
    format: "json",
    features: {
      // `Read(...)` deny entries inside `permissions.deny` are owned by ignore;
      // the permissions feature's explicit rules win over them (with a warning).
      // That entry-level rule lives in applyIgnoreReadDenies/applyPermissions.
      ignore: { kind: "custom", policyFunction: "applyIgnoreReadDenies" },
      hooks: { kind: "replace-owned-keys", ownedKeys: ["hooks"] },
      permissions: { kind: "custom", policyFunction: "applyPermissions" },
    },
  },
  [HERMES_CONFIG_SHARED_FILE_KEY]: {
    format: "yaml",
    features: {
      // The plugins block is recomputed from the existing file (enabled list
      // appended) before being applied, so the whole key is owned here.
      commands: { kind: "replace-owned-keys", ownedKeys: ["plugins"] },
      subagents: { kind: "replace-owned-keys", ownedKeys: ["plugins"] },
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp_servers"] },
      hooks: { kind: "replace-owned-keys", ownedKeys: ["hooks"] },
      // Deep-merged so `approvals.mode`-style user keys coexist with generated
      // `approvals.deny`; the `permissions` round-trip blob is an authoritative
      // snapshot and must not resurrect deleted rules.
      permissions: { kind: "deep-merge", replaceKeys: ["permissions"] },
    },
  },
  [TAKT_CONFIG_SHARED_FILE_KEY]: {
    format: "yaml",
    // config.yaml is the user's primary Takt config; refusing to parse a
    // non-mapping beats silently replacing their file with generated output.
    invalidRootPolicy: "error",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: [TAKT_WORKFLOW_MCP_SERVERS_KEY] },
      // The whole `workflow_overrides` block is derived from `.rulesync/checks/`,
      // so it is replaced rather than merged: a gate deleted there must not
      // survive in config.yaml.
      checks: { kind: "replace-owned-keys", ownedKeys: [TAKT_WORKFLOW_OVERRIDES_KEY] },
      // provider_profiles.<provider>.default_permission_mode plus the takt
      // override's step/provider tables merge into user config at depth;
      // deep-merge preserves nested sibling keys by construction.
      // The workflow security policies are authoritative snapshots of what the
      // rulesync source states: deep-merging them would keep a default-deny
      // capability switched on after the user revoked it.
      permissions: {
        kind: "deep-merge",
        replaceKeys: [
          "workflow_arpeggio",
          "workflow_runtime_prepare",
          "workflow_command_gates",
          "sync_conflict_resolver",
          "allow_git_hooks",
          "allow_git_filters",
        ],
      },
    },
  },
  // Zed settings: each feature holds an exclusive top-level key. Blocks whose
  // final value depends on existing entries (`private_files` appends patterns,
  // `agent.tool_permissions.tools` keeps user entries for unmanaged tools and
  // `agent` siblings) are recomputed from the existing file before being
  // applied, so the whole key is owned here.
  ".zed/settings.json": {
    format: "json",
    features: {
      ignore: { kind: "replace-owned-keys", ownedKeys: ["private_files"] },
      mcp: { kind: "replace-owned-keys", ownedKeys: ["context_servers"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["agent"] },
    },
  },
  // Global scope of the Zed settings above (ignore is project-scope-only).
  ".config/zed/settings.json": {
    format: "json",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["context_servers"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["agent"] },
    },
  },
  // VS Code workspace settings (`.vscode/settings.json`): a general-purpose
  // user/project settings file. Copilot permissions owns only the single flat
  // dotted key `chat.tools.terminal.autoApprove` (VS Code stores dotted setting
  // keys flat at the top level); every unrelated editor setting is preserved by
  // the shallow merge. The Copilot MCP feature writes a SEPARATE file
  // (`.vscode/mcp.json`), so this file has a single writer.
  ".vscode/settings.json": {
    format: "jsonc",
    // A general-purpose user file we promise to preserve untouched apart from
    // the one managed key. Refuse to read-modify-write a file we could not
    // fully parse (fail-closed), so a partial JSONC parse can never silently
    // drop unrelated user settings on the write-back — mirroring `.amp/`.
    invalidRootPolicy: "error",
    jsoncParseErrors: "error",
    features: {
      permissions: {
        kind: "replace-owned-keys",
        ownedKeys: ["chat.tools.terminal.autoApprove"],
      },
    },
  },
  // Qwen Code settings: `permissions` is recomputed from the existing file
  // (unmanaged-tool entries preserved, managed ones replaced) before being
  // applied, and so are the `tools`/`security` override groups. Keys like
  // `disableAllHooks` are only present in the patch when authored, so an
  // existing user value survives an unrelated regeneration.
  ".qwen/settings.json": {
    format: "json",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcpServers"] },
      hooks: { kind: "replace-owned-keys", ownedKeys: ["hooks", "disableAllHooks"] },
      permissions: {
        kind: "replace-owned-keys",
        ownedKeys: ["permissions", "tools", "security"],
      },
    },
  },
  // AugmentCode settings: `toolPermissions` is recomputed from the existing
  // file (special entries and fail-closed denies preserved) before being
  // applied.
  ".augment/settings.json": {
    format: "json",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcpServers"] },
      hooks: { kind: "replace-owned-keys", ownedKeys: ["hooks"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["toolPermissions"] },
    },
  },
  // Devin config: `permissions` is recomputed from the existing file
  // (unmanaged-scope entries preserved) before being applied. Hooks are
  // global-scope-only, so they appear only under `.config/devin/`.
  ".devin/config.json": {
    format: "json",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcpServers"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["permissions"] },
    },
  },
  ".config/devin/config.json": {
    format: "json",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcpServers"] },
      hooks: { kind: "replace-owned-keys", ownedKeys: ["hooks"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["permissions"] },
    },
  },
  // Kiro agent config: `allowedTools`/`toolsSettings` are recomputed from the
  // existing file (existing tools and settings folded in) before being applied.
  ".kiro/agents/default.json": {
    format: "json",
    features: {
      hooks: { kind: "replace-owned-keys", ownedKeys: ["hooks"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["allowedTools", "toolsSettings"] },
    },
  },
  // Amp settings (`settings.json`, or a hand-authored `settings.jsonc` twin the
  // writers probe for — both resolve to this declaration via the settable
  // paths). Keys are Amp's literal dotted names. `amp.permissions` is
  // recomputed from the existing file (fail-closed first-match-wins ordering,
  // authored/delegate entries folded in) before being applied, and is retracted
  // when the merge yields no entries. Amp's writers have always refused to
  // write over a file they could not fully parse, hence the strict policies.
  ".amp/settings.json": {
    format: "jsonc",
    invalidRootPolicy: "error",
    jsoncParseErrors: "error",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["amp.mcpServers"] },
      permissions: {
        kind: "replace-owned-keys",
        ownedKeys: [
          "amp.tools.disable",
          "amp.permissions",
          "amp.guardedFiles.allowlist",
          "amp.dangerouslyAllowAll",
          "amp.mcpPermissions",
        ],
      },
    },
  },
  ".config/amp/settings.json": {
    format: "jsonc",
    invalidRootPolicy: "error",
    jsoncParseErrors: "error",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["amp.mcpServers"] },
      permissions: {
        kind: "replace-owned-keys",
        ownedKeys: [
          "amp.tools.disable",
          "amp.permissions",
          "amp.guardedFiles.allowlist",
          "amp.dangerouslyAllowAll",
          "amp.mcpPermissions",
        ],
      },
    },
  },
  // OpenCode config (`opencode.json`, or the preferred `opencode.jsonc` twin —
  // both resolve here via the settable paths). `tools` is retracted when the
  // generated MCP servers yield no tool filters; `permission` and
  // `instructions` are recomputed from source/existing content before being
  // applied. Rules (`instructions`) are project-scope-only.
  "opencode.json": {
    format: "jsonc",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp", "tools"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["permission"] },
      rules: { kind: "replace-owned-keys", ownedKeys: ["instructions"] },
    },
  },
  ".config/opencode/opencode.json": {
    format: "jsonc",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp", "tools"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["permission"] },
    },
  },
  // Kilo config (`kilo.json` / preferred `kilo.jsonc` twin) — same shape as
  // OpenCode: `tools` is retracted when empty, `instructions` is recomputed
  // from the existing list before being applied.
  "kilo.json": {
    format: "jsonc",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp", "tools"] },
      rules: { kind: "replace-owned-keys", ownedKeys: ["instructions"] },
    },
  },
  // Global Kilo config: mcp is its only writer (rules registers instructions in
  // project scope only), so this is not cross-feature shared — it is declared
  // anyway so the write goes through the same codec and ownership enforcement.
  ".config/kilo/kilo.json": {
    format: "jsonc",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp", "tools"] },
    },
  },
  // Codex CLI config: hooks/mcp/permissions each own an exclusive top-level
  // key. `features` (hooks' legacy `codex_hooks` cleanup) and `mcp_servers`
  // (per-server approval-state preservation) are recomputed from the existing
  // file before being applied, so the whole key is owned here.
  [CODEXCLI_CONFIG_SHARED_FILE_KEY]: {
    format: "toml",
    features: {
      hooks: { kind: "replace-owned-keys", ownedKeys: ["features"] },
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp_servers"] },
      permissions: {
        kind: "replace-owned-keys",
        ownedKeys: ["permissions", "default_permissions", ...CODEXCLI_OVERRIDE_KEYS],
      },
    },
  },
  // Grok Build CLI config: mcp owns `mcp_servers`; permissions owns the
  // fine-grained `permission` allow/ask/deny arrays and the coarse `ui`
  // fallback. Both are recomputed from the existing file (unmanaged entries
  // preserved) before being applied.
  [GROKCLI_CONFIG_SHARED_FILE_KEY]: {
    format: "toml",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp_servers"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["permission", "ui"] },
    },
  },
  // Mistral Vibe config: mcp
  // owns `mcp_servers`; permissions owns `tools`/`enabled_tools`/`disabled_tools`.
  // `tools` is recomputed from the existing file (unmanaged tool entries and
  // sensitive-pattern overrides preserved) before being applied.
  [VIBE_CONFIG_SHARED_FILE_KEY]: {
    format: "toml",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp_servers"] },
      permissions: {
        kind: "replace-owned-keys",
        ownedKeys: ["tools", "enabled_tools", "disabled_tools"],
      },
    },
  },
  // Kimi Code's user config: hooks owns the flat `hooks` array; permissions
  // owns the ordered rule list and optional coarse default mode.
  [KIMI_CODE_CONFIG_SHARED_FILE_KEY]: {
    format: "toml",
    invalidRootPolicy: "error",
    features: {
      hooks: { kind: "replace-owned-keys", ownedKeys: ["hooks"] },
      // `mcp` holds the global default MCP timeouts; the servers themselves
      // live in `mcp.json`, so this feature reaches the file as an auxiliary
      // writer (same shape as vibe hooks above).
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp"] },
      permissions: {
        kind: "replace-owned-keys",
        // `tools` is Kimi's global tool allow/deny switch, a second enforcement
        // layer alongside `permission.rules`.
        ownedKeys: ["permission", "default_permission_mode", "tools"],
      },
    },
  },
  // Reasonix project config (`./reasonix.toml`): mcp owns `plugins`;
  // permissions owns `permissions`/`sandbox`/`agent`. All three are recomputed
  // from the existing file (unmanaged entries and sibling override keys
  // preserved) before being applied.
  [REASONIX_PROJECT_CONFIG_SHARED_FILE_KEY]: {
    format: "toml",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["plugins"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["permissions", "sandbox", "agent"] },
    },
  },
  // Reasonix global config (`~/.reasonix/config.toml`) — same shape as the
  // project file above.
  [REASONIX_GLOBAL_CONFIG_SHARED_FILE_KEY]: {
    format: "toml",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["plugins"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["permissions", "sandbox", "agent"] },
    },
  },
};

/**
 * Execute a feature's declared write to a gateway-managed shared file: parse
 * the existing content, merge the patch under the feature's declared policy,
 * and serialize. Throws when the file or feature is undeclared, when a
 * `replace-owned-keys` patch strays outside its owned keys, or when the
 * feature's policy is `custom` (those calls go to the named policy function
 * instead).
 */
export function applySharedConfigPatch({
  fileKey,
  feature,
  existingContent,
  patch,
  filePath,
}: {
  fileKey: string;
  feature: Feature;
  existingContent: string;
  patch: SharedConfigDocument;
  filePath?: string | undefined;
}): string {
  const declaration = SHARED_CONFIG_OWNERSHIP[fileKey];
  if (!declaration) {
    throw new Error(
      `Shared config file '${fileKey}' has no SHARED_CONFIG_OWNERSHIP declaration; ` +
        `declare its writers and policies before writing it through the gateway.`,
    );
  }
  const policy = declaration.features[feature];
  if (!policy) {
    throw new Error(
      `Feature '${feature}' declares no ownership of '${fileKey}'; ` +
        `add it to SHARED_CONFIG_OWNERSHIP before writing.`,
    );
  }
  if (policy.kind === "custom") {
    throw new Error(
      `Feature '${feature}' writes '${fileKey}' through its dedicated policy function ` +
        `'${policy.policyFunction}' in shared-config-gateway.ts, not applySharedConfigPatch.`,
    );
  }

  const base = parseSharedConfig({
    format: declaration.format,
    fileContent: existingContent,
    filePath,
    ...(declaration.invalidRootPolicy !== undefined && {
      invalidRootPolicy: declaration.invalidRootPolicy,
    }),
    ...(declaration.jsoncParseErrors !== undefined && {
      jsoncParseErrors: declaration.jsoncParseErrors,
    }),
  });

  if (policy.kind === "replace-owned-keys") {
    const unowned = Object.keys(patch).filter((key) => !policy.ownedKeys.includes(key));
    if (unowned.length > 0) {
      throw new Error(
        `Feature '${feature}' tried to write undeclared keys [${unowned.join(", ")}] to ` +
          `'${fileKey}'; extend its ownedKeys declaration if that ownership is intended.`,
      );
    }
    // An owned key set to `undefined` is removed from the document — the way a
    // feature retracts a key it owns (e.g. a regeneration that yields no
    // entries) without ever being able to touch keys it doesn't own.
    const document = mergeSharedConfigShallow({ base, patch });
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) {
        delete document[key];
      }
    }
    return stringifySharedConfig({ format: declaration.format, document });
  }

  const merged = mergeSharedConfigDeep({ base, patch });
  for (const key of policy.replaceKeys ?? []) {
    if (patch[key] !== undefined) {
      merged[key] = sanitizeSharedConfigValue(patch[key]);
    }
  }
  return stringifySharedConfig({ format: declaration.format, document: merged });
}

// ---------------------------------------------------------------------------
// `.claude/settings.json` custom policy
// ---------------------------------------------------------------------------
// Both `ignore` (writes `Read(...)` into `permissions.deny`) and `permissions`
// (writes the whole `allow`/`ask`/`deny`) read-modify-write the `permissions`
// block. The entry format, the merge, and the cross-feature ownership rule
// (permissions' explicit `Read` rules win over ignore-derived `Read` denies)
// live here once so each feature just states its intent and never reasons
// about the other's existence.

const READ_TOOL_NAME = "Read";

export const isReadDenyEntry = (entry: string): boolean =>
  entry.startsWith(`${READ_TOOL_NAME}(`) && entry.endsWith(")");

export const buildReadDenyEntry = (pattern: string): string => `${READ_TOOL_NAME}(${pattern})`;

const parsePermissionsBlock = (
  settings: ClaudeSettingsJson,
): { allow: string[]; ask: string[]; deny: string[] } => {
  const permissions = settings.permissions ?? {};
  return {
    allow: permissions.allow ?? [],
    ask: permissions.ask ?? [],
    deny: permissions.deny ?? [],
  };
};

// Empty arrays are omitted so the file never carries an empty allow/ask/deny key.
// Other top-level keys (e.g. `hooks`) and other keys under `permissions` are kept.
const withPermissions = (
  settings: ClaudeSettingsJson,
  next: { allow: string[]; ask: string[]; deny: string[] },
): ClaudeSettingsJson => {
  const permissions: Record<string, unknown> = { ...settings.permissions };
  const assign = (key: "allow" | "ask" | "deny", values: string[]): void => {
    if (values.length > 0) {
      permissions[key] = values;
    } else {
      delete permissions[key];
    }
  };
  assign("allow", next.allow);
  assign("ask", next.ask);
  assign("deny", next.deny);
  return { ...settings, permissions };
};

// Non-`Read` deny entries belong to the permissions feature and are preserved;
// `Read(...)` denies are replaced wholesale since the ignore source owns them.
export const applyIgnoreReadDenies = (params: {
  settings: ClaudeSettingsJson;
  readDenies: string[];
}): ClaudeSettingsJson => {
  const { settings, readDenies } = params;
  const current = parsePermissionsBlock(settings);
  const preservedDeny = current.deny.filter(
    (entry) => !isReadDenyEntry(entry) || readDenies.includes(entry),
  );
  return withPermissions(settings, {
    allow: current.allow,
    ask: current.ask,
    deny: uniq([...preservedDeny, ...readDenies].toSorted()),
  });
};

// Entries for managed tools are replaced; entries for unmanaged tools are kept.
// When `Read` is managed, permissions' rules win over ignore-derived `Read(...)`
// denies — those are overwritten, and the overwrite is warned about if a logger
// is given.
export const applyPermissions = (params: {
  settings: ClaudeSettingsJson;
  managedToolNames: ReadonlySet<string>;
  toolNameOf: (entry: string) => string;
  allow: string[];
  ask: string[];
  deny: string[];
  logger?: Logger | undefined;
}): ClaudeSettingsJson => {
  const { settings, managedToolNames, toolNameOf, allow, ask, deny, logger } = params;
  const current = parsePermissionsBlock(settings);

  const keepUnmanaged = (entries: string[]): string[] =>
    entries.filter((entry) => !managedToolNames.has(toolNameOf(entry)));

  if (logger && managedToolNames.has(READ_TOOL_NAME)) {
    const overwrittenReadDenies = current.deny.filter(
      (entry) => toolNameOf(entry) === READ_TOOL_NAME,
    );
    if (overwrittenReadDenies.length > 0) {
      logger.warn(
        `Permissions feature manages '${READ_TOOL_NAME}' tool and will overwrite ` +
          `${overwrittenReadDenies.length} existing ${READ_TOOL_NAME} deny entries. ` +
          `Permissions take precedence.`,
      );
    }
  }

  return withPermissions(settings, {
    allow: uniq([...keepUnmanaged(current.allow), ...allow].toSorted()),
    ask: uniq([...keepUnmanaged(current.ask), ...ask].toSorted()),
    deny: uniq([...keepUnmanaged(current.deny), ...deny].toSorted()),
  });
};

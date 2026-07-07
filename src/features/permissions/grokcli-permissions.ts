import { join } from "node:path";

import { uniq } from "es-toolkit";
import * as smolToml from "smol-toml";

import { GROKCLI_CONFIG_FILE_NAME, GROKCLI_DIR } from "../../constants/grokcli-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

const GROKCLI_GLOBAL_ONLY_MESSAGE =
  "Grok CLI permissions are global-only; use --global to sync ~/.grok/config.toml";

// Grok stores the coarse permission toggle as `[ui] permission_mode` in
// config.toml (kept as a backward-compatible fallback) and the fine-grained
// rules as Claude-style entries under the `[permission]` allow/deny/ask arrays.
// https://docs.x.ai/build/settings/reference
// https://docs.x.ai/build/modes-and-commands
const GROKCLI_UI_KEY = "ui";
const GROKCLI_PERMISSION_MODE_KEY = "permission_mode";
const GROKCLI_PERMISSION_KEY = "permission";

type GrokPermissionMode = "ask" | "always-approve";

// rulesync canonical catch-all pattern (Grok's coarse mode is global, so only a
// catch-all maps cleanly back on import from `permission_mode`).
const CATCH_ALL_PATTERN = "*";

const MCP_CANONICAL_PREFIX = "mcp__";

// Canonical category ⇒ Grok Claude-style tool prefix. Grok exposes no separate
// `Write` tool (writes gate through `Edit`), so `write` collapses onto `Edit`;
// categories with no Grok tool (`websearch`, `glob`, `notebookedit`, `agent`)
// are skipped. MCP categories are handled separately (see `buildGrokEntry`).
const CATEGORY_TO_GROK_TOOL: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Edit",
  grep: "Grep",
  webfetch: "WebFetch",
};

// Grok tool prefix ⇒ canonical category (inverse of the above; `write` is not
// recovered because it collapses onto `Edit` on export — a documented lossy
// mapping). `MCPTool` is handled separately in `parseGrokEntry`.
const GROK_TOOL_TO_CATEGORY: Record<string, string> = {
  Bash: "bash",
  Read: "read",
  Edit: "edit",
  Grep: "grep",
  WebFetch: "webfetch",
};

const GROK_MCP_TOOL = "MCPTool";

/**
 * Build a Grok Claude-style permission entry (e.g. `Bash(git *)`, `Read`,
 * `MCPTool(server__tool)`) from a canonical category + pattern. Returns `null`
 * for categories Grok cannot express so callers can skip them.
 *
 * Scoped MCP categories (`mcp__<remainder>`) fold their address into the
 * parentheses (`MCPTool(<remainder>)`); the bare `mcp` category becomes
 * `MCPTool`. For every other tool, a `*` pattern emits the bare tool name and a
 * concrete pattern emits `Tool(pattern)`.
 */
function buildGrokEntry(category: string, pattern: string): string | null {
  if (category.startsWith(MCP_CANONICAL_PREFIX)) {
    const remainder = category.slice(MCP_CANONICAL_PREFIX.length);
    return remainder.length > 0 ? `${GROK_MCP_TOOL}(${remainder})` : GROK_MCP_TOOL;
  }
  if (category === "mcp") {
    return pattern === CATCH_ALL_PATTERN || pattern === ""
      ? GROK_MCP_TOOL
      : `${GROK_MCP_TOOL}(${pattern})`;
  }
  const tool = CATEGORY_TO_GROK_TOOL[category];
  if (tool === undefined) {
    return null;
  }
  return pattern === CATCH_ALL_PATTERN || pattern === "" ? tool : `${tool}(${pattern})`;
}

/**
 * Parse a Grok Claude-style permission entry back into a canonical category +
 * pattern. Entries without parentheses are treated as catch-all (`*`). Returns
 * `null` for tool prefixes with no canonical equivalent (e.g. `any`).
 */
function parseGrokEntry(entry: string): { category: string; pattern: string } | null {
  const trimmed = entry.trim();
  const parenIndex = trimmed.indexOf("(");
  let tool: string;
  let inner: string;
  if (parenIndex === -1 || !trimmed.endsWith(")")) {
    tool = trimmed;
    inner = "";
  } else {
    tool = trimmed.slice(0, parenIndex);
    inner = trimmed.slice(parenIndex + 1, -1).trim();
  }

  if (tool === GROK_MCP_TOOL) {
    return inner.length > 0
      ? { category: `${MCP_CANONICAL_PREFIX}${inner}`, pattern: CATCH_ALL_PATTERN }
      : { category: "mcp", pattern: CATCH_ALL_PATTERN };
  }

  const category = GROK_TOOL_TO_CATEGORY[tool];
  if (category === undefined) {
    return null;
  }
  return { category, pattern: inner.length > 0 ? inner : CATCH_ALL_PATTERN };
}

/**
 * Permissions adapter for the xAI Grok Build CLI (`grokcli`).
 *
 * Grok Build CLI ships a Claude-style rule system under `[permission]` in
 * `~/.grok/config.toml`: `allow` / `deny` / `ask` arrays of entries such as
 * `Bash(git *)`, `Read(src/**)`, `Edit`, `Grep`, `MCPTool(server__tool)`, and
 * `WebFetch`, evaluated with precedence `deny > ask > allow`
 * (https://docs.x.ai/build/settings/reference). rulesync's canonical
 * per-category, per-pattern model maps almost 1:1:
 *   - Generate: each `permission.<category>.<pattern> = allow|ask|deny` becomes
 *     the matching Grok entry and is bucketed into the `[permission]` array for
 *     that action. `bash|read|edit|grep|webfetch` map to their Grok tool;
 *     `write` collapses onto `Edit` (Grok has no `Write` tool); `mcp__*` maps to
 *     `MCPTool(...)` (a scoped MCP category folds its address into the
 *     parentheses, so a non-`*` argument pattern on it is not represented).
 *     Categories with no Grok tool (`websearch`, `glob`, `notebookedit`,
 *     `agent`) are skipped (with a warning when they carry a `deny` rule, to
 *     surface the gap). When two canonical rules collapse onto the same Grok
 *     entry with different actions (e.g. `edit` allow + `write` deny → `Edit`),
 *     the strictest wins (`deny > ask > allow`) and a warning is logged, so the
 *     entry never lands contradictorily in two arrays.
 *   - Import: the `[permission]` arrays are parsed back into canonical
 *     categories. When no `[permission]` section is present (older configs), the
 *     coarse `[ui] permission_mode` is used as a fallback.
 *
 * The coarse `[ui] permission_mode` toggle is still written for backward
 * compatibility with older Grok versions: `always-approve` when the config is
 * pure-`allow`, otherwise `ask` (conservative — it is never `always-approve`
 * while any `deny`/`ask` rule exists, so it never contradicts the fine-grained
 * arrays).
 *
 * This surface is **global only** — the adapter syncs the user-level
 * `~/.grok/config.toml`. (Grok also supports a project-scoped `[permission]`
 * file; project scope is not modeled here.) The shared config is merged in
 * place: rulesync owns the `[permission]` `allow`/`deny`/`ask` entries for the
 * tools it models and the `[ui] permission_mode` value, while every other key
 * (e.g. `[mcp_servers]`, `[permission] rules`, `[sandbox]`) and any user-authored
 * entries for tools rulesync cannot model (e.g. `WebSearch`) are preserved. The
 * file is never deleted.
 */
export class GrokcliPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
    });
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: GROKCLI_DIR,
      relativeFilePath: GROKCLI_CONFIG_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<GrokcliPermissions> {
    if (!global) {
      throw new Error(GROKCLI_GLOBAL_ONLY_MESSAGE);
    }
    const paths = GrokcliPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";
    return new GrokcliPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global: true,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    logger,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<GrokcliPermissions> {
    if (!global) {
      throw new Error(GROKCLI_GLOBAL_ONLY_MESSAGE);
    }
    const paths = GrokcliPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so a dry-run/check does not create the user's
    // global config.toml as a side effect (mirrors the Goose adapter).
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";

    let parsed: smolToml.TomlTable;
    try {
      parsed = existingContent.trim() === "" ? {} : smolToml.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Grok config.toml at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();

    // Fine-grained `[permission]` arrays (the high-fidelity surface). rulesync
    // owns the entries for the tools it models; other `[permission]` keys (e.g.
    // verbose `rules`) and user-authored entries for tools rulesync cannot model
    // (e.g. `WebSearch`) are preserved.
    const existingPermission = isRecord(parsed[GROKCLI_PERMISSION_KEY])
      ? parsed[GROKCLI_PERMISSION_KEY]
      : {};
    const buckets = buildGrokPermissionArrays(config, existingPermission, logger);
    parsed[GROKCLI_PERMISSION_KEY] = {
      ...existingPermission,
      allow: buckets.allow,
      deny: buckets.deny,
      ask: buckets.ask,
    } as smolToml.TomlTable;

    // Coarse `[ui] permission_mode` fallback for older Grok versions.
    const mode = deriveGrokPermissionMode(config);
    const existingUi = isRecord(parsed[GROKCLI_UI_KEY]) ? parsed[GROKCLI_UI_KEY] : {};
    parsed[GROKCLI_UI_KEY] = {
      ...existingUi,
      [GROKCLI_PERMISSION_MODE_KEY]: mode,
    } as smolToml.TomlTable;

    return new GrokcliPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: smolToml.stringify(parsed),
      validate: true,
      global: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let parsed: smolToml.TomlTable;
    try {
      const content = this.getFileContent();
      parsed = content.trim() === "" ? {} : smolToml.parse(content);
    } catch (error) {
      throw new Error(
        `Failed to parse Grok config.toml content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const permission = isRecord(parsed[GROKCLI_PERMISSION_KEY])
      ? parsed[GROKCLI_PERMISSION_KEY]
      : {};
    const fineGrained = parseGrokPermissionArrays(permission);

    // Prefer the fine-grained `[permission]` arrays when present; fall back to
    // the coarse `[ui] permission_mode` for older configs that have neither.
    const rulesyncConfig: PermissionsConfig = fineGrained
      ? { permission: fineGrained }
      : { permission: { bash: { [CATCH_ALL_PATTERN]: legacyModeAction(parsed) } } };

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(rulesyncConfig, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): GrokcliPermissions {
    return new GrokcliPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global: true,
    });
  }
}

// Grok's documented evaluation precedence, `deny > ask > allow`. Used to
// resolve the case where two canonical rules collapse onto the same Grok entry
// (e.g. `edit` and `write` both map to `Edit`): the strictest action wins, so
// only one non-contradictory entry is emitted.
const ACTION_RANK: Record<PermissionAction, number> = { allow: 0, ask: 1, deny: 2 };

/**
 * Collect user-authored entries from an existing `[permission]` array whose
 * tool prefix rulesync cannot model (e.g. `WebSearch`, `any`). Such entries are
 * preserved verbatim so replacing the arrays does not silently drop them
 * (mirrors the Cursor adapter's preservation of unmanaged types).
 */
function unmanagedEntries(existingPermission: Record<string, unknown>, key: string): string[] {
  const arr = isStringArray(existingPermission[key]) ? existingPermission[key] : [];
  return arr.filter((entry) => parseGrokEntry(entry) === null);
}

/**
 * Bucket canonical rules into Grok's `[permission]` allow/deny/ask arrays of
 * Claude-style entries, resolving collapse collisions via `deny > ask > allow`.
 * Categories Grok cannot express are skipped (with a warning when they carry a
 * `deny` rule); entries the user authored for tools rulesync cannot model are
 * preserved from `existingPermission`.
 */
function buildGrokPermissionArrays(
  config: PermissionsConfig,
  existingPermission: Record<string, unknown>,
  logger?: Logger,
): { allow: string[]; deny: string[]; ask: string[] } {
  // Map each managed entry to a single action; on collision keep the strictest
  // (and warn), so no entry ends up contradictorily in two arrays.
  const ranked = new Map<string, PermissionAction>();
  for (const [category, rules] of Object.entries(config.permission)) {
    for (const [pattern, action] of Object.entries(rules)) {
      const entry = buildGrokEntry(category, pattern);
      if (entry === null) {
        if (action === "deny" && logger) {
          logger.warn(
            `Grok CLI has no permission tool for the '${category}' category; ` +
              `its 'deny' rule could not be represented and was skipped.`,
          );
        }
        continue;
      }
      const existing = ranked.get(entry);
      if (existing !== undefined && existing !== action) {
        logger?.warn(
          `Grok permission entry '${entry}' received conflicting actions ` +
            `('${existing}' and '${action}'); keeping the stricter one (deny > ask > allow).`,
        );
      }
      if (existing === undefined || ACTION_RANK[action] > ACTION_RANK[existing]) {
        ranked.set(entry, action);
      }
    }
  }

  const allow = unmanagedEntries(existingPermission, "allow");
  const deny = unmanagedEntries(existingPermission, "deny");
  const ask = unmanagedEntries(existingPermission, "ask");
  for (const [entry, action] of ranked) {
    if (action === "allow") allow.push(entry);
    else if (action === "deny") deny.push(entry);
    else ask.push(entry);
  }

  return { allow: uniq(allow.toSorted()), deny: uniq(deny.toSorted()), ask: uniq(ask.toSorted()) };
}

/**
 * Parse Grok's `[permission]` allow/deny/ask arrays back into a canonical
 * permission map. Returns `null` when the section defines none of the three
 * arrays, so the caller can fall back to the coarse `permission_mode`.
 * Precedence `deny > ask > allow` is applied so a tool listed in multiple
 * arrays resolves to the strictest action.
 */
function parseGrokPermissionArrays(
  permission: Record<string, unknown>,
): Record<string, Record<string, PermissionAction>> | null {
  const allow = isStringArray(permission.allow) ? permission.allow : undefined;
  const deny = isStringArray(permission.deny) ? permission.deny : undefined;
  const ask = isStringArray(permission.ask) ? permission.ask : undefined;
  // Treat absent *and* all-empty arrays as "no fine-grained rules" so the
  // coarse `permission_mode` fallback still applies (a freshly generated
  // empty config writes empty arrays alongside the mode).
  const total = (allow?.length ?? 0) + (deny?.length ?? 0) + (ask?.length ?? 0);
  if (total === 0) {
    return null;
  }

  const result: Record<string, Record<string, PermissionAction>> = {};
  const apply = (entries: string[] | undefined, action: PermissionAction) => {
    for (const entry of entries ?? []) {
      const parsed = parseGrokEntry(entry);
      if (parsed === null) continue;
      const bucket = (result[parsed.category] ??= {});
      bucket[parsed.pattern] = action;
    }
  };
  // Apply weakest first so stricter actions overwrite on collision
  // (deny > ask > allow).
  apply(allow, "allow");
  apply(ask, "ask");
  apply(deny, "deny");

  return result;
}

/**
 * Legacy coarse fallback: map `[ui] permission_mode` to a canonical action.
 * `always-approve` ⇒ `allow`; anything else (including a missing mode) ⇒ `ask`.
 */
function legacyModeAction(parsed: smolToml.TomlTable): PermissionAction {
  const ui = isRecord(parsed[GROKCLI_UI_KEY]) ? parsed[GROKCLI_UI_KEY] : {};
  return ui[GROKCLI_PERMISSION_MODE_KEY] === "always-approve" ? "allow" : "ask";
}

/**
 * Collapse a rulesync permissions config into Grok's single coarse mode.
 * Any `deny`/`ask` rule anywhere keeps prompting (`ask`); otherwise an existing
 * `allow` rule opts into `always-approve`; an empty config defaults to `ask`.
 */
function deriveGrokPermissionMode(config: PermissionsConfig): GrokPermissionMode {
  let hasAllow = false;

  for (const rules of Object.values(config.permission)) {
    for (const action of Object.values(rules)) {
      if (action === "deny" || action === "ask") {
        return "ask";
      }
      if (action === "allow") {
        hasAllow = true;
      }
    }
  }

  return hasAllow ? "always-approve" : "ask";
}

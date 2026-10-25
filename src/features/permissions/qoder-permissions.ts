// cspell:ignore acceptedits bypasspermissions -- lower-cased Qoder permission mode aliases
import { join } from "node:path";

import { QODER_DIR, QODER_SETTINGS_FILE_NAME } from "../../constants/qoder-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { isRecord } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import { ALL_TOOLS_PERMISSION_CATEGORY, honorAllToolsOnBash } from "./shell-command-categories.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/** Top-level key of `.qoder/settings.json` that rulesync owns. */
const QODER_PERMISSIONS_KEY = "permissions";

/**
 * Top-level key the `qoder` override authors: the active output style. Qoder
 * also reads `general.outputStyle`, but the top-level key wins, so that is the
 * one written and imported.
 * @see https://docs.qoder.com/cli/settings-reference
 */
const QODER_OUTPUT_STYLE_KEY = "outputStyle";

/**
 * The settings groups the `qoder` override may author, each with the only keys
 * of that group rulesync writes and imports. A group's other keys are kept as
 * the file has them; an override key not listed here is skipped with a
 * warning, so a shared permissions file cannot reach `tools.shell.pager`,
 * `general.preferredEditor` and the like.
 * @see https://docs.qoder.com/cli/settings-reference
 */
const QODER_OVERRIDE_GROUP_KEYS = {
  general: ["defaultPermissionMode"],
  tools: ["core", "exclude"],
  mcp: [
    "allowed",
    "excluded",
    "enableAllProjectMcpServers",
    "enabledProjectMcpServers",
    "lazyLoad",
  ],
  agents: ["overrides"],
} as const satisfies Record<string, readonly string[]>;

type QoderOverrideGroup = keyof typeof QODER_OVERRIDE_GROUP_KEYS;

const QODER_OVERRIDE_GROUPS = Object.keys(QODER_OVERRIDE_GROUP_KEYS) as QoderOverrideGroup[];

/**
 * Top-level Auto-mode classifier guidance. Qoder reads it from the user
 * settings only (a workspace file could otherwise bias the classifier), so it
 * is written and imported in global mode alone.
 * @see https://docs.qoder.com/en/cli/permissions
 */
const QODER_AUTO_MODE_KEY = "autoMode";

/** The `autoMode` keys rulesync writes and imports. */
const QODER_AUTO_MODE_KEYS = ["allow", "soft_deny", "environment"] as const;

/** Top-level globs that keep project/local memory files from loading. */
const QODER_AGENTS_MD_EXCLUDES_KEY = "agentsMdExcludes";

/**
 * `general.defaultPermissionMode` values (lower-cased; Qoder matches them
 * case-insensitively) that let actions run without a prompt.
 * @see https://docs.qoder.com/en/cli/permissions
 */
const QODER_PERMISSIVE_MODES = new Set([
  "accept_edits",
  "acceptedits",
  "auto",
  "bypass_permissions",
  "bypasspermissions",
  "yolo",
]);

const CATCH_ALL_PATTERN = "*";

/** Prefix of the fully qualified MCP tool names (`mcp__<server>__<tool>`). */
const MCP_TOOL_PREFIX = "mcp__";

// Canonical category ⇒ Qoder permission tool name: the canonical tool names
// the Qoder permission docs list. Other categories are skipped with a warning.
const CATEGORY_TO_QODER_TOOL: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  grep: "Grep",
  glob: "Glob",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  agent: "Agent",
};

const QODER_TOOL_TO_CATEGORY: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_TO_QODER_TOOL).map(([category, tool]) => [tool, category]),
);

/**
 * Qoder checks path-scoped writes against `Edit(...)` rules (covering `Edit`,
 * `Write` and `NotebookEdit`) and path-scoped reads against `Read(...)` rules,
 * so a `write` or `glob` rule with a path is written in that form. Qoder does
 * not document `Glob` payloads; the `Glob` -> `Read` alias follows Claude
 * Code, whose permission model Qoder mirrors. A tool-name rule with no path
 * keeps its own tool name.
 */
const QODER_PATH_RULE_ALIASES: Record<string, string> = {
  Write: "Edit",
  Glob: "Read",
};

const ACTIONS: readonly PermissionAction[] = ["allow", "ask", "deny"];

const ACTION_RANK: Record<PermissionAction, number> = { allow: 0, ask: 1, deny: 2 };

function toStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Split a rule into `Tool(payload)` or a bare `Tool`. A rule that opens a
 * parenthesis without closing it gets a `null` tool so it stays unmodeled.
 */
function splitQoderRule(rule: string): { tool: string | null; payload: string | undefined } {
  const match = rule.match(/^([^(]+)\(([\s\S]*)\)$/);
  if (match) {
    return { tool: match[1] ?? null, payload: match[2] };
  }
  return { tool: rule.includes("(") ? null : rule, payload: undefined };
}

/** The canonical category a Qoder rule belongs to, or `undefined` if unmodeled. */
function categoryOfRule(rule: string): string | undefined {
  const { tool } = splitQoderRule(rule);
  if (tool === null) {
    return undefined;
  }
  if (tool === ALL_TOOLS_PERMISSION_CATEGORY || tool.startsWith(MCP_TOOL_PREFIX)) {
    return tool;
  }
  return Object.hasOwn(QODER_TOOL_TO_CATEGORY, tool) ? QODER_TOOL_TO_CATEGORY[tool] : undefined;
}

/**
 * Translate one canonical rule into a Qoder rule, or `null` (with a warning)
 * when Qoder has no spelling for it.
 *
 * - The all-tools `*` category is Qoder's bare `*` rule; a narrower pattern
 *   under it names no single tool and is skipped (its shell restrictions
 *   already reached `bash` through `honorAllToolsOnBash`).
 * - An `mcp__...` category is a fully qualified MCP tool name (or a Qoder MCP
 *   wildcard like `mcp__github__*`) and only takes the catch-all pattern.
 * - Every other category maps to its Qoder tool name; `*` is the bare tool
 *   and anything else is written verbatim as the payload (Qoder matches Bash
 *   payloads as exact commands, `:*` prefixes or globs, and file payloads as
 *   gitignore-style paths).
 */
function toQoderRule({
  category,
  pattern,
  logger,
}: {
  category: string;
  pattern: string;
  logger?: Logger;
}): string | null {
  if (category === ALL_TOOLS_PERMISSION_CATEGORY) {
    if (pattern === CATCH_ALL_PATTERN) {
      return CATCH_ALL_PATTERN;
    }
    logger?.warn(
      `Qoder permissions: skipping the all-tools '*' rule '${pattern}' — a Qoder rule with a payload names one tool. Write it under the categories it is meant for (for example 'bash' or 'read').`,
    );
    return null;
  }
  if (category.startsWith(MCP_TOOL_PREFIX)) {
    if (pattern === CATCH_ALL_PATTERN) {
      return category;
    }
    logger?.warn(
      `Qoder permissions: skipping the '${category}' rule '${pattern}' — Qoder matches MCP tools by name only.`,
    );
    return null;
  }
  const tool = CATEGORY_TO_QODER_TOOL[category];
  if (tool === undefined) {
    return null;
  }
  if (pattern === CATCH_ALL_PATTERN) {
    return tool;
  }
  return `${QODER_PATH_RULE_ALIASES[tool] ?? tool}(${pattern})`;
}

/** Read a Qoder rule back into a canonical category and pattern. */
function fromQoderRule(rule: string): { category: string; pattern: string } | null {
  const category = categoryOfRule(rule);
  if (category === undefined) {
    return null;
  }
  const { payload } = splitQoderRule(rule);
  if (payload === undefined) {
    return { category, pattern: CATCH_ALL_PATTERN };
  }
  if (category === ALL_TOOLS_PERMISSION_CATEGORY || category.startsWith(MCP_TOOL_PREFIX)) {
    // Neither takes a payload in Qoder's documented syntax.
    return null;
  }
  const trimmed = payload.trim();
  if (trimmed === "") {
    return null;
  }
  return { category, pattern: trimmed };
}

/**
 * Build the regenerated `allow` / `ask` / `deny` lists: every rule the
 * canonical config yields, ranked so a Qoder rule two canonical rules collapse
 * onto keeps the stricter action, plus every existing entry for a tool the
 * config does not manage (`NotebookEdit`, a category absent from the config,
 * ...). An existing entry this run writes is moved to its new list.
 */
function buildQoderRuleLists({
  config,
  existingPermissions,
  logger,
}: {
  config: PermissionsConfig;
  existingPermissions: Record<string, unknown>;
  logger?: Logger;
}): Record<PermissionAction, string[]> {
  const permission = honorAllToolsOnBash(config.permission);
  const ranked = new Map<string, PermissionAction>();
  const managedCategories = new Set<string>();
  for (const [category, rules] of Object.entries(permission)) {
    if (
      category !== ALL_TOOLS_PERMISSION_CATEGORY &&
      !category.startsWith(MCP_TOOL_PREFIX) &&
      !Object.hasOwn(CATEGORY_TO_QODER_TOOL, category)
    ) {
      logger?.warn(
        `Qoder permissions: skipping the '${category}' category — Qoder has no permission rule for it.`,
      );
      continue;
    }
    managedCategories.add(category);
    for (const [pattern, action] of Object.entries(rules)) {
      if (isPrototypePollutionKey(pattern)) {
        continue;
      }
      const rule = toQoderRule({ category, pattern, logger });
      if (rule === null) {
        continue;
      }
      const existing = ranked.get(rule);
      if (existing === undefined || ACTION_RANK[action] > ACTION_RANK[existing]) {
        ranked.set(rule, action);
      }
    }
  }

  const lists = {} as Record<PermissionAction, string[]>;
  for (const action of ACTIONS) {
    lists[action] = toStringList(existingPermissions[action]).filter((rule) => {
      if (ranked.has(rule)) {
        return false;
      }
      const category = categoryOfRule(rule);
      return category === undefined || !managedCategories.has(category);
    });
  }
  for (const [rule, action] of ranked) {
    lists[action].push(rule);
  }
  for (const action of ACTIONS) {
    lists[action] = [...new Set(lists[action])];
  }
  return lists;
}

/**
 * The keys of one authored override group that rulesync writes; any other key
 * is skipped with a warning.
 */
function pickQoderGroupKeys({
  group,
  allowedKeys,
  authored,
  where,
  logger,
}: {
  group: string;
  allowedKeys: readonly string[];
  authored: Record<string, unknown>;
  where: string;
  logger?: Logger;
}): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(authored)) {
    if (isPrototypePollutionKey(key) || value === undefined) {
      continue;
    }
    if (!allowedKeys.includes(key)) {
      logger?.warn(
        `Qoder permissions: skipping qoder.${group}.${key} — Rulesync writes only ${allowedKeys.map((k) => `${group}.${k}`).join(", ")} from the qoder override; set other keys in ${where} by hand.`,
      );
      continue;
    }
    picked[key] = value;
  }
  return picked;
}

/** Name every written override setting that lets Qoder act with fewer prompts. */
function announcePermissiveQoderSettings({
  patch,
  where,
  logger,
}: {
  patch: Record<string, unknown>;
  where: string;
  logger?: Logger;
}): void {
  const general = isRecord(patch.general) ? patch.general : {};
  const mode = general.defaultPermissionMode;
  if (typeof mode === "string" && QODER_PERMISSIVE_MODES.has(mode.trim().toLowerCase())) {
    logger?.warn(
      `Qoder permissions: qoder.general.defaultPermissionMode = ${JSON.stringify(mode)} was written to ${where}, so Qoder starts every session it applies to in a mode that runs actions without asking first.`,
    );
  }
  const mcp = isRecord(patch.mcp) ? patch.mcp : {};
  if (mcp.enableAllProjectMcpServers === true) {
    logger?.warn(
      `Qoder permissions: qoder.mcp.enableAllProjectMcpServers = true was written to ${where}, so Qoder starts every project-level MCP server without asking for approval.`,
    );
  }
  const enabledServers = toStringList(mcp.enabledProjectMcpServers);
  if (enabledServers.length > 0) {
    logger?.warn(
      `Qoder permissions: qoder.mcp.enabledProjectMcpServers was written to ${where}, so Qoder starts the project-level MCP servers ${enabledServers.map((name) => JSON.stringify(name)).join(", ")} without asking for approval.`,
    );
  }
  const autoMode = isRecord(patch[QODER_AUTO_MODE_KEY]) ? patch[QODER_AUTO_MODE_KEY] : {};
  if (toStringList(autoMode.allow).length > 0) {
    logger?.warn(
      `Qoder permissions: qoder.autoMode.allow was written to ${where}, so Qoder's Auto-mode classifier leans toward approving the actions it describes.`,
    );
  }
}

/**
 * The top-level keys the `qoder` override contributes to the settings patch,
 * besides `permissions` and `outputStyle`. Each group is the existing group
 * with the authored keys laid over it; a key is only in the patch when
 * authored. Every write that lets Qoder act with fewer prompts is announced.
 */
function buildQoderOverridePatch({
  override,
  existing,
  global,
  filePath,
  logger,
}: {
  override: Record<string, unknown> | undefined;
  existing: Record<string, unknown>;
  global: boolean;
  filePath: string;
  logger?: Logger;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (override === undefined) {
    return patch;
  }
  const where = `${filePath}${global ? " in the home directory" : ""}`;
  for (const group of QODER_OVERRIDE_GROUPS) {
    const authored = override[group];
    if (!isRecord(authored)) {
      continue;
    }
    const picked = pickQoderGroupKeys({
      group,
      allowedKeys: QODER_OVERRIDE_GROUP_KEYS[group],
      authored,
      where,
      logger,
    });
    if (Object.keys(picked).length > 0) {
      const existingGroup = isRecord(existing[group]) ? existing[group] : {};
      patch[group] = { ...existingGroup, ...picked };
    }
  }

  const autoMode = override[QODER_AUTO_MODE_KEY];
  if (isRecord(autoMode)) {
    if (global) {
      const picked = pickQoderGroupKeys({
        group: QODER_AUTO_MODE_KEY,
        allowedKeys: QODER_AUTO_MODE_KEYS,
        authored: autoMode,
        where,
        logger,
      });
      if (Object.keys(picked).length > 0) {
        const existingAutoMode = isRecord(existing[QODER_AUTO_MODE_KEY])
          ? existing[QODER_AUTO_MODE_KEY]
          : {};
        patch[QODER_AUTO_MODE_KEY] = { ...existingAutoMode, ...picked };
      }
    } else {
      logger?.warn(
        `Qoder permissions: skipping qoder.autoMode in project mode — Qoder reads autoMode from the user settings only. Run 'rulesync generate --global' to write it to ~/.qoder/settings.json.`,
      );
    }
  }

  const excludes = override[QODER_AGENTS_MD_EXCLUDES_KEY];
  if (Array.isArray(excludes)) {
    patch[QODER_AGENTS_MD_EXCLUDES_KEY] = toStringList(excludes);
  }
  // Announce what the override authored, not what the file already held.
  announcePermissiveQoderSettings({
    patch: {
      general: override.general,
      mcp: override.mcp,
      ...(global && { [QODER_AUTO_MODE_KEY]: autoMode }),
    },
    where,
    logger,
  });
  return patch;
}

/**
 * Whether a settings value has the shape the `qoder` override schema accepts
 * for that key, so an off-spec value is left in the file instead of making the
 * imported permissions file fail validation.
 */
function isLiftableQoderValue(key: string, value: unknown): boolean {
  switch (key) {
    case "defaultPermissionMode":
      return typeof value === "string" && value.trim() !== "";
    case "enableAllProjectMcpServers":
    case "lazyLoad":
      return typeof value === "boolean";
    case "overrides":
      return isRecord(value) && Object.values(value).every(isRecord);
    default:
      return Array.isArray(value) && value.every((entry) => typeof entry === "string");
  }
}

/**
 * Lift the settings the `qoder` override authors (other than `outputStyle`)
 * back out of a settings file. `autoMode` is lifted only from the user file,
 * the one Qoder reads it from.
 */
function liftQoderOverride({
  settings,
  global,
}: {
  settings: Record<string, unknown>;
  global: boolean;
}): Record<string, unknown> {
  const lifted: Record<string, unknown> = {};
  for (const group of QODER_OVERRIDE_GROUPS) {
    const existingGroup = settings[group];
    if (!isRecord(existingGroup)) {
      continue;
    }
    const picked: Record<string, unknown> = {};
    for (const key of QODER_OVERRIDE_GROUP_KEYS[group]) {
      const value = Object.hasOwn(existingGroup, key) ? existingGroup[key] : undefined;
      if (isLiftableQoderValue(key, value)) {
        picked[key] = value;
      }
    }
    if (Object.keys(picked).length > 0) {
      lifted[group] = picked;
    }
  }
  const autoMode = settings[QODER_AUTO_MODE_KEY];
  if (global && isRecord(autoMode)) {
    const picked: Record<string, unknown> = {};
    for (const key of QODER_AUTO_MODE_KEYS) {
      if (Object.hasOwn(autoMode, key) && isLiftableQoderValue(key, autoMode[key])) {
        picked[key] = autoMode[key];
      }
    }
    if (Object.keys(picked).length > 0) {
      lifted[QODER_AUTO_MODE_KEY] = picked;
    }
  }
  const excludes = settings[QODER_AGENTS_MD_EXCLUDES_KEY];
  if (isLiftableQoderValue(QODER_AGENTS_MD_EXCLUDES_KEY, excludes)) {
    lifted[QODER_AGENTS_MD_EXCLUDES_KEY] = excludes;
  }
  return lifted;
}

/**
 * Qoder permissions.
 *
 * Rules live under the `permissions` key of `.qoder/settings.json` (project)
 * and `~/.qoder/settings.json` (user) as `allow` / `ask` / `deny` lists of
 * Claude-Code-style rules (`Bash(npm run test:*)`, `Read(/src/**)`,
 * `WebFetch`, `mcp__github__*`, `*`). Qoder evaluates `deny`, then `ask`, then
 * `allow`. Both files carry settings rulesync does not own, so writes go
 * through the shared-config gateway, the sibling keys of `permissions`
 * (`additionalDirectories`, `trustDirectories`) are kept, and the file is
 * never deleted. `.qoder/settings.local.json` (where `/allow` and `/deny`
 * persist) is left to the user. The `qoder` override's `outputStyle` is
 * written to (and imported from) the top-level `outputStyle` key, and its
 * other settings (`general`, `tools`, `mcp`, `agents`, `autoMode`,
 * `agentsMdExcludes`) through `buildQoderOverridePatch` / `liftQoderOverride`.
 *
 * @see https://docs.qoder.com/en/cli/permissions
 * @see https://docs.qoder.com/cli/output-styles
 */
export class QoderPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    // The same relative path is used for both scopes; the processor supplies
    // the home directory as outputRoot in global mode.
    return { relativeDirPath: QODER_DIR, relativeFilePath: QODER_SETTINGS_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<QoderPermissions> {
    const paths = QoderPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new QoderPermissions({
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
    logger,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<QoderPermissions> {
    const paths = QoderPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so this stays side-effect-free under
    // `--dry-run`/`--check`; the actual write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";
    const existing = parseQoderSettings({
      fileContent: existingContent,
      relativePath: join(paths.relativeDirPath, paths.relativeFilePath),
    });
    const existingPermissions = isRecord(existing[QODER_PERMISSIONS_KEY])
      ? existing[QODER_PERMISSIONS_KEY]
      : {};

    const config = rulesyncPermissions.getJson();
    const lists = buildQoderRuleLists({ config, existingPermissions, logger });
    // Only in the patch when authored, so a hand-set value survives.
    const outputStyle = config.qoder?.outputStyle?.trim();
    if (outputStyle !== undefined) {
      logger?.warn(
        `Qoder permissions: qoder.outputStyle = ${JSON.stringify(outputStyle)} was written to ${join(paths.relativeDirPath, paths.relativeFilePath)}${global ? " in the home directory" : ""}, so Qoder appends that style's instructions to the system prompt of every session it applies to.`,
      );
    }
    const permissions: Record<string, unknown> = { ...existingPermissions };
    for (const action of ACTIONS) {
      if (lists[action].length > 0) {
        permissions[action] = lists[action];
      } else {
        delete permissions[action];
      }
    }

    return new QoderPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "permissions",
        existingContent,
        patch: {
          [QODER_PERMISSIONS_KEY]: Object.keys(permissions).length > 0 ? permissions : undefined,
          ...(outputStyle !== undefined && { [QODER_OUTPUT_STYLE_KEY]: outputStyle }),
          ...buildQoderOverridePatch({
            override: config.qoder,
            existing,
            global,
            filePath: join(paths.relativeDirPath, paths.relativeFilePath),
            logger,
          }),
        },
        filePath,
      }),
      validate: true,
      global,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const settings = parseQoderSettings({
      fileContent: this.getFileContent() || "{}",
      relativePath: join(this.getRelativeDirPath(), this.getRelativeFilePath()),
    });
    const permissions = isRecord(settings[QODER_PERMISSIONS_KEY])
      ? settings[QODER_PERMISSIONS_KEY]
      : {};

    const permission: Record<string, Record<string, PermissionAction>> = {};
    for (const action of ACTIONS) {
      for (const rule of toStringList(permissions[action])) {
        const parsed = fromQoderRule(rule);
        if (
          parsed === null ||
          isPrototypePollutionKey(parsed.category) ||
          isPrototypePollutionKey(parsed.pattern)
        ) {
          continue;
        }
        const rules = (permission[parsed.category] ??= {});
        const existing = rules[parsed.pattern];
        // Qoder checks `deny` before `ask` and `ask` before `allow`, so the
        // stricter action wins when a rule appears in more than one list.
        if (existing === undefined || ACTION_RANK[action] > ACTION_RANK[existing]) {
          rules[parsed.pattern] = action;
        }
      }
    }
    const outputStyle = settings[QODER_OUTPUT_STYLE_KEY];
    const qoder: Record<string, unknown> = {
      ...(typeof outputStyle === "string" && outputStyle.trim() !== "" && { outputStyle }),
      ...liftQoderOverride({ settings, global: this.global }),
    };
    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(
        { permission, ...(Object.keys(qoder).length > 0 && { qoder }) },
        null,
        2,
      ),
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolPermissionsForDeletionParams): QoderPermissions {
    return new QoderPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}

/**
 * Fail closed on a syntax error or non-object root, matching the write path's
 * shared-config declaration, so a broken file is surfaced rather than
 * partially imported or overwritten.
 */
function parseQoderSettings({
  fileContent,
  relativePath,
}: {
  fileContent: string;
  relativePath: string;
}): Record<string, unknown> {
  try {
    return parseSharedConfig({
      format: "json",
      fileContent,
      filePath: relativePath,
      invalidRootPolicy: "error",
    });
  } catch (error) {
    throw new Error(`Failed to parse Qoder settings in ${relativePath}: ${formatError(error)}`, {
      cause: error,
    });
  }
}

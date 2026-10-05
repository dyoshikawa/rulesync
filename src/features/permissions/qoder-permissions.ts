import { join } from "node:path";

import { QODER_DIR, QODER_SETTINGS_FILE_NAME } from "../../constants/qoder-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
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
 * persist) is left to the user.
 *
 * @see https://docs.qoder.com/en/cli/permissions
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

    const lists = buildQoderRuleLists({
      config: rulesyncPermissions.getJson(),
      existingPermissions,
      logger,
    });
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
    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify({ permission }, null, 2),
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

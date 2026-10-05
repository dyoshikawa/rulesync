import { join } from "node:path";

import { CODEBUDDY_DIR, CODEBUDDY_SETTINGS_FILE_NAME } from "../../constants/codebuddy-paths.js";
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
import { PERMISSION_ACTION_PRIORITY } from "./single-action-collapse.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/** Top-level key of `.codebuddy/settings.json` that rulesync owns. */
const CODEBUDDY_PERMISSIONS_KEY = "permissions";

/** The rule lists under `permissions`, one per canonical action. */
const CODEBUDDY_RULE_LISTS: readonly PermissionAction[] = ["allow", "ask", "deny"];

const CATCH_ALL_PATTERN = "*";
const MCP_CATEGORY = "mcp";
const MCP_RULE_PREFIX = "mcp__";
const ALL_MCP_RULE = "mcp__*";

/**
 * Canonical category ⇒ CodeBuddy tool name. CodeBuddy's rule syntax is Claude
 * Code's (`Tool` or `Tool(specifier)`), and these are the built-in tools its
 * permissions docs and tools reference name. Any other category is written
 * through as the tool name it is (`TaskCreate`, `mcp__server__tool`), the
 * same pass-through the `claudecode` target uses.
 * @see https://www.codebuddy.ai/docs/cli/permissions
 * @see https://www.codebuddy.ai/docs/cli/tools-reference
 */
const CATEGORY_TO_CODEBUDDY_TOOL: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  grep: "Grep",
  glob: "Glob",
  notebookedit: "NotebookEdit",
  agent: "Agent",
  skill: "Skill",
};

const CODEBUDDY_TOOL_TO_CATEGORY: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_TO_CODEBUDDY_TOOL).map(([category, tool]) => [tool, category]),
);

function toStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Split a rule into its tool half and specifier: `Tool(specifier)` or a bare
 * `Tool`. A rule that opens a parenthesis without closing it comes back with
 * a `null` tool so it stays unmodeled (and is preserved as-is).
 */
function splitCodebuddyRule(rule: string): { tool: string | null; specifier: string | undefined } {
  const match = rule.match(/^([^(]+)\(([\s\S]*)\)$/);
  if (match) {
    return { tool: match[1] ?? null, specifier: match[2] };
  }
  return { tool: rule.includes("(") ? null : rule, specifier: undefined };
}

/**
 * The canonical category a CodeBuddy rule belongs to: a built-in tool maps to
 * its lowercase category, the all-MCP wildcard `mcp__*` to `mcp`, and any
 * other tool name (an `mcp__server__tool`, the standalone `*`, a tool without
 * a canonical category) is its own category.
 */
function categoryOfRule(rule: string): string | undefined {
  const { tool } = splitCodebuddyRule(rule);
  if (tool === null) {
    return undefined;
  }
  if (tool === ALL_MCP_RULE) {
    return MCP_CATEGORY;
  }
  return Object.hasOwn(CODEBUDDY_TOOL_TO_CATEGORY, tool) ? CODEBUDDY_TOOL_TO_CATEGORY[tool] : tool;
}

/**
 * Build the CodeBuddy rule for a canonical category + pattern, or `null` (with
 * a warning) when CodeBuddy has no rule that means the same thing:
 *
 * - The bare `mcp` category is the all-MCP wildcard `mcp__*` for its catch-all
 *   pattern and `mcp__<pattern>` (a server or `server__tool`) otherwise.
 *   CodeBuddy honors `mcp__*` in `deny` / `ask` only, so it is never written
 *   to `allow`.
 * - MCP rules take no specifier, so a scoped `mcp__<...>` category is written
 *   for its catch-all pattern only.
 * - The all-tools `*` category is CodeBuddy's documented standalone `*` rule
 *   for its catch-all pattern. Narrower `*` patterns are shell restrictions
 *   and reach the `Bash` rules through `honorAllToolsOnBash`.
 */
function buildCodebuddyRule({
  category,
  pattern,
  action,
  logger,
}: {
  category: string;
  pattern: string;
  action: PermissionAction;
  logger?: Logger;
}): string | null {
  const catchAll = pattern === CATCH_ALL_PATTERN;
  if (category === MCP_CATEGORY) {
    if (catchAll && action === "allow") {
      logger?.warn(
        `CodeBuddy permissions: skipping the 'mcp' allow rule '*' — CodeBuddy honors the all-MCP wildcard 'mcp__*' in deny and ask only. Allow servers by name instead (for example 'mcp__github').`,
      );
      return null;
    }
    return catchAll ? ALL_MCP_RULE : `${MCP_RULE_PREFIX}${pattern}`;
  }
  if (category === ALL_TOOLS_PERMISSION_CATEGORY) {
    if (catchAll) {
      return CATCH_ALL_PATTERN;
    }
    logger?.warn(
      `CodeBuddy permissions: skipping the all-tools '*' rule '${pattern}' — CodeBuddy's standalone '*' rule takes no specifier. Write it under the category it is meant for (for example 'bash' or 'read').`,
    );
    return null;
  }
  if (category.startsWith(MCP_RULE_PREFIX) && !catchAll) {
    logger?.warn(
      `CodeBuddy permissions: skipping the '${category}' rule '${pattern}' — CodeBuddy MCP rules name a server or tool and take no specifier.`,
    );
    return null;
  }
  const tool = Object.hasOwn(CATEGORY_TO_CODEBUDDY_TOOL, category)
    ? (CATEGORY_TO_CODEBUDDY_TOOL[category] as string)
    : category;
  return catchAll ? tool : `${tool}(${pattern})`;
}

/** Read a CodeBuddy rule back into a canonical category and pattern. */
function parseCodebuddyRule(rule: string): { category: string; pattern: string } | null {
  const category = categoryOfRule(rule);
  if (category === undefined) {
    return null;
  }
  const { specifier } = splitCodebuddyRule(rule);
  if (specifier === undefined) {
    return { category, pattern: CATCH_ALL_PATTERN };
  }
  const trimmed = specifier.trim();
  // `Tool()` matches no call, so it has no canonical meaning.
  return trimmed === "" ? null : { category, pattern: trimmed };
}

/**
 * Build the regenerated rule lists: every rule the canonical config yields,
 * ranked so a rule two canonical rules collapse onto keeps the stricter
 * action, plus every existing entry for a category the config does not
 * manage (and every entry rulesync cannot parse).
 */
function buildCodebuddyRuleLists({
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
    if (isPrototypePollutionKey(category)) {
      continue;
    }
    managedCategories.add(category);
    for (const [pattern, action] of Object.entries(rules)) {
      if (isPrototypePollutionKey(pattern)) {
        continue;
      }
      const rule = buildCodebuddyRule({ category, pattern, action, logger });
      if (rule === null) {
        continue;
      }
      // The bare `mcp` category emits `mcp__<server>` rules, which an existing
      // entry is matched against by its own category, so record the emitted
      // rule's category too: flipping `mcp.github` from deny to allow must
      // replace the old `mcp__github` deny rather than leave it beside the
      // new allow.
      const emittedCategory = categoryOfRule(rule);
      if (emittedCategory !== undefined) {
        managedCategories.add(emittedCategory);
      }
      const existing = ranked.get(rule);
      if (
        existing === undefined ||
        PERMISSION_ACTION_PRIORITY[action] > PERMISSION_ACTION_PRIORITY[existing]
      ) {
        ranked.set(rule, action);
      }
    }
  }

  const lists: Record<PermissionAction, string[]> = { allow: [], ask: [], deny: [] };
  for (const list of CODEBUDDY_RULE_LISTS) {
    lists[list] = toStringList(existingPermissions[list]).filter((rule) => {
      const category = categoryOfRule(rule);
      return category === undefined || !managedCategories.has(category);
    });
  }
  for (const [rule, action] of ranked) {
    lists[action].push(rule);
  }
  for (const list of CODEBUDDY_RULE_LISTS) {
    lists[list] = [...new Set(lists[list])];
  }
  return lists;
}

/**
 * CodeBuddy Code permissions.
 *
 * Rules live under the `permissions` key of `.codebuddy/settings.json`
 * (project) and `~/.codebuddy/settings.json` (user) as Claude-Code-style
 * `allow` / `ask` / `deny` lists (`Bash(npm test)`, `Bash(git:*)`,
 * `Read(./.env)`, `WebFetch(domain:example.com)`, `mcp__github`,
 * `Agent(Explore)`). Both files carry settings rulesync does not own, so
 * writes go through the shared-config gateway, the sibling keys of the rule
 * lists (`defaultMode`, `additionalDirectories`, `trustedDirectories`, ...)
 * are kept, and the file is never deleted. The gitignored
 * `.codebuddy/settings.local.json` layer is left to CodeBuddy.
 *
 * @see https://www.codebuddy.ai/docs/cli/permissions
 * @see https://www.codebuddy.ai/docs/cli/settings
 */
export class CodebuddyPermissions extends ToolPermissions {
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
    return { relativeDirPath: CODEBUDDY_DIR, relativeFilePath: CODEBUDDY_SETTINGS_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<CodebuddyPermissions> {
    const paths = CodebuddyPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new CodebuddyPermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<CodebuddyPermissions> {
    const paths = CodebuddyPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so this stays side-effect-free under
    // `--dry-run`/`--check`; the actual write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";
    const existing = parseCodebuddySettings({
      fileContent: existingContent,
      relativePath: join(paths.relativeDirPath, paths.relativeFilePath),
    });
    const existingPermissions = isRecord(existing[CODEBUDDY_PERMISSIONS_KEY])
      ? existing[CODEBUDDY_PERMISSIONS_KEY]
      : {};

    const lists = buildCodebuddyRuleLists({
      config: rulesyncPermissions.getJson(),
      existingPermissions,
      logger,
    });
    const permissions: Record<string, unknown> = { ...existingPermissions };
    for (const list of CODEBUDDY_RULE_LISTS) {
      if (lists[list].length > 0) {
        permissions[list] = lists[list];
      } else {
        delete permissions[list];
      }
    }

    return new CodebuddyPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "permissions",
        existingContent,
        patch: {
          [CODEBUDDY_PERMISSIONS_KEY]:
            Object.keys(permissions).length > 0 ? permissions : undefined,
        },
        filePath,
      }),
      validate: true,
      global,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const settings = parseCodebuddySettings({
      fileContent: this.getFileContent() || "{}",
      relativePath: join(this.getRelativeDirPath(), this.getRelativeFilePath()),
    });
    const permissions = isRecord(settings[CODEBUDDY_PERMISSIONS_KEY])
      ? settings[CODEBUDDY_PERMISSIONS_KEY]
      : {};

    const permission: Record<string, Record<string, PermissionAction>> = {};
    for (const action of CODEBUDDY_RULE_LISTS) {
      for (const rule of toStringList(permissions[action])) {
        const parsed = parseCodebuddyRule(rule);
        if (
          parsed === null ||
          isPrototypePollutionKey(parsed.category) ||
          isPrototypePollutionKey(parsed.pattern)
        ) {
          continue;
        }
        const rules = (permission[parsed.category] ??= {});
        const existing = rules[parsed.pattern];
        // CodeBuddy evaluates `deny` first, then `ask`, then `allow`, so the
        // stricter action wins when a rule appears in more than one list.
        if (
          existing === undefined ||
          PERMISSION_ACTION_PRIORITY[action] > PERMISSION_ACTION_PRIORITY[existing]
        ) {
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
  }: ToolPermissionsForDeletionParams): CodebuddyPermissions {
    return new CodebuddyPermissions({
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
function parseCodebuddySettings({
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
    throw new Error(
      `Failed to parse CodeBuddy settings in ${relativePath}: ${formatError(error)}`,
      { cause: error },
    );
  }
}

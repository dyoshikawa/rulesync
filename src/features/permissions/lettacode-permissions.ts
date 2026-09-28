import { join } from "node:path";

import { LETTACODE_DIR, LETTACODE_SETTINGS_FILE_NAME } from "../../constants/lettacode-paths.js";
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
import { honorAllToolsOnBash } from "./shell-command-categories.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/** Top-level key of `.letta/settings.json` that rulesync owns. */
const LETTACODE_PERMISSIONS_KEY = "permissions";

const CATCH_ALL_PATTERN = "*";

/** Letta Code's `Bash(prefix:*)` prefix-match suffix. */
const PREFIX_SUFFIX = ":*";

// Canonical category ⇒ Letta Code permission tool name. These are the tool
// families Letta Code's permission checker canonicalizes every tool call to
// (`src/permissions/canonical.ts`). Letta Code ships no web fetch or web
// search tool, and its MCP permission names are not documented, so the other
// categories are skipped with a warning.
const CATEGORY_TO_LETTACODE_TOOL: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  glob: "Glob",
  grep: "Grep",
};

// Letta Code tool name (or an alias its checker folds into the same family)
// ⇒ canonical category. The aliases are read back so a rule written with one
// of them is imported and replaced on the next generate, but only the
// canonical names are ever written.
// https://github.com/letta-ai/letta-code/blob/main/src/permissions/canonical.ts
const LETTACODE_TOOL_TO_CATEGORY: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(CATEGORY_TO_LETTACODE_TOOL).map(([category, tool]) => [tool, category]),
  ),
  shell: "bash",
  Shell: "bash",
  shell_command: "bash",
  ShellCommand: "bash",
  exec_command: "bash",
  read_file: "read",
  ReadFile: "read",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  grep_files: "grep",
  GrepFiles: "grep",
};

/**
 * The lists a canonical action is written to. Letta Code checks `deny`, then
 * `alwaysAsk`, then `allow`, and only then `ask` (`src/permissions/checker.ts`),
 * so its plain `ask` list cannot outrank a broader `allow`. The canonical order
 * is `deny > ask > allow` whatever the width of the patterns, which is exactly
 * the `alwaysAsk` list's position, so a canonical `ask` is written there.
 */
const ACTION_TO_LIST: Record<PermissionAction, string> = {
  allow: "allow",
  ask: "alwaysAsk",
  deny: "deny",
};

/** Every rule list rulesync regenerates, and the canonical action each imports as. */
const LIST_TO_ACTION: Record<string, PermissionAction> = {
  allow: "allow",
  ask: "ask",
  alwaysAsk: "ask",
  deny: "deny",
};

const ACTION_RANK: Record<PermissionAction, number> = { allow: 0, ask: 1, deny: 2 };

function toStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Split a rule the way Letta Code's matcher does: `Tool(payload)` or a bare
 * `Tool`. A rule that opens a parenthesis without closing it is returned with
 * an `undefined` payload and a `null` tool so it stays unmodeled.
 */
function splitLettacodeRule(rule: string): { tool: string | null; payload: string | undefined } {
  const match = rule.match(/^([^(]+)\(([\s\S]*)\)$/);
  if (match) {
    return { tool: match[1] ?? null, payload: match[2] };
  }
  return { tool: rule.includes("(") ? null : rule, payload: undefined };
}

function categoryOfRule(rule: string): string | undefined {
  const { tool } = splitLettacodeRule(rule);
  if (tool === null || !Object.hasOwn(LETTACODE_TOOL_TO_CATEGORY, tool)) {
    return undefined;
  }
  return LETTACODE_TOOL_TO_CATEGORY[tool];
}

/**
 * Translate a canonical `bash` glob into Letta Code's command syntax, which has
 * no globs: `prefix:*` is a prefix match (`src/permissions/matcher.ts`) and
 * anything else is an exact match. Returns the payload to wrap in `Bash(...)`,
 * `""` for the whole tool, or `null` when the pattern cannot be expressed.
 *
 * - `*` is the whole tool (a bare `Bash`).
 * - A pattern with no `*` is an exact command.
 * - A pattern whose only `*` is trailing (`git *`, `npm run test*`) becomes a
 *   prefix match on the text before it. Letta Code trims the prefix before
 *   matching, so `git *` becomes `git:*`, which also matches `git` alone and
 *   commands like `git-lfs` — the documented idiom for "this command and any
 *   arguments".
 * - A `*` anywhere else has no Letta Code spelling. A `deny` or `ask` is
 *   widened to a prefix match on the text before the first `*` (a stricter
 *   rule, so the restriction still holds); an `allow` is dropped, since
 *   widening it would grant commands the source never allowed.
 */
function toLettacodeBashPayload({
  pattern,
  action,
  logger,
}: {
  pattern: string;
  action: PermissionAction;
  logger?: Logger;
}): string | null {
  if (pattern === CATCH_ALL_PATTERN) {
    return "";
  }
  const firstStar = pattern.indexOf("*");
  if (firstStar === -1) {
    return pattern;
  }
  if (pattern.endsWith(PREFIX_SUFFIX) && firstStar === pattern.length - 1) {
    return pattern;
  }
  const prefix = pattern.slice(0, firstStar).trimEnd();
  if (firstStar === pattern.length - 1) {
    return prefix === "" ? "" : `${prefix}${PREFIX_SUFFIX}`;
  }
  if (action === "allow") {
    logger?.warn(
      `Letta Code permissions: skipping the 'bash' allow rule '${pattern}' — Letta Code matches commands exactly or by a trailing ':*' prefix only, so a '*' before the end cannot be expressed without granting more than the rule allows.`,
    );
    return null;
  }
  const widened = prefix === "" ? "Bash" : `Bash(${prefix}${PREFIX_SUFFIX})`;
  logger?.warn(
    `Letta Code permissions: writing the 'bash' ${action} rule '${pattern}' as '${widened}' — Letta Code matches commands exactly or by a trailing ':*' prefix only, so the restriction is widened to the text before the first '*'.`,
  );
  return prefix === "" ? "" : `${prefix}${PREFIX_SUFFIX}`;
}

function toLettacodeRule({
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
  const tool = CATEGORY_TO_LETTACODE_TOOL[category];
  if (tool === undefined) {
    return null;
  }
  const payload =
    category === "bash"
      ? toLettacodeBashPayload({ pattern, action, logger })
      : pattern === CATCH_ALL_PATTERN
        ? ""
        : pattern;
  if (payload === null) {
    return null;
  }
  // A bare tool name matches every call of that tool under Letta Code's
  // default permission engine (`allowBareToolFallback`).
  return payload === "" ? tool : `${tool}(${payload})`;
}

/** Read a Letta Code rule back into a canonical category and pattern. */
function fromLettacodeRule(rule: string): { category: string; pattern: string } | null {
  const category = categoryOfRule(rule);
  if (category === undefined) {
    return null;
  }
  const { payload } = splitLettacodeRule(rule);
  if (payload === undefined) {
    return { category, pattern: CATCH_ALL_PATTERN };
  }
  const trimmed = payload.trim();
  if (trimmed === "") {
    // `Tool()` matches no call, so it has no canonical meaning.
    return null;
  }
  if (category === "bash" && trimmed.endsWith(PREFIX_SUFFIX)) {
    const prefix = trimmed.slice(0, -PREFIX_SUFFIX.length).trimEnd();
    return { category, pattern: prefix === "" ? CATCH_ALL_PATTERN : `${prefix} *` };
  }
  return { category, pattern: trimmed };
}

/**
 * Build the regenerated rule lists: every managed rule the canonical config
 * yields, ranked so a Letta Code rule two canonical rules collapse onto keeps
 * the stricter action, plus every existing entry for a tool family the config
 * does not manage (`Task`, `ListDir`, MCP tools, a family whose category is
 * absent from the config).
 */
function buildLettacodeRuleLists({
  config,
  existingPermissions,
  logger,
}: {
  config: PermissionsConfig;
  existingPermissions: Record<string, unknown>;
  logger?: Logger;
}): Record<string, string[]> {
  const permission = honorAllToolsOnBash(config.permission);
  const ranked = new Map<string, PermissionAction>();
  const managedCategories = new Set<string>();
  for (const [category, rules] of Object.entries(permission)) {
    if (!Object.hasOwn(CATEGORY_TO_LETTACODE_TOOL, category)) {
      // The all-tools `*` category's restrictions already reached `bash`
      // through `honorAllToolsOnBash` when that category exists.
      logger?.warn(
        `Letta Code permissions: skipping the '${category}' category — Letta Code has no permission rule for it.`,
      );
      continue;
    }
    managedCategories.add(category);
    for (const [pattern, action] of Object.entries(rules)) {
      if (isPrototypePollutionKey(pattern)) {
        continue;
      }
      const rule = toLettacodeRule({ category, pattern, action, logger });
      if (rule === null) {
        continue;
      }
      const existing = ranked.get(rule);
      if (existing === undefined || ACTION_RANK[action] > ACTION_RANK[existing]) {
        ranked.set(rule, action);
      }
    }
  }

  const lists: Record<string, string[]> = {};
  for (const key of Object.keys(LIST_TO_ACTION)) {
    lists[key] = toStringList(existingPermissions[key]).filter((rule) => {
      const category = categoryOfRule(rule);
      return category === undefined || !managedCategories.has(category);
    });
  }
  for (const [rule, action] of ranked) {
    lists[ACTION_TO_LIST[action]]?.push(rule);
  }
  for (const key of Object.keys(lists)) {
    lists[key] = [...new Set(lists[key])];
  }
  return lists;
}

/**
 * Letta Code permissions.
 *
 * Rules live under the `permissions` key of `.letta/settings.json` (project)
 * and `~/.letta/settings.json` (user) as Claude-Code-style rule lists
 * (`Bash(npm test)`, `Bash(git:*)`, `Read(src/**)`, `Edit`). Both files carry
 * settings rulesync does not own, so writes go through the shared-config
 * gateway, the sibling keys of `permissions` (`mode`, `additionalDirectories`,
 * ...) are kept, and the file is never deleted.
 *
 * @see https://docs.letta.com/reference/settings/index.md
 * @see https://github.com/letta-ai/letta-code/blob/main/src/permissions/types.ts
 * @see https://github.com/letta-ai/letta-code/blob/main/src/permissions/matcher.ts
 */
export class LettacodePermissions extends ToolPermissions {
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
    return { relativeDirPath: LETTACODE_DIR, relativeFilePath: LETTACODE_SETTINGS_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<LettacodePermissions> {
    const paths = LettacodePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new LettacodePermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<LettacodePermissions> {
    const paths = LettacodePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so this stays side-effect-free under
    // `--dry-run`/`--check`; the actual write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";
    const existing = parseLettacodeSettings({
      fileContent: existingContent,
      relativePath: join(paths.relativeDirPath, paths.relativeFilePath),
    });
    const existingPermissions = isRecord(existing[LETTACODE_PERMISSIONS_KEY])
      ? existing[LETTACODE_PERMISSIONS_KEY]
      : {};

    const lists = buildLettacodeRuleLists({
      config: rulesyncPermissions.getJson(),
      existingPermissions,
      logger,
    });
    const permissions: Record<string, unknown> = { ...existingPermissions };
    for (const [key, rules] of Object.entries(lists)) {
      if (rules.length > 0) {
        permissions[key] = rules;
      } else {
        delete permissions[key];
      }
    }

    return new LettacodePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "permissions",
        existingContent,
        patch: {
          [LETTACODE_PERMISSIONS_KEY]:
            Object.keys(permissions).length > 0 ? permissions : undefined,
        },
        filePath,
      }),
      validate: true,
      global,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const settings = parseLettacodeSettings({
      fileContent: this.getFileContent() || "{}",
      relativePath: join(this.getRelativeDirPath(), this.getRelativeFilePath()),
    });
    const permissions = isRecord(settings[LETTACODE_PERMISSIONS_KEY])
      ? settings[LETTACODE_PERMISSIONS_KEY]
      : {};

    const permission: Record<string, Record<string, PermissionAction>> = {};
    for (const [key, action] of Object.entries(LIST_TO_ACTION)) {
      for (const rule of toStringList(permissions[key])) {
        const parsed = fromLettacodeRule(rule);
        if (parsed === null || isPrototypePollutionKey(parsed.pattern)) {
          continue;
        }
        const rules = (permission[parsed.category] ??= {});
        const existing = rules[parsed.pattern];
        // Letta Code checks `deny` before every other list, so the stricter
        // action wins when a rule appears in more than one list.
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
  }: ToolPermissionsForDeletionParams): LettacodePermissions {
    return new LettacodePermissions({
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
function parseLettacodeSettings({
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
      `Failed to parse Letta Code settings in ${relativePath}: ${formatError(error)}`,
      { cause: error },
    );
  }
}

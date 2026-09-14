import { join } from "node:path";

import { dump } from "js-yaml";

import { CONTINUE_DIR, CONTINUE_PERMISSIONS_FILE_NAME } from "../../constants/continue-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import { loadYaml } from "../../utils/yaml.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import { ALL_TOOLS_PERMISSION_CATEGORY, honorAllToolsOnBash } from "./shell-command-categories.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

const CONTINUE_GLOBAL_ONLY_MESSAGE =
  "Continue permissions are global-only; use --global to sync ~/.continue/permissions.yaml";

// The catch-all rulesync pattern; an entry with no argument pattern.
const CATCH_ALL_PATTERN = "*";

// rulesync canonical categories -> the Continue CLI built-in tool names whose
// primary argument the pattern is matched against (`command` for Bash,
// `file_path` for Read/Edit/Write, `url` for Fetch). Any other category passes
// through verbatim as the tool name, so an MCP tool or a further built-in
// (`List`, `Search`, ...) can be named directly.
// https://github.com/continuedev/continue/blob/main/extensions/cli/src/permissions/permissionsYamlLoader.ts
const CANONICAL_TO_CONTINUE_TOOL_NAMES: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  webfetch: "Fetch",
};

const CONTINUE_TO_CANONICAL_TOOL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_CONTINUE_TOOL_NAMES).map(([k, v]) => [v, k]),
);

// rulesync canonical action -> permissions.yaml list key. `exclude` disables
// the tool outright, which is the closest Continue has to a deny.
type ContinuePermissionListKey = "allow" | "ask" | "exclude";

const ACTION_TO_CONTINUE_LIST: Record<PermissionAction, ContinuePermissionListKey> = {
  allow: "allow",
  ask: "ask",
  deny: "exclude",
};

const CONTINUE_LIST_TO_ACTION: Record<ContinuePermissionListKey, PermissionAction> = {
  allow: "allow",
  ask: "ask",
  exclude: "deny",
};

// Written in the order the CLI evaluates them (first match wins).
const CONTINUE_PERMISSION_LIST_KEYS: ContinuePermissionListKey[] = ["exclude", "ask", "allow"];

type ContinuePermissionLists = Record<ContinuePermissionListKey, string[]>;

// The loader's pattern grammar: `Tool` or `Tool(argument pattern)`. An entry
// that does not match makes the CLI throw while loading the file, so nothing
// outside the grammar may be written.
// https://github.com/continuedev/continue/blob/main/extensions/cli/src/permissions/permissionsYamlLoader.ts
const CONTINUE_PATTERN_RE = /^([^(]+)(?:\(([^)]*)\))?$/;

// Own-property lookups only: a `constructor` category would otherwise resolve
// to the `Object` function through the prototype chain.
function toContinueToolName(canonical: string): string {
  return Object.hasOwn(CANONICAL_TO_CONTINUE_TOOL_NAMES, canonical)
    ? (CANONICAL_TO_CONTINUE_TOOL_NAMES[canonical] ?? canonical)
    : canonical;
}

function toCanonicalToolName(continueName: string): string {
  return Object.hasOwn(CONTINUE_TO_CANONICAL_TOOL_NAMES, continueName)
    ? (CONTINUE_TO_CANONICAL_TOOL_NAMES[continueName] ?? continueName)
    : continueName;
}

/**
 * Build a permissions.yaml entry: the bare tool name for the catch-all, else
 * `Tool(pattern)`.
 */
function buildContinuePermissionEntry(toolName: string, pattern: string): string {
  return pattern === CATCH_ALL_PATTERN ? toolName : `${toolName}(${pattern})`;
}

/**
 * Split a permissions.yaml entry into its tool name and argument pattern, or
 * `undefined` for an entry outside the loader's grammar.
 */
function parseContinuePermissionEntry(
  entry: string,
): { toolName: string; pattern: string } | undefined {
  const match = CONTINUE_PATTERN_RE.exec(entry);
  if (!match) {
    return undefined;
  }
  const toolName = match[1]?.trim() ?? "";
  const pattern = match[2]?.trim() ?? "";
  if (toolName === "") {
    return undefined;
  }
  return { toolName, pattern: pattern === "" ? CATCH_ALL_PATTERN : pattern };
}

/**
 * Permissions adapter for the Continue CLI (`cn`).
 *
 * Continue reads tool policies from `~/.continue/permissions.yaml`, three
 * string lists (`allow`, `ask`, `exclude`) of `Tool` / `Tool(pattern)` entries
 * evaluated exclude-first, then ask, then allow, first match wins. `exclude`
 * disables the tool. A `Tool(pattern)` entry glob-matches (`*` / `?`) the
 * tool's primary argument — the shell command for `Bash`, the path for
 * `Read` / `Edit` / `Write`, the URL for `Fetch`. The file is **global only**:
 * no project-scoped permissions file is read.
 *
 * Mapping (rulesync canonical -> Continue):
 *   - Action: `allow` -> `allow`, `ask` -> `ask`, `deny` -> `exclude`.
 *   - Tool name: `bash` -> `Bash`, `read` -> `Read`, `edit` -> `Edit`,
 *     `write` -> `Write`, `webfetch` -> `Fetch`; any other category passes
 *     through verbatim, and the all-tools `*` category becomes the bare `*`
 *     entry that matches every tool.
 *   - Entry: the catch-all `*` pattern is the bare tool name; every other
 *     pattern is written as `Tool(pattern)`. A pattern holding a parenthesis
 *     cannot be written (the loader would refuse the whole file) and is
 *     reported and skipped.
 *
 * The CLI appends the user's own "always allow" decisions to the same file,
 * so entries naming a tool the canonical config does not manage are preserved
 * verbatim, the managed tools' entries are rebuilt, and the file is never
 * deleted.
 *
 * @see https://docs.continue.dev/cli/tool-permissions
 * @see https://github.com/continuedev/continue/blob/main/extensions/cli/src/permissions/permissionsYamlLoader.ts
 * @see https://github.com/continuedev/continue/blob/main/extensions/cli/src/permissions/permissionChecker.ts
 */
export class ContinuePermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
    });
  }

  override isDeletable(): boolean {
    return false;
  }

  /**
   * `permissions.yaml` is Continue's file: rulesync merges into it when it
   * exists but does not create one that holds three empty lists — an absent
   * file and empty lists both mean "no policy, ask for everything".
   */
  override shouldSkipCreationWhenPayloadEmpty(): boolean {
    return true;
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: CONTINUE_DIR,
      relativeFilePath: CONTINUE_PERMISSIONS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<ContinuePermissions> {
    if (!global) {
      throw new Error(CONTINUE_GLOBAL_ONLY_MESSAGE);
    }
    const paths = ContinuePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";
    return new ContinuePermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<ContinuePermissions> {
    if (!global) {
      throw new Error(CONTINUE_GLOBAL_ONLY_MESSAGE);
    }
    const paths = ContinuePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so a dry-run/check does not create the user's
    // global permissions.yaml as a side effect.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";

    let parsed: unknown;
    try {
      parsed = existingContent.trim() === "" ? {} : loadYaml(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Continue permissions.yaml at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const existing = parseContinuePermissionLists(isRecord(parsed) ? parsed : {});

    const config = rulesyncPermissions.getJson();
    const generated = convertRulesyncToContinuePermissions({ config, logger });
    const managedToolNames = managedContinueToolNames(config);

    // Keep the entries that name an unmanaged tool (the CLI writes the user's
    // "always allow" decisions into this file), rebuild the managed ones.
    const lists: Record<string, string[]> = {};
    for (const key of CONTINUE_PERMISSION_LIST_KEYS) {
      const preserved = existing[key].filter((entry) => {
        const parsedEntry = parseContinuePermissionEntry(entry);
        return parsedEntry === undefined || !managedToolNames.has(parsedEntry.toolName);
      });
      const merged = [...new Set([...preserved, ...generated[key]])];
      if (merged.length > 0) {
        lists[key] = merged;
      }
    }

    return new ContinuePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: Object.keys(lists).length === 0 ? "" : dump(lists),
      validate: true,
      global: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let parsed: unknown;
    try {
      const content = this.getFileContent();
      parsed = content.trim() === "" ? {} : loadYaml(content);
    } catch (error) {
      throw new Error(
        `Failed to parse Continue permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const lists = parseContinuePermissionLists(isRecord(parsed) ? parsed : {});
    const rulesyncConfig = convertContinuePermissionsToRulesync(lists);

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
  }: ToolPermissionsForDeletionParams): ContinuePermissions {
    return new ContinuePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global: true,
    });
  }
}

/**
 * The Continue tool names the canonical config manages, i.e. the names its
 * categories map to. Entries naming any other tool are the user's (or the
 * CLI's) and survive a generate.
 */
function managedContinueToolNames(config: PermissionsConfig): Set<string> {
  return new Set(Object.keys(config.permission).map((category) => toContinueToolName(category)));
}

/**
 * Read the three lists out of a parsed permissions.yaml, tolerating a missing
 * or malformed list (the CLI itself discards the file in that case).
 */
function parseContinuePermissionLists(parsed: Record<string, unknown>): ContinuePermissionLists {
  return {
    exclude: isStringArray(parsed.exclude) ? parsed.exclude : [],
    ask: isStringArray(parsed.ask) ? parsed.ask : [],
    allow: isStringArray(parsed.allow) ? parsed.allow : [],
  };
}

/**
 * Convert a rulesync permissions config into the three permissions.yaml lists.
 */
function convertRulesyncToContinuePermissions({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: Logger;
}): ContinuePermissionLists {
  const lists: ContinuePermissionLists = { exclude: [], ask: [], allow: [] };
  // Two categories can produce the same entry (a pass-through category spelled
  // as a tool name), so a disagreement between them is reported rather than
  // silently resolved by the CLI's exclude-first order.
  const actionByEntry = new Map<string, PermissionAction>();

  for (const [category, rules] of Object.entries(honorAllToolsOnBash(config.permission))) {
    if (isPrototypePollutionKey(category)) continue;
    const toolName =
      category === ALL_TOOLS_PERMISSION_CATEGORY
        ? ALL_TOOLS_PERMISSION_CATEGORY
        : toContinueToolName(category);

    for (const [pattern, action] of Object.entries(rules)) {
      if (isPrototypePollutionKey(pattern)) continue;
      if (pattern.includes("(") || pattern.includes(")")) {
        logger?.warn(
          `Continue permissions.yaml cannot hold a parenthesis inside a pattern, so the ` +
            `"${action}" rule for "${category}" (pattern ${quoteValueForWarning(pattern)}) ` +
            `was skipped.`,
        );
        continue;
      }
      const entry = buildContinuePermissionEntry(toolName, pattern);
      const previous = actionByEntry.get(entry);
      if (previous !== undefined && previous !== action) {
        logger?.warn(
          `Continue permissions: rules from different categories both resolve to ` +
            `${quoteValueForWarning(entry)} with conflicting actions (${previous} and ${action}). ` +
            `Both are written; Continue applies exclude first, then ask, then allow.`,
        );
      }
      actionByEntry.set(entry, action);
      lists[ACTION_TO_CONTINUE_LIST[action]].push(entry);
    }
  }

  for (const key of CONTINUE_PERMISSION_LIST_KEYS) {
    lists[key] = [...new Set(lists[key])];
  }
  return lists;
}

/**
 * Convert the three permissions.yaml lists back into a rulesync config.
 */
function convertContinuePermissionsToRulesync(lists: ContinuePermissionLists): PermissionsConfig {
  const permission: PermissionsConfig["permission"] = {};

  for (const key of CONTINUE_PERMISSION_LIST_KEYS) {
    const action = CONTINUE_LIST_TO_ACTION[key];
    for (const entry of lists[key]) {
      const parsedEntry = parseContinuePermissionEntry(entry);
      if (parsedEntry === undefined) {
        continue;
      }
      // A `__proto__(x)` or `constructor` entry would write through to
      // Object.prototype below, so such entries are dropped (as the other
      // permissions adapters do).
      if (
        isPrototypePollutionKey(parsedEntry.toolName) ||
        isPrototypePollutionKey(parsedEntry.pattern)
      ) {
        continue;
      }
      const category = toCanonicalToolName(parsedEntry.toolName);
      permission[category] ??= {};
      // The CLI evaluates exclude before ask before allow, and the lists are
      // read in that order, so the first action recorded for a pattern wins.
      permission[category][parsedEntry.pattern] ??= action;
    }
  }

  return { permission };
}

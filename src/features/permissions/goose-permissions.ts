import { join } from "node:path";

import { dump, load } from "js-yaml";

import { GOOSE_GLOBAL_DIR, GOOSE_PERMISSIONS_FILE_NAME } from "../../constants/goose-paths.js";
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

const GOOSE_GLOBAL_ONLY_MESSAGE =
  "Goose permissions are global-only; use --global to sync ~/.config/goose/permission.yaml";

// Goose stores user-set permission decisions under the top-level `user` key of
// permission.yaml; other keys (e.g. `smart_approve`) hold cached LLM/annotation
// decisions and are preserved verbatim.
// https://github.com/block/goose/blob/main/crates/goose/src/config/permission.rs
const GOOSE_USER_KEY = "user";

// The catch-all rulesync pattern. Goose permission lists hold whole tool names
// (not per-command/per-path globs), so only a category's catch-all maps onto a
// Goose tool. Non-catch-all patterns cannot be expressed and are reported.
const CATCH_ALL_PATTERN = "*";

// Goose's built-in Developer extension tools are namespaced `extension__tool`.
// rulesync's canonical categories map onto the matching Developer tool name.
// https://block.github.io/goose/docs/mcp/developer-mcp/
const RULESYNC_TO_GOOSE_TOOL_NAME: Record<string, string> = {
  bash: "developer__shell",
  edit: "developer__text_editor",
  // `write` collapses onto the same Developer tool as `edit` (Goose's
  // text_editor handles both read and write); `edit` is the canonical category
  // it maps back to on import.
  write: "developer__text_editor",
};

// Reverse mapping for import. `developer__text_editor` resolves to `edit` (the
// canonical mutation category), so the `write` -> `developer__text_editor`
// forward entry is intentionally not represented here.
const GOOSE_TO_RULESYNC_TOOL_NAME: Record<string, string> = {
  developer__shell: "bash",
  developer__text_editor: "edit",
};

// rulesync canonical action -> Goose permission list key.
const ACTION_TO_GOOSE_LIST: Record<PermissionAction, GoosePermissionListKey> = {
  allow: "always_allow",
  ask: "ask_before",
  deny: "never_allow",
};

const GOOSE_LIST_TO_ACTION: Record<GoosePermissionListKey, PermissionAction> = {
  always_allow: "allow",
  ask_before: "ask",
  never_allow: "deny",
};

type GoosePermissionListKey = "always_allow" | "ask_before" | "never_allow";

const GOOSE_PERMISSION_LIST_KEYS: GoosePermissionListKey[] = [
  "always_allow",
  "ask_before",
  "never_allow",
];

type GoosePermissionConfig = {
  always_allow: string[];
  ask_before: string[];
  never_allow: string[];
};

/**
 * Permissions adapter for Block Goose (codename goose).
 *
 * Goose persists per-tool permission overrides in `~/.config/goose/permission.yaml`,
 * a YAML map of mode key -> `{ always_allow, ask_before, never_allow }` where each
 * field is a list of tool-name strings. rulesync writes user-set decisions under
 * the `user` key; other keys (e.g. the `smart_approve` LLM cache) are preserved
 * verbatim.
 *
 * This surface is **global only** — `permission.yaml` lives under the home
 * directory and Goose has no project-scoped permission file.
 *
 * Mapping (rulesync canonical -> Goose):
 *   - Action: `allow` -> `always_allow`, `ask` -> `ask_before`, `deny` -> `never_allow`.
 *   - Tool name: `bash` -> `developer__shell`, `edit` -> `developer__text_editor`;
 *     any other category passes through verbatim as the Goose tool name (mirrors
 *     the Gemini CLI adapter). `write` collapses onto `developer__text_editor`
 *     too, so a conflicting `edit`/`write` catch-all is reported and `edit` wins.
 *   - Granularity: Goose lists hold whole tool names, so only a category's
 *     catch-all `*` pattern is representable. Non-catch-all patterns cannot be
 *     expressed per-tool and are reported via `logger.warn` and skipped.
 *
 * `permission.yaml` is a dedicated Goose-managed file (not a shared config), so
 * the `user` block is merged in place, every other top-level key is preserved,
 * and the file is never deleted.
 */
export class GoosePermissions extends ToolPermissions {
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
      relativeDirPath: GOOSE_GLOBAL_DIR,
      relativeFilePath: GOOSE_PERMISSIONS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<GoosePermissions> {
    if (!global) {
      throw new Error(GOOSE_GLOBAL_ONLY_MESSAGE);
    }
    const paths = GoosePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";
    return new GoosePermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<GoosePermissions> {
    if (!global) {
      throw new Error(GOOSE_GLOBAL_ONLY_MESSAGE);
    }
    const paths = GoosePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so a dry-run/check does not create the user's
    // global permission.yaml as a side effect (mirrors the Rovodev adapter).
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";

    let parsed: unknown;
    try {
      parsed = existingContent.trim() === "" ? {} : load(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Goose permission.yaml at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const config = isRecord(parsed) ? { ...parsed } : {};

    const userPermission = convertRulesyncToGoosePermissionConfig({
      config: rulesyncPermissions.getJson(),
      logger,
    });

    // Merge into the `user` block, preserving any unmanaged keys inside it and
    // every other top-level key (e.g. the `smart_approve` LLM cache).
    config[GOOSE_USER_KEY] = userPermission;

    return new GoosePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: dump(config),
      validate: true,
      global: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let parsed: unknown;
    try {
      const content = this.getFileContent();
      parsed = content.trim() === "" ? {} : load(content);
    } catch (error) {
      throw new Error(
        `Failed to parse Goose permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = isRecord(parsed) ? parsed : {};
    const userPermission = isRecord(config[GOOSE_USER_KEY]) ? config[GOOSE_USER_KEY] : {};
    const rulesyncConfig = convertGoosePermissionConfigToRulesync(userPermission);

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
  }: ToolPermissionsForDeletionParams): GoosePermissions {
    return new GoosePermissions({
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
 * Convert a rulesync permissions config into a Goose `user` PermissionConfig.
 */
function convertRulesyncToGoosePermissionConfig({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: Logger;
}): GoosePermissionConfig {
  const lists: GoosePermissionConfig = {
    always_allow: [],
    ask_before: [],
    never_allow: [],
  };
  // Tool name -> the action that placed it, so a later category cannot silently
  // shadow an earlier one without a warning.
  const assigned = new Map<string, PermissionAction>();

  // Apply `edit` after `write` so the shared `developer__text_editor` mapping
  // resolves deterministically to `edit`, consistent with the import direction.
  const orderedEntries = Object.entries(config.permission).toSorted(
    ([a], [b]) => (a === "edit" ? 1 : 0) - (b === "edit" ? 1 : 0),
  );

  for (const [category, rules] of orderedEntries) {
    const toolName = RULESYNC_TO_GOOSE_TOOL_NAME[category] ?? category;

    for (const [pattern, action] of Object.entries(rules)) {
      if (pattern !== CATCH_ALL_PATTERN) {
        logger?.warn(
          `Goose permission.yaml lists whole tool names, so the per-pattern "${action}" rule ` +
            `for "${category}" (pattern "${pattern}") cannot be expressed and was skipped.`,
        );
        continue;
      }

      const previous = assigned.get(toolName);
      if (previous !== undefined && previous !== action) {
        logger?.warn(
          `Goose maps "${category}" onto the "${toolName}" tool, which already has a ` +
            `conflicting permission ("${previous}"). The "${action}" value takes precedence.`,
        );
        // Remove the stale assignment so the tool is not listed twice.
        const previousList = lists[ACTION_TO_GOOSE_LIST[previous]];
        const index = previousList.indexOf(toolName);
        if (index !== -1) {
          previousList.splice(index, 1);
        }
      } else if (previous === action) {
        continue;
      }

      lists[ACTION_TO_GOOSE_LIST[action]].push(toolName);
      assigned.set(toolName, action);
    }
  }

  for (const key of GOOSE_PERMISSION_LIST_KEYS) {
    lists[key] = [...new Set(lists[key])].toSorted();
  }

  return lists;
}

/**
 * Convert a Goose `user` PermissionConfig back into a rulesync config.
 */
function convertGoosePermissionConfigToRulesync(
  userPermission: Record<string, unknown>,
): PermissionsConfig {
  const permission: PermissionsConfig["permission"] = {};

  for (const key of GOOSE_PERMISSION_LIST_KEYS) {
    const toolNames = isStringArray(userPermission[key]) ? userPermission[key] : [];
    const action = GOOSE_LIST_TO_ACTION[key];
    for (const toolName of toolNames) {
      const category = GOOSE_TO_RULESYNC_TOOL_NAME[toolName] ?? toolName;
      permission[category] ??= {};
      permission[category][CATCH_ALL_PATTERN] = action;
    }
  }

  return { permission };
}

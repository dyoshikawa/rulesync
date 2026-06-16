import { join } from "node:path";

import { dump, load } from "js-yaml";

import { ROVODEV_CONFIG_FILE_NAME, ROVODEV_DIR } from "../../constants/rovodev-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { PermissionActionSchema } from "../../types/permissions.js";
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

const ROVODEV_GLOBAL_ONLY_MESSAGE =
  "Rovodev permissions are global-only; use --global to sync ~/.rovodev/config.yml";

// The catch-all pattern in a rulesync category. It maps to a Rovo Dev per-tool
// default level (or `bash.default`) rather than to a `bash.commands[]` regex.
const CATCH_ALL_PATTERN = "*";

// Rovo Dev's per-tool permission keys. Each holds a single level (no per-pattern
// rules), so a whole rulesync category maps to one of these via its catch-all.
// https://support.atlassian.com/rovo/docs/use-tools-in-rovo-dev-cli/
type RovodevToolPermissionKey =
  | "create_file"
  | "delete_file"
  | "move_file"
  | "find_and_replace_code"
  | "open_files"
  | "expand_code_chunks"
  | "expand_folder"
  | "grep";

// Maps a rulesync canonical category to the Rovo Dev per-tool keys it controls.
// The mapping is intentionally conservative: only categories with a clean Rovo
// Dev counterpart are translated; everything else is reported and skipped.
//   - `read`  -> the read/inspection tools.
//   - `edit`/`write` -> the file mutation tools.
// `bash` is handled separately (it owns `bash.default`/`bash.commands`).
const CATEGORY_TO_TOOL_KEYS: Record<string, RovodevToolPermissionKey[]> = {
  read: ["open_files", "expand_code_chunks", "expand_folder", "grep"],
  edit: ["find_and_replace_code", "create_file", "delete_file", "move_file"],
  write: ["create_file", "delete_file", "move_file", "find_and_replace_code"],
};

// Reverse of CATEGORY_TO_TOOL_KEYS: which canonical category a Rovo Dev tool key
// maps back to on import. `edit` is preferred over `write` because the forward
// mapping keys overlap and `edit` is the canonical mutation category rulesync
// emits first.
const TOOL_KEY_TO_CATEGORY: Record<RovodevToolPermissionKey, "read" | "edit"> = {
  open_files: "read",
  expand_code_chunks: "read",
  expand_folder: "read",
  grep: "read",
  find_and_replace_code: "edit",
  create_file: "edit",
  delete_file: "edit",
  move_file: "edit",
};

type RovodevBashCommand = {
  command: string;
  permission: PermissionAction;
};

type RovodevBash = {
  default?: PermissionAction;
  commands?: RovodevBashCommand[];
};

type RovodevToolPermissions = {
  bash?: RovodevBash;
  allowedExternalPaths?: string[];
} & Partial<Record<RovodevToolPermissionKey, PermissionAction>>;

/**
 * Permissions adapter for Rovo Dev CLI.
 *
 * Rovo Dev reads tool permissions from the `toolPermissions` block of the global
 * `~/.rovodev/config.yml`. This surface is **global only** — there is no
 * project-scoped Rovo Dev permissions file (mirrors the Rovodev MCP adapter).
 *
 * Rovo Dev's three levels (`allow`/`ask`/`deny`) are an exact 1:1 with rulesync's
 * canonical action enum, so action values pass through verbatim.
 *
 * Mapping decisions (rulesync canonical -> Rovo Dev):
 *   - `bash`: the catch-all `*` pattern -> `bash.default`; every other pattern ->
 *     a `bash.commands[]` entry `{ command: <pattern as regex>, permission }`.
 *   - `read` -> the inspection tools (`open_files`, `expand_code_chunks`,
 *     `expand_folder`, `grep`); `edit`/`write` -> the mutation tools
 *     (`find_and_replace_code`, `create_file`, `delete_file`, `move_file`).
 *     These Rovo Dev keys hold a single level (no per-pattern rules), so only the
 *     catch-all `*` of each category sets the level. Non-catch-all `allow` rules
 *     in those categories are surfaced as `allowedExternalPaths` so explicit path
 *     grants are not silently dropped; non-`allow` non-catch-all rules cannot be
 *     expressed per-path and are reported via `logger.warn` and skipped.
 *   - Any other canonical category has no clean Rovo Dev target and is reported
 *     and skipped rather than invented.
 *
 * `config.yml` holds all of Rovo Dev's settings (`agent`, `sessions`, `mcp`,
 * etc.), so the `toolPermissions` block is merged in place, every other top-level
 * key is preserved, and the file is never deleted.
 */
export class RovodevPermissions extends ToolPermissions {
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
      relativeDirPath: ROVODEV_DIR,
      relativeFilePath: ROVODEV_CONFIG_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<RovodevPermissions> {
    if (!global) {
      throw new Error(ROVODEV_GLOBAL_ONLY_MESSAGE);
    }
    const paths = RovodevPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";
    return new RovodevPermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<RovodevPermissions> {
    if (!global) {
      throw new Error(ROVODEV_GLOBAL_ONLY_MESSAGE);
    }
    const paths = RovodevPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so a dry-run/check does not create the user's
    // global config.yml as a side effect (mirrors the Warp/Zed adapters).
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";

    let parsed: unknown;
    try {
      parsed = existingContent.trim() === "" ? {} : load(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Rovodev config at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const config = isRecord(parsed) ? { ...parsed } : {};

    const toolPermissions = convertRulesyncToRovodevToolPermissions({
      config: rulesyncPermissions.getJson(),
      logger,
    });

    // Merge into `toolPermissions`, preserving every other top-level key
    // (`agent`, `sessions`, `mcp`, etc.) and any unmanaged keys inside the
    // existing `toolPermissions` block.
    const existingToolPermissions = isRecord(config.toolPermissions)
      ? { ...config.toolPermissions }
      : {};
    config.toolPermissions = { ...existingToolPermissions, ...toolPermissions };

    return new RovodevPermissions({
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
        `Failed to parse Rovodev permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = isRecord(parsed) ? parsed : {};
    const toolPermissions = isRecord(config.toolPermissions) ? config.toolPermissions : {};
    const rulesyncConfig = convertRovodevToolPermissionsToRulesync(toolPermissions);

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
  }: ToolPermissionsForDeletionParams): RovodevPermissions {
    return new RovodevPermissions({
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
 * Convert a rulesync permissions config into a Rovo Dev `toolPermissions` block.
 */
function convertRulesyncToRovodevToolPermissions({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: Logger;
}): RovodevToolPermissions {
  const toolPermissions: RovodevToolPermissions = {};
  const allowedExternalPaths: string[] = [];

  for (const [category, rules] of Object.entries(config.permission)) {
    if (category === "bash") {
      const bash = convertBashRules(rules);
      if (bash) {
        toolPermissions.bash = bash;
      }
      continue;
    }

    const toolKeys = CATEGORY_TO_TOOL_KEYS[category];
    if (!toolKeys) {
      logger?.warn(
        `Rovo Dev permissions have no target for the "${category}" category. Skipping it.`,
      );
      continue;
    }

    for (const [pattern, action] of Object.entries(rules)) {
      if (pattern === CATCH_ALL_PATTERN) {
        for (const toolKey of toolKeys) {
          toolPermissions[toolKey] = action;
        }
        continue;
      }

      // Per-tool keys carry a single level (no per-pattern rules). A path that
      // is explicitly allowed can still be surfaced via `allowedExternalPaths`;
      // anything else cannot be expressed per-path, so warn and skip.
      if (action === "allow") {
        allowedExternalPaths.push(pattern);
        continue;
      }
      logger?.warn(
        `Rovo Dev cannot express per-path "${action}" for the "${category}" category (pattern "${pattern}"). Skipping it.`,
      );
    }
  }

  if (allowedExternalPaths.length > 0) {
    toolPermissions.allowedExternalPaths = [...new Set(allowedExternalPaths)].toSorted();
  }

  return toolPermissions;
}

function convertBashRules(rules: Record<string, PermissionAction>): RovodevBash | undefined {
  const bash: RovodevBash = {};
  const commands: RovodevBashCommand[] = [];

  for (const [pattern, action] of Object.entries(rules)) {
    if (pattern === CATCH_ALL_PATTERN) {
      bash.default = action;
      continue;
    }
    commands.push({ command: pattern, permission: action });
  }

  if (commands.length > 0) {
    bash.commands = commands;
  }

  return Object.keys(bash).length > 0 ? bash : undefined;
}

/**
 * Convert a Rovo Dev `toolPermissions` block back into a rulesync config.
 */
function convertRovodevToolPermissionsToRulesync(
  toolPermissions: Record<string, unknown>,
): PermissionsConfig {
  const permission: PermissionsConfig["permission"] = {};

  const bash = toolPermissions.bash;
  if (isRecord(bash)) {
    const bashRules: Record<string, PermissionAction> = {};
    if (isPermissionAction(bash.default)) {
      bashRules[CATCH_ALL_PATTERN] = bash.default;
    }
    if (Array.isArray(bash.commands)) {
      for (const entry of bash.commands) {
        if (
          isRecord(entry) &&
          typeof entry.command === "string" &&
          isPermissionAction(entry.permission)
        ) {
          bashRules[entry.command] = entry.permission;
        }
      }
    }
    if (Object.keys(bashRules).length > 0) {
      permission.bash = bashRules;
    }
  }

  for (const [toolKey, category] of Object.entries(TOOL_KEY_TO_CATEGORY)) {
    const value = toolPermissions[toolKey];
    if (isPermissionAction(value)) {
      permission[category] ??= {};
      permission[category][CATCH_ALL_PATTERN] = value;
    }
  }

  if (isStringArray(toolPermissions.allowedExternalPaths)) {
    for (const path of toolPermissions.allowedExternalPaths) {
      permission.read ??= {};
      permission.read[path] = "allow";
    }
  }

  return { permission };
}

function isPermissionAction(value: unknown): value is PermissionAction {
  return PermissionActionSchema.safeParse(value).success;
}

import { join } from "node:path";

import { dump } from "js-yaml";

import { ROVODEV_CONFIG_FILE_NAME, ROVODEV_DIR } from "../../constants/rovodev-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { PermissionActionSchema } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import { loadYaml } from "../../utils/yaml.js";
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

// Every per-tool key rulesync writes, from both directions of the mapping so a
// key added to only one of them is still cleaned up on the next generate.
const MANAGED_TOOL_KEYS: readonly string[] = [
  ...new Set([
    ...Object.values(CATEGORY_TO_TOOL_KEYS).flat(),
    ...Object.keys(TOOL_KEY_TO_CATEGORY),
  ]),
];

// Keys directly under `toolPermissions` that rulesync rewrites from
// `.rulesync/permissions.*` on every generate. `tools` is handled separately
// because only the managed tool keys inside it are owned.
const OWNED_TOOL_PERMISSION_KEYS = ["bash", "allowedExternalPaths"] as const;

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
  /**
   * Per-tool levels live one level down, under `toolPermissions.tools`. Writing
   * them directly under `toolPermissions` produces a file Rovo Dev ignores.
   *
   * @see https://support.atlassian.com/rovo/docs/use-tools-in-rovo-dev-cli/
   */
  tools?: Partial<Record<RovodevToolPermissionKey, PermissionAction>>;
};

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
      parsed = existingContent.trim() === "" ? {} : loadYaml(existingContent);
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
    // A rulesync source with nothing this adapter can express — only categories
    // Rovo Dev has no target for, say — leaves the block alone. Clearing the
    // owned keys would relax the user's levels back to Rovo Dev's defaults
    // without a single rule of our own to put in their place.
    if (Object.keys(toolPermissions).length === 0) {
      return new RovodevPermissions({
        outputRoot,
        relativeDirPath: paths.relativeDirPath,
        relativeFilePath: paths.relativeFilePath,
        fileContent: dump(config),
        validate: true,
        global: true,
      });
    }
    const hasExistingToolsRecord = isRecord(existingToolPermissions.tools);
    const existingTools = hasExistingToolsRecord
      ? { ...(existingToolPermissions.tools as Record<string, unknown>) }
      : {};
    // Ownership means a rule that is gone from the rulesync source is gone from
    // the file, but `allowedExternalPaths` in particular is also written from
    // inside a Rovo Dev session by `/directories`, so say what is being dropped
    // rather than let it vanish silently.
    const droppedKeys = OWNED_TOOL_PERMISSION_KEYS.filter(
      (ownedKey) =>
        existingToolPermissions[ownedKey] !== undefined && toolPermissions[ownedKey] === undefined,
    );
    if (droppedKeys.length > 0) {
      logger?.warn(
        `Rovo Dev permissions: removing ${droppedKeys.map((key) => `"${key}"`).join(", ")} from ` +
          `${filePath} because the rulesync source no longer produces it.`,
      );
    }

    // Every key rulesync manages is owned, so drop whatever a previous run left
    // behind before writing the current set. Without this, a rule the user has
    // since removed from `.rulesync/permissions.*` stays in the file: still live
    // in `tools`/`bash`/`allowedExternalPaths`, and — for the legacy flat
    // per-tool copies an older rulesync wrote one level up, which Rovo Dev
    // ignores but this adapter still imports — resurrected on the next import.
    // Tool keys rulesync has no category for are left untouched.
    for (const ownedKey of OWNED_TOOL_PERMISSION_KEYS) {
      delete existingToolPermissions[ownedKey];
    }
    for (const toolKey of MANAGED_TOOL_KEYS) {
      delete existingToolPermissions[toolKey];
      delete existingTools[toolKey];
    }
    const tools = { ...existingTools, ...toolPermissions.tools };
    if (hasExistingToolsRecord) {
      // Re-added below only when non-empty, so an emptied block leaves no
      // `tools: {}`. A `tools` of some other shape is not ours to interpret, so
      // it is left in place unless this run has per-tool levels to write there.
      delete existingToolPermissions.tools;
    }
    config.toolPermissions = {
      ...existingToolPermissions,
      ...toolPermissions,
      ...(Object.keys(tools).length > 0 ? { tools } : {}),
    };

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
      parsed = content.trim() === "" ? {} : loadYaml(content);
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

  // `edit` and `write` collapse onto the same Rovo Dev file-mutation tools, so a
  // conflicting catch-all between them cannot be represented. Warn that the loss
  // is happening, and keep the stricter of the two — the same fail-closed rule
  // the import direction uses when those tools disagree, so the resolution never
  // grants more than the author asked for.
  const editCatchAll = config.permission.edit?.[CATCH_ALL_PATTERN];
  const writeCatchAll = config.permission.write?.[CATCH_ALL_PATTERN];
  if (editCatchAll && writeCatchAll && editCatchAll !== writeCatchAll) {
    logger?.warn(
      `Rovo Dev maps both "edit" and "write" onto the same file-mutation tools, but they have ` +
        `conflicting catch-all permissions ("edit": "${editCatchAll}", "write": "${writeCatchAll}"). ` +
        `The stricter of the two ("${strictestAction(editCatchAll, writeCatchAll)}") is used.`,
    );
  }

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
        toolPermissions.tools ??= {};
        for (const toolKey of toolKeys) {
          // `edit` and `write` write to the same keys, so fold rather than
          // overwrite; with one category per key this just stores `action`.
          toolPermissions.tools[toolKey] = strictestAction(toolPermissions.tools[toolKey], action);
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

  // Read from `toolPermissions.tools`, falling back to the top level for a file
  // an earlier rulesync wrote at the wrong depth, so those still import.
  const nestedTools = isRecord(toolPermissions.tools) ? toolPermissions.tools : {};
  for (const [toolKey, category] of Object.entries(TOOL_KEY_TO_CATEGORY)) {
    // `tools` is what Rovo Dev actually reads, so a key present there settles
    // the level even when its value is unusable; the legacy flat copy is only
    // consulted when `tools` says nothing about the key at all.
    const value = Object.hasOwn(nestedTools, toolKey)
      ? nestedTools[toolKey]
      : toolPermissions[toolKey];
    if (!isPermissionAction(value)) {
      continue;
    }
    permission[category] ??= {};
    // A category maps onto four tool keys that can disagree — Rovo Dev rewrites
    // a single key when the user answers "always allow" to one prompt. They
    // collapse back onto one catch-all here, so take the strictest rather than
    // whichever key is iterated last, which would quietly widen the other three.
    const current = permission[category][CATCH_ALL_PATTERN];
    permission[category][CATCH_ALL_PATTERN] = strictestAction(current, value);
  }

  if (isStringArray(toolPermissions.allowedExternalPaths)) {
    for (const path of toolPermissions.allowedExternalPaths) {
      permission.read ??= {};
      // Never widen a level already read from the tool keys: the `/directories`
      // command edits this list from inside a Rovo Dev session, so a stray `*`
      // entry would otherwise turn a `read` deny into an allow.
      permission.read[path] ??= "allow";
    }
  }

  return { permission };
}

// Ordered strictest first, so two levels that collapse onto one canonical rule
// resolve to the safer of the pair rather than to iteration order.
const ACTION_STRICTNESS: readonly PermissionAction[] = ["deny", "ask", "allow"];

function strictestAction(
  current: PermissionAction | undefined,
  candidate: PermissionAction,
): PermissionAction {
  if (current === undefined) {
    return candidate;
  }
  return ACTION_STRICTNESS.indexOf(current) <= ACTION_STRICTNESS.indexOf(candidate)
    ? current
    : candidate;
}

function isPermissionAction(value: unknown): value is PermissionAction {
  return PermissionActionSchema.safeParse(value).success;
}

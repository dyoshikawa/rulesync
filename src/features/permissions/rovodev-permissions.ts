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
import {
  ROVODEV_CONFIG_SHARED_FILE_KEY,
  applySharedConfigPatch,
} from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

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
  | "grep"
  // The planning and Atlassian tools. These reach Jira and Confluence rather
  // than the working tree, but they split the same way the file tools do —
  // `get*` inspects, `create*`/`update*` mutates — so they ride the canonical
  // `read`/`edit` categories rather than inventing a category for them.
  // `createTechnicalPlan` is grouped with the mutating tools because it is the
  // planning tool that produces an artifact rather than reading one.
  | "createTechnicalPlan"
  | "getJiraIssue"
  | "createJiraIssue"
  | "updateJiraIssue"
  | "getConfluencePage"
  | "createConfluencePage"
  | "updateConfluencePage";

// Maps a rulesync canonical category to the Rovo Dev per-tool keys it controls.
// The mapping is intentionally conservative: only categories with a clean Rovo
// Dev counterpart are translated; everything else is reported and skipped.
//   - `read`  -> the read/inspection tools.
//   - `edit`/`write` -> the file mutation tools.
// `bash` is handled separately (it owns `bash.default`/`bash.commands`).
const CATEGORY_TO_TOOL_KEYS: Record<string, RovodevToolPermissionKey[]> = {
  read: [
    "open_files",
    "expand_code_chunks",
    "expand_folder",
    "grep",
    "getJiraIssue",
    "getConfluencePage",
  ],
  edit: [
    "find_and_replace_code",
    "create_file",
    "delete_file",
    "move_file",
    "createTechnicalPlan",
    "createJiraIssue",
    "updateJiraIssue",
    "createConfluencePage",
    "updateConfluencePage",
  ],
  write: [
    "create_file",
    "delete_file",
    "move_file",
    "find_and_replace_code",
    "createTechnicalPlan",
    "createJiraIssue",
    "updateJiraIssue",
    "createConfluencePage",
    "updateConfluencePage",
  ],
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
  getJiraIssue: "read",
  getConfluencePage: "read",
  find_and_replace_code: "edit",
  create_file: "edit",
  delete_file: "edit",
  move_file: "edit",
  createTechnicalPlan: "edit",
  createJiraIssue: "edit",
  updateJiraIssue: "edit",
  createConfluencePage: "edit",
  updateConfluencePage: "edit",
};

// Every per-tool key rulesync writes, from both directions of the mapping so a
// key added to only one of them is still cleaned up on the next generate.
const MANAGED_TOOL_KEYS: readonly RovodevToolPermissionKey[] = [
  ...new Set([
    ...Object.values(CATEGORY_TO_TOOL_KEYS).flat(),
    ...(Object.keys(TOOL_KEY_TO_CATEGORY) as RovodevToolPermissionKey[]),
  ]),
];

// Keys directly under `toolPermissions` that rulesync rewrites from
// `.rulesync/permissions.*` on every generate. `tools` is handled separately
// because only the managed tool keys inside it are owned.
const OWNED_TOOL_PERMISSION_KEYS = ["bash", "allowedExternalPaths", "default"] as const;

type RovodevBashCommand = {
  command: string;
  permission: PermissionAction;
};

type RovodevBash = {
  default?: PermissionAction;
  commands?: RovodevBashCommand[];
};

type RovodevToolPermissions = {
  /**
   * The level applied to any tool with no more specific setting. Rovo Dev
   * defaults it to `ask`.
   *
   * @see https://support.atlassian.com/rovo/docs/manage-rovo-dev-cli-settings/
   */
  default?: PermissionAction;
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
 * Rovo Dev reads tool permissions from the `toolPermissions` block of
 * `config.yml` — the global `~/.rovodev/config.yml`, and since the Bitbucket
 * Cloud Agentic Pipelines docs, also the repo-committed project
 * `.rovodev/config.yml` (referenced from `bitbucket-pipelines.yml` via
 * `config.path`, or the `--config-file` CLI flag). Both scopes use the
 * same relative path, resolved against the project root or home directory.
 *
 * Rovo Dev's three levels (`allow`/`ask`/`deny`) are an exact 1:1 with rulesync's
 * canonical action enum, so action values pass through verbatim.
 *
 * Mapping decisions (rulesync canonical -> Rovo Dev):
 *   - `bash`: the catch-all `*` pattern -> `bash.default`; every other pattern ->
 *     a `bash.commands[]` entry `{ command: <pattern as regex>, permission }`.
 *   - the all-tools category `*`: its catch-all -> `toolPermissions.default`,
 *     the level Rovo Dev falls back to for any tool with no more specific
 *     setting (Rovo Dev's own default is `ask`).
 *   - `read` -> the inspection tools (`open_files`, `expand_code_chunks`,
 *     `expand_folder`, `grep`, `getJiraIssue`, `getConfluencePage`);
 *     `edit`/`write` -> the mutation tools (`find_and_replace_code`,
 *     `create_file`, `delete_file`, `move_file`, `createTechnicalPlan`,
 *     `createJiraIssue`, `updateJiraIssue`, `createConfluencePage`,
 *     `updateConfluencePage`) — so these two categories reach Jira and
 *     Confluence, not just the working tree.
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
    const paths = RovodevPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";
    return new RovodevPermissions({
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
    logger,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<RovodevPermissions> {
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

    const rulesyncConfig = rulesyncPermissions.getJson();
    const toolPermissions = convertRulesyncToRovodevToolPermissions({
      config: rulesyncConfig,
      logger,
    });
    const resolvedToolPermissions = resolveToolPermissionsBlock({
      existing: config.toolPermissions,
      generated: toolPermissions,
      // A source that states no rule at all is a deliberate clean slate; one
      // whose rules Rovo Dev simply cannot express is not.
      sourceStatesRules: Object.values(rulesyncConfig.permission).some(
        (rules) => Object.keys(rules).length > 0,
      ),
      filePath,
      logger,
    });
    // `undefined` means the block is not this run's to touch, so a `config.yml`
    // without one does not gain an empty `toolPermissions:`. The write goes
    // through the shared-config gateway: the MCP feature also patches this
    // file (its `mcp.disabledMcpServers` auxiliary write), so both writers
    // must declare ownership instead of hand-rolling the merge.
    const fileContent =
      resolvedToolPermissions !== undefined
        ? applySharedConfigPatch({
            fileKey: ROVODEV_CONFIG_SHARED_FILE_KEY,
            feature: "permissions",
            existingContent,
            patch: { toolPermissions: resolvedToolPermissions },
            filePath,
          })
        : dump(config);

    return new RovodevPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate: true,
      global,
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
 * Resolve the `toolPermissions` block to write, merging the generated levels
 * over the existing file. Every other top-level key of `config.yml` is the
 * caller's to preserve; inside this block, keys rulesync manages are owned and
 * keys it does not are kept as-is.
 */
function resolveToolPermissionsBlock({
  existing,
  generated,
  sourceStatesRules,
  filePath,
  logger,
}: {
  existing: unknown;
  generated: RovodevToolPermissions;
  sourceStatesRules: boolean;
  filePath: string;
  logger?: Logger;
}): Record<string, unknown> | undefined {
  const existingToolPermissions = isRecord(existing) ? { ...existing } : {};

  if (Object.keys(generated).length === 0 && sourceStatesRules) {
    if (!isRecord(existing)) {
      // Nothing of ours to write and nothing of theirs to read: an absent block
      // stays absent, and one of some other shape is left for its author.
      return undefined;
    }
    // Nothing to write, so the block stays — except for the grants a previous
    // run left there. Whatever the user revoked is in that set, and dropping an
    // `allow` only ever falls back to Rovo Dev's stricter default, so this half
    // of the ownership is safe to apply with nothing to replace it with.
    const strippedKeys = stripPermissiveOwnedValues(existingToolPermissions);
    logger?.warn(
      `Rovo Dev permissions: the rulesync source produced no rule Rovo Dev can express, so the ` +
        `toolPermissions block in ${filePath} keeps its current levels` +
        (strippedKeys.length > 0
          ? `, minus the grants ${strippedKeys.map((key) => `"${key}"`).join(", ")}.`
          : `.`),
    );
    return existingToolPermissions;
  }

  const hasExistingToolsRecord = isRecord(existingToolPermissions.tools);
  const existingTools = hasExistingToolsRecord
    ? { ...(existingToolPermissions.tools as Record<string, unknown>) }
    : {};
  warnAboutDroppedOwnedKeys({
    existingToolPermissions,
    existingTools,
    generated,
    filePath,
    logger,
  });

  // Every key rulesync manages is owned, so drop whatever a previous run left
  // behind before writing the current set. Without this, a rule the user has
  // since removed from `.rulesync/permissions.*` stays in the file: still live
  // in `tools`/`bash`/`allowedExternalPaths`, and — for the legacy flat per-tool
  // copies an older rulesync wrote one level up, which Rovo Dev ignores but this
  // adapter still imports — resurrected on the next import. Tool keys rulesync
  // has no category for are left untouched.
  for (const ownedKey of OWNED_TOOL_PERMISSION_KEYS) {
    delete existingToolPermissions[ownedKey];
  }
  for (const toolKey of MANAGED_TOOL_KEYS) {
    delete existingToolPermissions[toolKey];
    delete existingTools[toolKey];
  }
  const tools = { ...existingTools, ...generated.tools };
  if (hasExistingToolsRecord) {
    // Re-added below only when non-empty, so an emptied block leaves no
    // `tools: {}`. A `tools` of some other shape is not ours to interpret, so it
    // is left in place unless this run has levels to write there.
    delete existingToolPermissions.tools;
  }
  return {
    ...existingToolPermissions,
    ...generated,
    ...(Object.keys(tools).length > 0 ? { tools } : {}),
  };
}

/**
 * Name the owned keys this generate is about to remove. `allowedExternalPaths`
 * and the per-tool levels are written from inside a Rovo Dev session too — by
 * `/directories` and by an "always allow" answer to a prompt — so their removal
 * must not be silent.
 */
function warnAboutDroppedOwnedKeys({
  existingToolPermissions,
  existingTools,
  generated,
  filePath,
  logger,
}: {
  existingToolPermissions: Record<string, unknown>;
  existingTools: Record<string, unknown>;
  generated: RovodevToolPermissions;
  filePath: string;
  logger?: Logger;
}): void {
  const newTools = generated.tools ?? {};
  const droppedKeys = [
    ...OWNED_TOOL_PERMISSION_KEYS.filter(
      (ownedKey) =>
        existingToolPermissions[ownedKey] !== undefined && generated[ownedKey] === undefined,
    ),
    // Only the nested block counts — the legacy flat copies are keys Rovo Dev
    // never read, so removing one loses nothing.
    ...MANAGED_TOOL_KEYS.filter(
      (toolKey) => existingTools[toolKey] !== undefined && newTools[toolKey] === undefined,
    ).map((toolKey) => `tools.${toolKey}`),
  ];
  if (droppedKeys.length > 0) {
    logger?.warn(
      `Rovo Dev permissions: removing ${droppedKeys.map((key) => `"${key}"`).join(", ")} from ` +
        `${filePath} because the rulesync source no longer produces them.`,
    );
  }
}

/**
 * Remove the permissive values rulesync owns, leaving the restrictive ones in
 * place. Used when a generate has no rule of its own to write: dropping an
 * `allow` hands the decision back to Rovo Dev's default, so it can never grant
 * more than the file already did.
 */
function stripPermissiveOwnedValues(toolPermissions: Record<string, unknown>): string[] {
  const strippedKeys: string[] = [];

  if (isRecord(toolPermissions.tools)) {
    const tools = { ...toolPermissions.tools };
    for (const toolKey of MANAGED_TOOL_KEYS) {
      if (tools[toolKey] === "allow") {
        delete tools[toolKey];
        strippedKeys.push(`tools.${toolKey}`);
      }
    }
    if (Object.keys(tools).length > 0) {
      toolPermissions.tools = tools;
    } else {
      delete toolPermissions.tools;
    }
  }

  // The legacy copies one level up are keys Rovo Dev never reads, but this
  // adapter still imports them, so a stale grant there is worth the same sweep.
  for (const toolKey of MANAGED_TOOL_KEYS) {
    if (toolPermissions[toolKey] === "allow") {
      delete toolPermissions[toolKey];
      strippedKeys.push(toolKey);
    }
  }

  if (toolPermissions.allowedExternalPaths !== undefined) {
    delete toolPermissions.allowedExternalPaths;
    strippedKeys.push("allowedExternalPaths");
  }

  // A tool-wide `allow` default is the widest grant in the file, so it goes
  // the same way `bash.default: allow` does — dropping it hands the decision
  // back to Rovo Dev's own `ask` default.
  if (toolPermissions.default === "allow") {
    delete toolPermissions.default;
    strippedKeys.push("default");
  }

  const bash = toolPermissions.bash;
  if (isRecord(bash)) {
    const stripped: Record<string, unknown> = { ...bash };
    if (stripped.default === "allow") {
      delete stripped.default;
      strippedKeys.push("bash.default");
    }
    if (Array.isArray(stripped.commands)) {
      const kept = stripped.commands.filter(
        (entry) => !(isRecord(entry) && entry.permission === "allow"),
      );
      if (kept.length !== stripped.commands.length) {
        strippedKeys.push("bash.commands");
      }
      if (kept.length > 0) {
        stripped.commands = kept;
      } else {
        delete stripped.commands;
      }
    }
    // An emptied container is not itself a grant, so it is not named again.
    if (Object.keys(stripped).length > 0) {
      toolPermissions.bash = stripped;
    } else {
      delete toolPermissions.bash;
    }
  }

  return strippedKeys;
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

  warnOnEditWriteConflict({ config, logger });

  for (const [category, rules] of Object.entries(config.permission)) {
    if (category === CATCH_ALL_PATTERN) {
      const toolWideDefault = convertAllToolsRules({ rules, logger });
      if (toolWideDefault) {
        toolPermissions.default = toolWideDefault;
      }
      continue;
    }

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

/**
 * `edit` and `write` collapse onto the same Rovo Dev file-mutation tools, so a
 * conflicting catch-all between them cannot be represented. Warn that the loss
 * is happening; the conversion keeps the stricter of the two — the same
 * fail-closed rule the import direction uses when those tools disagree, so the
 * resolution never grants more than the author asked for.
 */
function warnOnEditWriteConflict({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: Logger | undefined;
}): void {
  const editCatchAll = config.permission.edit?.[CATCH_ALL_PATTERN];
  const writeCatchAll = config.permission.write?.[CATCH_ALL_PATTERN];
  if (editCatchAll && writeCatchAll && editCatchAll !== writeCatchAll) {
    logger?.warn(
      `Rovo Dev maps both "edit" and "write" onto the same file-mutation tools, but they have ` +
        `conflicting catch-all permissions ("edit": "${editCatchAll}", "write": "${writeCatchAll}"). ` +
        `The stricter of the two ("${strictestAction(editCatchAll, writeCatchAll)}") is used.`,
    );
  }
}

/**
 * The canonical all-tools category. Its catch-all sets the tool-wide
 * `toolPermissions.default`, the same way `bash`'s catch-all sets
 * `bash.default` — both are the level Rovo Dev falls back to. Pattern rules
 * under `*` have no counterpart (the default is a single level), so they are
 * reported and skipped like any other rule Rovo Dev cannot express.
 */
function convertAllToolsRules({
  rules,
  logger,
}: {
  rules: Record<string, PermissionAction>;
  logger?: Logger | undefined;
}): PermissionAction | undefined {
  let toolWideDefault: PermissionAction | undefined;
  for (const [pattern, action] of Object.entries(rules)) {
    if (pattern === CATCH_ALL_PATTERN) {
      toolWideDefault = action;
      continue;
    }
    logger?.warn(
      `Rovo Dev's tool-wide default is a single level, so it cannot express the ` +
        `pattern "${pattern}" in the "*" category. Skipping it.`,
    );
  }
  return toolWideDefault;
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

  // The tool-wide fallback level comes back as the canonical all-tools category,
  // mirroring how `bash.default` comes back as `bash`'s catch-all.
  if (isPermissionAction(toolPermissions.default)) {
    permission[CATCH_ALL_PATTERN] = { [CATCH_ALL_PATTERN]: toolPermissions.default };
  }

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
  // The level Rovo Dev applies to a tool key the file says nothing about.
  const implicitLevel: PermissionAction = isPermissionAction(toolPermissions.default)
    ? toolPermissions.default
    : "ask";

  for (const category of new Set(Object.values(TOOL_KEY_TO_CATEGORY))) {
    // `tools` is what Rovo Dev actually reads, so a key present there settles
    // the level even when its value is unusable; the legacy flat copy is only
    // consulted when `tools` says nothing about the key at all.
    const levels = (Object.entries(TOOL_KEY_TO_CATEGORY) as [RovodevToolPermissionKey, string][])
      .filter(([, mapped]) => mapped === category)
      .map(([toolKey]) => {
        const value = Object.hasOwn(nestedTools, toolKey)
          ? nestedTools[toolKey]
          : toolPermissions[toolKey];
        return isPermissionAction(value) ? value : undefined;
      });

    // A category the file says nothing about at all is not a rule; giving it the
    // implicit level here would invent one for every category in every file.
    if (levels.every((level) => level === undefined)) {
      continue;
    }

    // A category maps onto several tool keys that can disagree — Rovo Dev
    // rewrites a single key when the user answers "always allow" to one prompt.
    // They collapse back onto one catch-all here, taking the strictest rather
    // than whichever key is iterated last, which would quietly widen the rest.
    //
    // A key the file is silent about counts as the implicit level rather than
    // as absent. Without that, one "always allow" answer about `create_file`
    // would import as a blanket `edit: allow`, and the next generate would hand
    // that grant to every other tool of the category — Jira and Confluence
    // writes included, now that they ride the same category.
    permission[category] ??= {};
    permission[category][CATCH_ALL_PATTERN] = levels.reduce<PermissionAction>(
      (strictest, level) => strictestAction(strictest, level ?? implicitLevel)!,
      permission[category][CATCH_ALL_PATTERN]!,
    );
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

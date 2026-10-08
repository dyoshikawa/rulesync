import { join } from "node:path";

import { BOB_GLOBAL_SETTINGS_DIR_PATH, BOB_SETTINGS_FILE_NAME } from "../../constants/bob-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type {
  BobPermissionsOverride,
  PermissionAction,
  PermissionsConfig,
} from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
import { isPlainObject } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ALL_TOOLS_PERMISSION_CATEGORY,
  collectShellCommandRules,
  partitionCommandRules,
  SHELL_PERMISSION_CATEGORY,
  warnAboutUnwrittenCommandRules,
} from "./shell-command-categories.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";
import { buildVscodeCommandLists } from "./vscode-command-lists.js";

const TOOL_LABEL = "IBM Bob";

/** The top-level settings key holding Bob's auto-approval configuration. */
const APPROVAL_KEY = "approval";

/** The top-level settings key holding Bob's per-feature auto-approve toggles. */
const AUTO_APPROVE_KEY = "autoApprove";

/** The tool permission groups Bob documents for `approval.allowed_permissions`. */
const BOB_PERMISSION_GROUP_IDS: ReadonlySet<string> = new Set([
  "read",
  "edit",
  "execute",
  "mcp",
  "skill",
  "todo",
  "subtask",
  "subagent",
  "mode",
]);

type BobOverrideApproval = NonNullable<BobPermissionsOverride["approval"]>;

/** The only executor tool Bob's `allowedExecutors` list documents. */
const EXECUTE_COMMAND_TOOL_ID = "execute_command";

const SURFACE_LABEL = `${APPROVAL_KEY}.allowedExecutors[${EXECUTE_COMMAND_TOOL_ID}].approvedCommands/deniedCommands`;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function isExecuteCommandEntry(entry: unknown): entry is Record<string, unknown> {
  return isPlainObject(entry) && entry.toolId === EXECUTE_COMMAND_TOOL_ID;
}

function parseBobSettings({
  fileContent,
  filePath,
}: {
  fileContent: string;
  filePath: string;
}): Record<string, unknown> {
  try {
    // The file holds unrelated Bob settings (hooks, locale, ...), so a broken
    // file is refused rather than partially read or replaced.
    return parseSharedConfig({
      format: "json",
      fileContent: fileContent || "{}",
      filePath,
      invalidRootPolicy: "error",
    });
  } catch (error) {
    throw new Error(`Failed to parse IBM Bob settings in ${filePath}: ${formatError(error)}`, {
      cause: error,
    });
  }
}

/**
 * Rebuild the `approval` object with the group switches the `bob` override
 * authors and, when `bash` is stated, rulesync's command lists in the
 * `execute_command` executor entry. Everything else in `approval` — a group
 * switch the override leaves out, executor entries for other tools and any
 * other field of the `execute_command` entry — is carried over as the user
 * left it, since the gateway replaces the owned `approval` key wholesale.
 */
function buildApproval({
  existingApproval,
  overrideApproval,
  commandLists,
}: {
  existingApproval: unknown;
  overrideApproval: BobOverrideApproval | undefined;
  commandLists: { approvedCommands: string[]; deniedCommands: string[] | undefined } | undefined;
}): Record<string, unknown> {
  const approval: Record<string, unknown> = isPlainObject(existingApproval)
    ? { ...existingApproval }
    : {};
  if (overrideApproval?.allowed_permissions !== undefined) {
    approval.allowed_permissions = [...overrideApproval.allowed_permissions];
  }
  if (overrideApproval?.permissionOptions !== undefined) {
    approval.permissionOptions = overrideApproval.permissionOptions.map((option) => ({
      ...option,
    }));
  }
  if (commandLists === undefined) {
    return approval;
  }
  const { approvedCommands, deniedCommands } = commandLists;
  const executors: unknown[] = Array.isArray(approval.allowedExecutors)
    ? [...approval.allowedExecutors]
    : [];
  const index = executors.findIndex(isExecuteCommandEntry);
  const existingEntry = index >= 0 ? executors[index] : undefined;
  const entry: Record<string, unknown> = {
    ...(isPlainObject(existingEntry) ? existingEntry : {}),
    toolId: EXECUTE_COMMAND_TOOL_ID,
    approvedCommands,
  };
  if (deniedCommands === undefined) {
    delete entry.deniedCommands;
  } else {
    entry.deniedCommands = deniedCommands;
  }
  if (index >= 0) {
    executors[index] = entry;
  } else {
    executors.push(entry);
  }
  approval.allowedExecutors = executors;
  return approval;
}

const GROUP_SWITCH_HINT =
  "To auto-approve a whole Bob tool group, list it in the 'bob.approval.allowed_permissions' " +
  "override of .rulesync/permissions.jsonc.";

/**
 * Warn about canonical categories the `execute_command` lists cannot carry.
 * Restricting (`deny` / `ask`) rules in them are already reported by
 * `resolveShellCommandLists`; this covers what that leaves silent — their
 * `allow` rules, which Bob could only express by switching on a whole
 * `allowed_permissions` group — and, when `bash` is not stated, every
 * category, since nothing is written at all then.
 */
function warnAboutSkippedCategories({
  permission,
  bashStated,
  logger,
}: {
  permission: PermissionsConfig["permission"];
  bashStated: boolean;
  logger?: Logger | undefined;
}): void {
  const skipped = Object.entries(permission)
    // The all-tools category is folded into the command lists only alongside
    // `bash`; without it, its restrictions are skipped like any other category.
    .filter(
      ([category]) =>
        category !== SHELL_PERMISSION_CATEGORY &&
        (!bashStated || category !== ALL_TOOLS_PERMISSION_CATEGORY),
    )
    .filter(([, rules]) => (bashStated ? Object.values(rules).includes("allow") : true))
    .map(([category]) => category);
  if (skipped.length === 0) {
    return;
  }
  const names = skipped.map((category) => `'${category}'`).join(", ");
  warnWithFallback(
    logger,
    bashStated
      ? `${TOOL_LABEL} only models shell-command permissions (${SURFACE_LABEL}); ` +
          `${names} allow rules cannot be represented and were skipped. ${GROUP_SWITCH_HINT}`
      : `${TOOL_LABEL} only models shell-command permissions (${SURFACE_LABEL}), and ` +
          `.rulesync/permissions.jsonc states no 'bash' category, so ${names} ` +
          `${skipped.length === 1 ? "was" : "were"} skipped and the command lists were left untouched. ` +
          GROUP_SWITCH_HINT,
  );
}

/**
 * Warn about group IDs the `bob` override names that Bob does not document.
 * They are written anyway, so a group Bob adds later works without a rulesync
 * release, but a typo would otherwise silently auto-approve nothing.
 */
function warnAboutUnknownGroupIds({
  overrideApproval,
  logger,
}: {
  overrideApproval: BobOverrideApproval | undefined;
  logger?: Logger | undefined;
}): void {
  const groupIds = [
    ...(overrideApproval?.allowed_permissions ?? []),
    ...(overrideApproval?.permissionOptions ?? []).map((option) => option.groupId),
  ];
  const unknown = [...new Set(groupIds.filter((id) => !BOB_PERMISSION_GROUP_IDS.has(id)))];
  if (unknown.length === 0) {
    return;
  }
  warnWithFallback(
    logger,
    `${TOOL_LABEL} permissions: the bob override names group ID(s) Bob does not document ` +
      `(${unknown.map((id) => `'${id}'`).join(", ")}); they were written as authored. ` +
      `Bob documents ${[...BOB_PERMISSION_GROUP_IDS].map((id) => `'${id}'`).join(", ")}.`,
  );
}

/**
 * Name what the `bob` override newly auto-approves. The settings file is Bob's
 * user file, so a switch turned on here applies to every project on the
 * machine, and the override may have arrived with a cloned repository or a
 * fetched permissions file. Switches that are already on are not repeated.
 */
function warnAboutNewAutoApprovals({
  settings,
  override,
  filePath,
  logger,
}: {
  settings: Record<string, unknown>;
  override: BobPermissionsOverride | undefined;
  filePath: string;
  logger?: Logger | undefined;
}): void {
  const existingApproval = isPlainObject(settings[APPROVAL_KEY]) ? settings[APPROVAL_KEY] : {};
  const existingGroups = new Set(asStringArray(existingApproval.allowed_permissions));
  const existingOutside = new Set(
    (Array.isArray(existingApproval.permissionOptions) ? existingApproval.permissionOptions : [])
      .filter(isPlainObject)
      .filter((option) => option.enableOutsideWorkspace === true)
      .map((option) => option.groupId),
  );
  const existingAutoApprove = isPlainObject(settings[AUTO_APPROVE_KEY])
    ? settings[AUTO_APPROVE_KEY]
    : {};

  const added = [
    ...(override?.approval?.allowed_permissions ?? [])
      .filter((group) => !existingGroups.has(group))
      .map((group) => `the '${group}' group`),
    ...(override?.approval?.permissionOptions ?? [])
      .filter(
        (option) => option.enableOutsideWorkspace === true && !existingOutside.has(option.groupId),
      )
      .map((option) => `the '${option.groupId}' group outside the workspace`),
    ...Object.entries(override?.autoApprove ?? {})
      .filter(([key, value]) => value === true && existingAutoApprove[key] !== true)
      .map(([key]) => `'${AUTO_APPROVE_KEY}.${key}'`),
  ];
  if (added.length === 0) {
    return;
  }
  warnWithFallback(
    logger,
    `${TOOL_LABEL} permissions: the bob override now auto-approves ${added.join(", ")} in ` +
      `${filePath}, Bob's user settings, so this applies to every project on this machine. ` +
      `Check it if .rulesync/permissions.jsonc arrived with a repository you cloned.`,
  );
}

/**
 * The widest glob a pattern stands for once Bob compares it as a command
 * prefix: `git` also covers `git push --force`. Used only to compare allows
 * against the restrictions, where widening can only withhold more allows,
 * never fail open.
 */
function widenToPrefixGlob(pattern: string): string {
  return pattern.endsWith("*") ? pattern : `${pattern}*`;
}

/**
 * Split the canonical `bash` rules — plus the restricting rules of the
 * all-tools `*` category, which cover shell commands too — into Bob's two
 * prefix lists. `ask` has no list of its own: it withholds the allows it
 * overlaps, compared at prefix width so a bare `git` allow is withheld by a
 * `git push *` ask instead of auto-approving it.
 */
function buildBobCommandLists({
  permission,
  logger,
}: {
  permission: PermissionsConfig["permission"];
  logger?: Logger | undefined;
}): { allowed: string[]; denied: string[] | undefined } {
  const { rules, foreignRestrictingCategories, ignoredAllToolsAllowPatterns } =
    collectShellCommandRules(permission);
  const {
    allow,
    deny,
    shadowedAllowPatterns,
    unenforcedAllToolsDenyPatterns,
    unenforcedAllToolsAskPatterns,
    intersectionBudgetExhausted,
  } = partitionCommandRules({
    rules,
    // `deniedCommands` is an ordinary list that takes precedence over the
    // allowlist, so an all-tools deny is written there for the case where it
    // names a command, and still withholds the allows it overlaps.
    writesAllToolsDeny: true,
    normalizePattern: widenToPrefixGlob,
  });
  warnAboutUnwrittenCommandRules({
    toolLabel: TOOL_LABEL,
    surfaceLabel: SURFACE_LABEL,
    foreignRestrictingCategories,
    shadowedAllowPatterns,
    unenforcedAllToolsDenyPatterns,
    unenforcedAllToolsAskPatterns,
    ignoredAllToolsAllowPatterns,
    intersectionBudgetExhausted,
    logger,
  });

  const lists: Record<string, PermissionAction> = {};
  for (const pattern of allow) {
    lists[pattern] = "allow";
  }
  for (const pattern of deny) {
    lists[pattern] = "deny";
  }
  return buildVscodeCommandLists({
    rules: lists,
    toolLabel: TOOL_LABEL,
    logger,
    prefixSemantics: "documented-prefix",
  });
}

/**
 * Lift Bob's whole-group switches out of the settings file into the shape of
 * the `bob` override, so an import followed by a generate writes them back
 * unchanged. Entries the override schema cannot hold (a non-string group ID, a
 * non-boolean toggle) are left out; they stay in the settings file as long as
 * the key that holds them is not authored.
 */
function readBobOverride(settings: Record<string, unknown>): BobPermissionsOverride {
  const override: BobPermissionsOverride = {};
  const approval = settings[APPROVAL_KEY];
  if (isPlainObject(approval)) {
    const overrideApproval: BobOverrideApproval = {};
    if (Array.isArray(approval.allowed_permissions)) {
      overrideApproval.allowed_permissions = asStringArray(approval.allowed_permissions);
    }
    if (Array.isArray(approval.permissionOptions)) {
      overrideApproval.permissionOptions = approval.permissionOptions
        .filter(isPlainObject)
        .filter(
          (option) =>
            typeof option.groupId === "string" &&
            (option.enableOutsideWorkspace === undefined ||
              typeof option.enableOutsideWorkspace === "boolean"),
        )
        .map((option) => ({ ...option, groupId: String(option.groupId) }));
    }
    if (Object.keys(overrideApproval).length > 0) {
      override.approval = overrideApproval;
    }
  }
  const autoApprove = settings[AUTO_APPROVE_KEY];
  if (isPlainObject(autoApprove)) {
    const toggles: Record<string, unknown> = { ...autoApprove };
    if (toggles.skills !== undefined && typeof toggles.skills !== "boolean") {
      delete toggles.skills;
    }
    if (Object.keys(toggles).length > 0) {
      override.autoApprove = toggles;
    }
  }
  return override;
}

/**
 * Permissions adapter for IBM Bob (Bob IDE and Bob Shell).
 *
 * Bob reads command approvals from the `approval` key of the user settings
 * file `~/.bob/settings/settings.json`, which both products share. The block
 * is documented for that file only, so the feature is global-only. rulesync
 * maps the canonical `bash` category onto the one per-pattern surface the
 * block has, the `execute_command` entry of `approval.allowedExecutors`:
 *
 * - `allow` → `approvedCommands` (matched as a prefix of the full command);
 * - `deny` → `deniedCommands` (always denied; takes precedence);
 * - `ask` → neither list, so Bob's own approval prompt stays in charge. An
 *   `ask` also withholds the allow rules that overlap it, since a prefix in
 *   `approvedCommands` would otherwise auto-approve the command it names.
 *
 * Glob- and regex-shaped patterns are handled by `buildVscodeCommandLists`,
 * which reasons about the same prefix lists for the Roo Code lineage Bob's
 * settings resemble. A deny that pins down no prefix can never match, so it
 * withholds every allow entry rather than leaving them auto-approving what it
 * meant to block. Bob's whole-group switches — `approval.allowed_permissions`,
 * `approval.permissionOptions` and the top-level `autoApprove` toggles — have
 * no per-pattern canonical counterpart, so they are authored through the `bob`
 * override block and imported back into it. Every other settings key is
 * preserved (the `hooks` key belongs to the hooks feature).
 *
 * rulesync owns the two command lists only when the canonical config states a
 * `bash` category, and a group switch only when the `bob` override authors it;
 * otherwise nothing is written, so adopting rulesync for other tools never
 * wipes hand-authored Bob approvals.
 *
 * @see https://bob.ibm.com/docs/shell/configuration/approval-settings
 * @see https://bob.ibm.com/docs/shell/features/skills
 */
export class BobPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  /**
   * `~/.bob/settings/settings.json` holds Bob's other settings and the hooks
   * feature's `hooks` key, so it must never be deleted by this feature.
   */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    // Global only: `~/.bob/settings/settings.json` (the processor resolves the
    // home directory through outputRoot). Bob documents no project-scoped
    // `approval` block.
    return {
      relativeDirPath: BOB_GLOBAL_SETTINGS_DIR_PATH,
      relativeFilePath: BOB_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolPermissionsFromFileParams): Promise<BobPermissions> {
    const paths = BobPermissions.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new BobPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    logger,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<BobPermissions> {
    const paths = BobPermissions.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so this stays side-effect-free under
    // `--dry-run`/`--check`; the actual write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    const config = rulesyncPermissions.getJson();
    const permission = config.permission;
    const override = config.bob;
    const bashStated = permission[SHELL_PERMISSION_CATEGORY] !== undefined;
    warnAboutSkippedCategories({ permission, bashStated, logger });

    const overrideApproval = override?.approval;
    const authorsApproval =
      overrideApproval?.allowed_permissions !== undefined ||
      overrideApproval?.permissionOptions !== undefined;
    const authorsAutoApprove = override?.autoApprove !== undefined;

    const patch: Record<string, unknown> = {};
    if (bashStated || authorsApproval || authorsAutoApprove) {
      const settings = parseBobSettings({ fileContent: existingContent, filePath });
      warnAboutUnknownGroupIds({ overrideApproval, logger });
      warnAboutNewAutoApprovals({ settings, override, filePath, logger });
      if (bashStated || authorsApproval) {
        // `approvedCommands` is written even when empty: once `bash` is stated
        // rulesync owns the list, and an explicit `[]` replaces any entries left
        // over from the settings UI or an earlier generate. An empty deny list
        // drops the key instead.
        let commandLists: Parameters<typeof buildApproval>[0]["commandLists"];
        if (bashStated) {
          const { allowed, denied } = buildBobCommandLists({ permission, logger });
          commandLists = { approvedCommands: allowed, deniedCommands: denied };
        }
        patch[APPROVAL_KEY] = buildApproval({
          existingApproval: settings[APPROVAL_KEY],
          overrideApproval,
          commandLists,
        });
      }
      if (authorsAutoApprove) {
        // Merged over the existing object, so an `autoApprove` toggle the
        // override leaves out keeps the value Bob's settings UI wrote.
        patch[AUTO_APPROVE_KEY] = {
          ...(isPlainObject(settings[AUTO_APPROVE_KEY]) ? settings[AUTO_APPROVE_KEY] : {}),
          ...override.autoApprove,
        };
      }
    }

    return new BobPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "permissions",
        existingContent,
        patch,
        filePath,
      }),
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const settings = parseBobSettings({
      fileContent: this.getFileContent(),
      filePath: join(this.getRelativeDirPath(), this.getRelativeFilePath()),
    });
    const approval = settings[APPROVAL_KEY];
    const executors =
      isPlainObject(approval) && Array.isArray(approval.allowedExecutors)
        ? approval.allowedExecutors
        : [];
    const entry = executors.find(isExecuteCommandEntry);

    const rules: Record<string, PermissionAction> = {};
    for (const pattern of asStringArray(entry?.approvedCommands)) {
      rules[pattern] = "allow";
    }
    // Applied second: Bob's `deniedCommands` takes precedence over
    // `approvedCommands`, so a pattern in both lists imports as `deny`.
    for (const pattern of asStringArray(entry?.deniedCommands)) {
      rules[pattern] = "deny";
    }

    const permission: Record<string, Record<string, PermissionAction>> = {};
    if (Object.keys(rules).length > 0) {
      permission[SHELL_PERMISSION_CATEGORY] = rules;
    }

    const bob = readBobOverride(settings);
    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(
        { permission, ...(Object.keys(bob).length > 0 && { bob }) },
        null,
        2,
      ),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): BobPermissions {
    return new BobPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}

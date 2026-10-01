import { join } from "node:path";

import { BOB_GLOBAL_SETTINGS_DIR_PATH, BOB_SETTINGS_FILE_NAME } from "../../constants/bob-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
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
 * Rebuild the `approval` object with rulesync's command lists in the
 * `execute_command` executor entry. Everything else in `approval` —
 * `allowed_permissions`, `permissionOptions`, executor entries for other tools
 * and any other field of the `execute_command` entry — is carried over as the
 * user left it, since the gateway replaces the owned `approval` key wholesale.
 */
function buildApproval({
  existingApproval,
  approvedCommands,
  deniedCommands,
}: {
  existingApproval: unknown;
  approvedCommands: string[];
  deniedCommands: string[] | undefined;
}): Record<string, unknown> {
  const approval: Record<string, unknown> = isPlainObject(existingApproval)
    ? { ...existingApproval }
    : {};
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
    .filter(
      ([category]) =>
        category !== SHELL_PERMISSION_CATEGORY && category !== ALL_TOOLS_PERMISSION_CATEGORY,
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
          `${names} allow rules cannot be represented and were skipped. Bob's ` +
          `'allowed_permissions' groups are left as authored in the settings file.`
      : `${TOOL_LABEL} only models shell-command permissions (${SURFACE_LABEL}), and ` +
          `.rulesync/permissions.jsonc states no 'bash' category, so ${names} ` +
          `${skipped.length === 1 ? "was" : "were"} skipped and the 'approval' block was left untouched.`,
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
 * meant to block. The rest of the `approval` block — the whole-group
 * `allowed_permissions` switches and `permissionOptions` — has no per-pattern
 * canonical counterpart and is preserved as authored, as is every other
 * settings key (the `hooks` key belongs to the hooks feature).
 *
 * rulesync owns the two command lists only when the canonical config states a
 * `bash` category; otherwise nothing is written, so adopting rulesync for other
 * tools never wipes hand-authored Bob approvals.
 *
 * @see https://bob.ibm.com/docs/shell/configuration/approval-settings
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

    const permission = rulesyncPermissions.getJson().permission;
    const bashStated = permission[SHELL_PERMISSION_CATEGORY] !== undefined;
    warnAboutSkippedCategories({ permission, bashStated, logger });

    const patch: Record<string, unknown> = {};
    if (bashStated) {
      const settings = parseBobSettings({ fileContent: existingContent, filePath });
      const { allowed, denied } = buildBobCommandLists({ permission, logger });
      // `approvedCommands` is written even when empty: once `bash` is stated
      // rulesync owns the list, and an explicit `[]` replaces any entries left
      // over from the settings UI or an earlier generate. An empty deny list
      // drops the key instead.
      patch[APPROVAL_KEY] = buildApproval({
        existingApproval: settings[APPROVAL_KEY],
        approvedCommands: allowed,
        deniedCommands: denied,
      });
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

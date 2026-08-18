import { join } from "node:path";

import {
  ZOOCODE_ALLOWED_COMMANDS_KEY,
  ZOOCODE_DENIED_COMMANDS_KEY,
  ZOOCODE_VSCODE_SETTINGS_DIR,
  ZOOCODE_VSCODE_SETTINGS_FILE_NAME,
} from "../../constants/zoocode-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/**
 * The canonical category Zoo Code's command lists correspond to. Zoo Code gates
 * terminal command execution and nothing else through these settings, so only
 * `bash` maps; `read`/`write`/`edit`/`webfetch` have no workspace-settable
 * counterpart in the extension's contributions.
 */
const COMMAND_CATEGORY = "bash";

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Split one canonical category's rules into Zoo Code's two command lists.
 *
 * Zoo Code matches these entries as command **prefixes**: a command runs
 * without a confirmation prompt when it starts with an `allowedCommands` entry,
 * and is refused outright when it starts with a `deniedCommands` entry (deny
 * wins). `ask` is represented by listing the pattern in neither list, which
 * leaves Zoo Code's default approval prompt in charge.
 *
 * Each list is `undefined` when it would be empty, so the key is retracted from
 * the settings file rather than written as an empty array — an empty
 * `allowedCommands` and an absent one mean the same thing to Zoo Code, and the
 * absent form leaves no rulesync residue behind.
 */
function buildCommandLists(rules: Record<string, PermissionAction>): {
  allowed: string[] | undefined;
  denied: string[] | undefined;
} {
  const allowed: string[] = [];
  const denied: string[] = [];
  for (const [pattern, action] of Object.entries(rules)) {
    if (action === "allow") {
      allowed.push(pattern);
    } else if (action === "deny") {
      denied.push(pattern);
    }
  }
  return {
    allowed: allowed.length > 0 ? allowed : undefined,
    denied: denied.length > 0 ? denied : undefined,
  };
}

/**
 * Permissions generator for Zoo Code.
 *
 * Zoo Code has no policy file in its `.roo/` tree: the committable command
 * allow/deny lists are VS Code workspace settings
 * (`zoo-code.allowedCommands` / `zoo-code.deniedCommands` in
 * `.vscode/settings.json`), which `ClineProvider.mergeCommandLists()` unions
 * into the lists the auto-approval decision reads. That file is a
 * general-purpose workspace settings file with many unrelated keys, so reads
 * and writes merge into the existing JSONC (touching only the two managed keys)
 * and the file is never deleted.
 *
 * Only project scope is modeled: VS Code's user-scope `settings.json` lives at
 * a platform-dependent path outside rulesync's home-relative global model.
 *
 * The `roo` target deliberately does not get this adapter. The settings
 * namespace is Zoo-era (`roo-cline.*` before the v3.74.0 rebrand), and Roo Code
 * is EOL with its repository archived, so emitting `zoo-code.*` keys for a
 * `--targets roo` generate would write settings that Roo itself never reads.
 *
 * @see https://github.com/Zoo-Code-Org/Zoo-Code/blob/main/src/package.json
 * @see https://github.com/Zoo-Code-Org/Zoo-Code/blob/main/src/core/auto-approval/commands.ts
 */
export class ZoocodePermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  /**
   * `.vscode/settings.json` is a user-managed workspace file with unrelated
   * settings, so it must not be deleted.
   */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    // Project scope only. VS Code's user settings.json is at a platform-specific
    // path outside rulesync's home-relative global model.
    return {
      relativeDirPath: ZOOCODE_VSCODE_SETTINGS_DIR,
      relativeFilePath: ZOOCODE_VSCODE_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolPermissionsFromFileParams): Promise<ZoocodePermissions> {
    const paths = ZoocodePermissions.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new ZoocodePermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<ZoocodePermissions> {
    const paths = ZoocodePermissions.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so this stays side-effect-free under
    // `--dry-run`/`--check`; the actual write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    const rules = rulesyncPermissions.getJson().permission[COMMAND_CATEGORY];
    // A canonical config that states no `bash` category leaves both keys
    // exactly as the user left them — adopting rulesync for other tools must
    // not wipe hand-authored Zoo Code command lists. A category that IS stated
    // but yields nothing (all `ask`) still retracts the keys, since rulesync
    // owns them once it manages the category.
    const patch: Record<string, unknown> = {};
    if (rules !== undefined) {
      const { allowed, denied } = buildCommandLists(rules);
      patch[ZOOCODE_ALLOWED_COMMANDS_KEY] = allowed;
      patch[ZOOCODE_DENIED_COMMANDS_KEY] = denied;
    }

    return new ZoocodePermissions({
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
    let settings: Record<string, unknown>;
    try {
      // VS Code settings.json is JSONC (comments / trailing commas allowed).
      // Fail-closed on a syntax error / non-mapping root, matching the write
      // path's shared-config declaration, so a broken file is surfaced rather
      // than partially imported.
      settings = parseSharedConfig({
        format: "jsonc",
        fileContent: this.getFileContent() || "{}",
        filePath: join(this.getRelativeDirPath(), this.getRelativeFilePath()),
        invalidRootPolicy: "error",
        jsoncParseErrors: "error",
      });
    } catch (error) {
      throw new Error(
        `Failed to parse Zoo Code VS Code settings in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const rules: Record<string, PermissionAction> = {};
    for (const pattern of asStringArray(settings[ZOOCODE_ALLOWED_COMMANDS_KEY])) {
      rules[pattern] = "allow";
    }
    // Applied second so a pattern listed in both lists imports as `deny`,
    // matching Zoo Code's own precedence (a denied prefix is refused even when
    // it also matches an allowed one).
    for (const pattern of asStringArray(settings[ZOOCODE_DENIED_COMMANDS_KEY])) {
      rules[pattern] = "deny";
    }

    const permission: Record<string, Record<string, PermissionAction>> = {};
    if (Object.keys(rules).length > 0) {
      permission[COMMAND_CATEGORY] = rules;
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
  }: ToolPermissionsForDeletionParams): ZoocodePermissions {
    return new ZoocodePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}

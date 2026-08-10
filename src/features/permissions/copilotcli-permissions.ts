import { join } from "node:path";

import {
  COPILOT_DIR,
  COPILOTCLI_PROJECT_SETTINGS_DIR_PATH,
  COPILOTCLI_SETTINGS_FILE_NAME,
} from "../../constants/copilot-paths.js";
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
 * The only canonical category the Copilot CLI settings can express: URL
 * approvals. Every other category (`bash`, `edit`, `read`, ...) has no
 * user-authorable surface — the CLI's `permissions.allow`/`ask`/`deny` rule
 * arrays are accepted only in MDM/enterprise managed settings, and session
 * tool approvals are machine-written to `permissions-config.json`.
 */
const WEBFETCH_CATEGORY = "webfetch";

/** `~/.copilot/settings.json` and `.github/copilot/settings.json` keys. */
const ALLOWED_URLS_KEY = "allowedUrls";
const DENIED_URLS_KEY = "deniedUrls";

function toUrlList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Split one canonical category's rules into the two URL lists. `ask` entries
 * are omitted: the CLI prompts for any URL that is in neither list, which is
 * exactly what `ask` means.
 */
function splitUrlRules(rules: Record<string, PermissionAction>): {
  allowedUrls: string[];
  deniedUrls: string[];
} {
  const allowedUrls: string[] = [];
  const deniedUrls: string[] = [];
  for (const [pattern, action] of Object.entries(rules)) {
    if (action === "allow") {
      allowedUrls.push(pattern);
    } else if (action === "deny") {
      deniedUrls.push(pattern);
    }
  }
  return { allowedUrls, deniedUrls };
}

/**
 * Permissions generator for the GitHub Copilot CLI.
 *
 * The CLI keeps two persistent settings files: the user-scope
 * `~/.copilot/settings.json` and the repository-scope
 * `.github/copilot/settings.json` (shipped in v1.0.60). Both are shared,
 * hand-edited files carrying unrelated keys (`model`, `effortLevel`, `hooks`,
 * `sandbox.*`, ...), so writes go through the shared-config gateway, only the
 * URL keys are owned, and the file is never deleted.
 *
 * The canonical `webfetch` category maps onto the CLI's two URL lists:
 * `allow` → `allowedUrls`, `deny` → `deniedUrls`, `ask` → the pattern is
 * omitted so the CLI falls through to its approval prompt.
 *
 * Scope asymmetry: the repository-scope key table documents `deniedUrls`
 * (union — a repository may add entries, never remove them) but NOT
 * `allowedUrls`, so an allow rule is only enforceable at user scope. At project
 * scope allow rules are therefore dropped with a warning rather than written to
 * a key the CLI ignores — since v1.0.79 the CLI also prints a startup warning
 * for unrecognized top-level keys, so only documented keys are ever emitted.
 *
 * @see https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference
 * @see https://github.com/github/copilot-cli/blob/main/changelog.md
 */
export class CopilotcliPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  /**
   * `settings.json` holds unrelated user settings (`model`, `effortLevel`,
   * `hooks`, ...), so it must not be deleted.
   */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return global
      ? { relativeDirPath: COPILOT_DIR, relativeFilePath: COPILOTCLI_SETTINGS_FILE_NAME }
      : {
          relativeDirPath: COPILOTCLI_PROJECT_SETTINGS_DIR_PATH,
          relativeFilePath: COPILOTCLI_SETTINGS_FILE_NAME,
        };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<CopilotcliPermissions> {
    const paths = CopilotcliPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new CopilotcliPermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<CopilotcliPermissions> {
    const paths = CopilotcliPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so this stays side-effect-free under
    // `--dry-run`/`--check`; the actual write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    const config = rulesyncPermissions.getJson();
    const rules = config.permission[WEBFETCH_CATEGORY];

    // A canonical config that does not state `webfetch` at all leaves both keys
    // exactly as the user left them. A stated category that yields no entries
    // still retracts its key, since rulesync owns it.
    const patch: Record<string, unknown> = {};
    if (rules !== undefined) {
      const { allowedUrls, deniedUrls } = splitUrlRules(rules);
      patch[DENIED_URLS_KEY] = deniedUrls.length > 0 ? deniedUrls : undefined;
      if (global) {
        patch[ALLOWED_URLS_KEY] = allowedUrls.length > 0 ? allowedUrls : undefined;
      } else if (allowedUrls.length > 0) {
        logger?.warn(
          `Copilot CLI permissions: dropping ${allowedUrls.length} "webfetch" allow rule(s) at project scope — ${join(paths.relativeDirPath, paths.relativeFilePath)} does not accept "${ALLOWED_URLS_KEY}" (repository settings may only add denials). Author allow rules in global scope (\`--global\`) instead.`,
        );
      }
    }

    return new CopilotcliPermissions({
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
      global,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const settings = this.parseSettings();

    const rules: Record<string, PermissionAction> = {};
    for (const pattern of toUrlList(settings[DENIED_URLS_KEY])) {
      rules[pattern] = "deny";
    }
    // A project-scope `allowedUrls` is not read by the CLI, so importing it
    // would turn a dead entry into an enforced allow rule elsewhere.
    if (this.global) {
      for (const pattern of toUrlList(settings[ALLOWED_URLS_KEY])) {
        // A pattern in both lists is a deny upstream (repository denials are
        // union-merged over the user allow list), so deny wins here too.
        rules[pattern] ??= "allow";
      }
    }

    const permission = Object.keys(rules).length > 0 ? { [WEBFETCH_CATEGORY]: rules } : {};
    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify({ permission }, null, 2),
    });
  }

  private parseSettings(): Record<string, unknown> {
    const relativePath = join(this.getRelativeDirPath(), this.getRelativeFilePath());
    try {
      // Fail-closed on a syntax error / non-mapping root, matching the write
      // path's shared-config declaration, so a broken file is surfaced rather
      // than partially imported.
      return parseSharedConfig({
        format: "json",
        fileContent: this.getFileContent() || "{}",
        filePath: relativePath,
        invalidRootPolicy: "error",
      });
    } catch (error) {
      throw new Error(
        `Failed to parse Copilot CLI settings in ${relativePath}: ${formatError(error)}`,
        { cause: error },
      );
    }
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolPermissionsForDeletionParams): CopilotcliPermissions {
    return new CopilotcliPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}

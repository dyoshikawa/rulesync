import { join } from "node:path";

import { PI_AGENT_DIR_PATH, PI_DIR, PI_SETTINGS_FILE_NAME } from "../../constants/pi-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
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

/** The one `settings.json` key this feature owns. */
const DEFAULT_TOOLS_KEY = "defaultTools";

/**
 * Permissions generator for Pi Coding Agent.
 *
 * Pi exposes no allow/ask/deny rule surface, so no canonical permission
 * category maps onto it. Its one repository-syncable tool gate is `defaultTools` —
 * the built-in tools enabled at startup (v0.84.2) — authored through the `pi`
 * permissions override.
 *
 * Scope semantics are the **opposite** of the union-merge most targets use:
 * a project `defaultTools` array *replaces* the global array rather than adding
 * to it, so the two scopes are written independently and never combined.
 * Project scope writes `.pi/settings.json`; global scope writes
 * `~/.pi/agent/settings.json`.
 *
 * The file is hand-edited and holds many unrelated keys (`theme`,
 * `defaultModel`, `packages`, `sessionDir`, ...), so writes go through the
 * shared-config gateway with `defaultTools` as the only owned key, and the file
 * is never deleted.
 *
 * @see https://pi.dev/docs/latest/settings
 */
export class PiPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  /** `settings.json` holds unrelated user settings, so it must not be deleted. */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: global ? PI_AGENT_DIR_PATH : PI_DIR,
      relativeFilePath: PI_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<PiPermissions> {
    const paths = PiPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new PiPermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<PiPermissions> {
    const paths = PiPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so generation stays side-effect-free under
    // `--dry-run`/`--check`; the write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    const defaultTools = rulesyncPermissions.getJson().pi?.defaultTools;

    // A config that does not state `defaultTools` leaves the key exactly as the
    // user left it; a stated one is written verbatim, including an empty array
    // (upstream reads that as "no built-in tools").
    const patch: Record<string, unknown> = {};
    if (defaultTools !== undefined) {
      patch[DEFAULT_TOOLS_KEY] = defaultTools;
    }

    return new PiPermissions({
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
    const defaultTools = settings[DEFAULT_TOOLS_KEY];

    const config: Record<string, unknown> = { permission: {} };
    if (Array.isArray(defaultTools) && defaultTools.every((tool) => typeof tool === "string")) {
      config.pi = { [DEFAULT_TOOLS_KEY]: defaultTools };
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(config, null, 2),
    });
  }

  private parseSettings(): Record<string, unknown> {
    try {
      return parseSharedConfig({ format: "json", fileContent: this.getFileContent() });
    } catch (error) {
      throw new Error(
        `Failed to parse Pi settings in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
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
  }: ToolPermissionsForDeletionParams): PiPermissions {
    return new PiPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}

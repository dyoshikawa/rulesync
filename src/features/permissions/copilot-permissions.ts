import { join } from "node:path";

import {
  COPILOT_MCP_DIR,
  COPILOT_VSCODE_SETTINGS_FILE_NAME,
} from "../../constants/copilot-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { isPlainObject } from "../../utils/type-guards.js";
import { applySharedConfigPatch, parseSharedConfig } from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/**
 * The flat, dotted VS Code setting key this adapter manages. VS Code stores
 * settings with dotted keys flat at the document top level, so this is a single
 * literal key — not a nested `chat.tools.terminal` path.
 * @see https://code.visualstudio.com/docs/agents/approvals
 */
const AUTO_APPROVE_KEY = "chat.tools.terminal.autoApprove";

/**
 * Shared-config ownership key for `.vscode/settings.json`. Kept in sync with the
 * declaration in `shared-config-gateway.ts`.
 */
const VSCODE_SETTINGS_SHARED_FILE_KEY = ".vscode/settings.json";

/**
 * The canonical permission category this adapter maps. Only shell/terminal
 * commands (`bash`) have a clean, high-fidelity representation in VS Code's
 * `chat.tools.terminal.autoApprove` map; other categories (read/edit/webfetch/
 * …) have no terminal-command equivalent and are intentionally not mapped.
 */
const TERMINAL_CATEGORY = "bash";

function asAutoApproveMap(value: unknown): Record<string, boolean> {
  if (!isPlainObject(value)) {
    return {};
  }
  const result: Record<string, boolean> = {};
  for (const [pattern, flag] of Object.entries(value)) {
    if (typeof flag === "boolean") {
      result[pattern] = flag;
    }
  }
  return result;
}

/**
 * Permissions generator for GitHub Copilot Chat in VS Code.
 *
 * VS Code has no standalone, environment-agnostic Copilot policy file (like
 * `.claude/settings.json`); project-level terminal auto-approvals are managed
 * through the workspace `chat.tools.terminal.autoApprove` map inside
 * `.vscode/settings.json`. That file is a general workspace settings file with
 * many unrelated keys, so reads and writes merge into the existing JSON
 * (touching only the one managed key) and the file is never deleted.
 *
 * Scope is deliberately limited to `chat.tools.terminal.autoApprove` — the one
 * clean, non-lossy mapping. The canonical `bash` category's per-pattern rules
 * map as: `allow` → `true` (auto-approve), `deny` → `false` (never approve),
 * and `ask` → the entry is OMITTED (VS Code then falls through to its default
 * in-chat approval prompt, i.e. "ask"). Only project scope is modeled: VS Code's
 * user-scope settings.json lives at a platform-dependent path outside rulesync's
 * home-relative global model.
 */
export class CopilotPermissions extends ToolPermissions {
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
      relativeDirPath: COPILOT_MCP_DIR,
      relativeFilePath: COPILOT_VSCODE_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolPermissionsFromFileParams): Promise<CopilotPermissions> {
    const paths = CopilotPermissions.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new CopilotPermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<CopilotPermissions> {
    const paths = CopilotPermissions.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so this stays side-effect-free under
    // `--dry-run`/`--check`; the actual write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    const config = rulesyncPermissions.getJson();
    const rules = config.permission[TERMINAL_CATEGORY] ?? {};

    const autoApprove: Record<string, boolean> = {};
    for (const [pattern, action] of Object.entries(rules)) {
      if (action === "allow") {
        autoApprove[pattern] = true;
      } else if (action === "deny") {
        autoApprove[pattern] = false;
      }
      // `ask` is represented by omitting the entry: VS Code falls through to its
      // default in-chat approval prompt.
    }

    // Retract the key entirely when there is nothing to auto-approve, so the
    // file never carries an empty managed object.
    const patchValue = Object.keys(autoApprove).length > 0 ? autoApprove : undefined;

    return new CopilotPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: VSCODE_SETTINGS_SHARED_FILE_KEY,
        feature: "permissions",
        existingContent,
        patch: { [AUTO_APPROVE_KEY]: patchValue },
        filePath,
      }),
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let settings: Record<string, unknown>;
    try {
      // VS Code settings.json is JSONC (comments / trailing commas allowed).
      settings = parseSharedConfig({
        format: "jsonc",
        fileContent: this.getFileContent() || "{}",
        filePath: join(this.getRelativeDirPath(), this.getRelativeFilePath()),
      });
    } catch (error) {
      throw new Error(
        `Failed to parse Copilot VS Code settings in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const autoApprove = asAutoApproveMap(settings[AUTO_APPROVE_KEY]);
    const rules: Record<string, PermissionAction> = {};
    for (const [pattern, flag] of Object.entries(autoApprove)) {
      rules[pattern] = flag ? "allow" : "deny";
    }

    const permission: Record<string, Record<string, PermissionAction>> = Object.keys(rules).length >
    0
      ? { [TERMINAL_CATEGORY]: rules }
      : {};

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
  }: ToolPermissionsForDeletionParams): CopilotPermissions {
    return new CopilotPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}

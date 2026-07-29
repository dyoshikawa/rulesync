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
 * The flat, dotted VS Code setting keys this adapter manages, one per canonical
 * permission category. VS Code stores settings with dotted keys flat at the
 * document top level, so each is a single literal key — not a nested
 * `chat.tools.terminal` path. All three share the same
 * pattern-to-boolean shape, so one conversion covers them.
 *
 * The canonical `read` and `write` categories stay unmapped: VS Code has no
 * read-approval surface, and folding `write` into the edits map alongside
 * `edit` would make the two indistinguishable on import.
 *
 * @see https://code.visualstudio.com/docs/agents/approvals
 * @see https://code.visualstudio.com/docs/copilot/chat/review-code-edits
 */
const AUTO_APPROVE_KEYS: Readonly<Record<string, string>> = {
  bash: "chat.tools.terminal.autoApprove",
  // Glob-to-boolean map gating agent edits, e.g. `{"**/*": true, "**/.env": false}`.
  // Added in VS Code v1.104.
  edit: "chat.tools.edits.autoApprove",
  // URL-pattern-to-boolean map gating fetch approvals. VS Code also accepts an
  // `{approveRequest, approveResponse}` object per pattern, which the canonical
  // allow/deny/ask model cannot express: such an entry is skipped on import,
  // and — since rulesync owns this key outright — is replaced on generate
  // whenever the canonical config states a `webfetch` category at all.
  webfetch: "chat.tools.urls.autoApprove",
};

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
 * Render one canonical category's rules as a VS Code auto-approve map. Returns
 * `undefined` when the category contributes nothing, so the key is retracted
 * rather than written as an empty object.
 *
 * The resulting map replaces the file's existing value wholesale — rulesync
 * owns these keys, so a rule dropped from the canonical config disappears from
 * the settings file too.
 */
function buildAutoApproveValue(
  rules: Record<string, PermissionAction>,
): Record<string, boolean> | undefined {
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
  return Object.keys(autoApprove).length > 0 ? autoApprove : undefined;
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
 * Three canonical categories have a clean, non-lossy representation and are
 * mapped (see {@link AUTO_APPROVE_KEYS}): `bash`, `edit` and `webfetch`. In
 * every one, per-pattern rules map as: `allow` → `true` (auto-approve), `deny`
 * → `false` (VS Code then always prompts — note this is "never auto-approve",
 * not a hard block), and `ask` → the entry is OMITTED (VS Code falls through to
 * the same default prompt). A key whose canonical category is absent entirely
 * is left untouched, so authoring only `bash` rules never disturbs a
 * hand-written edits or urls map.
 * Only project scope is modeled: VS Code's user-scope settings.json lives at a
 * platform-dependent path outside rulesync's home-relative global model.
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

    // Only categories the canonical config actually states are touched. A key
    // whose category is absent stays exactly as the user left it — otherwise
    // adopting rulesync for `bash` alone would wipe a hand-authored
    // `chat.tools.edits.autoApprove`. A category that IS stated but yields
    // nothing (all `ask`) still retracts its key, since rulesync owns it.
    const patch: Record<string, unknown> = {};
    for (const [category, settingKey] of Object.entries(AUTO_APPROVE_KEYS)) {
      const rules = config.permission[category];
      if (rules === undefined) {
        continue;
      }
      patch[settingKey] = buildAutoApproveValue(rules);
    }

    return new CopilotPermissions({
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
        `Failed to parse Copilot VS Code settings in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const permission: Record<string, Record<string, PermissionAction>> = {};
    for (const [category, settingKey] of Object.entries(AUTO_APPROVE_KEYS)) {
      // Non-boolean values (e.g. a urls entry in the `{approveRequest,
      // approveResponse}` object form) have no canonical action and are skipped
      // by `asAutoApproveMap`; the write path leaves them in place.
      const autoApprove = asAutoApproveMap(settings[settingKey]);
      const rules: Record<string, PermissionAction> = {};
      for (const [pattern, flag] of Object.entries(autoApprove)) {
        rules[pattern] = flag ? "allow" : "deny";
      }
      if (Object.keys(rules).length > 0) {
        permission[category] = rules;
      }
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

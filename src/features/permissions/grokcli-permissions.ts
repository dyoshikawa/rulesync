import { join } from "node:path";

import * as smolToml from "smol-toml";

import { GROKCLI_CONFIG_FILE_NAME, GROKCLI_DIR } from "../../constants/grokcli-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { isRecord } from "../../utils/type-guards.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

const GROKCLI_GLOBAL_ONLY_MESSAGE =
  "Grok CLI permissions are global-only; use --global to sync ~/.grok/config.toml";

// Grok stores the permission toggle as `[ui] permission_mode` in config.toml.
// https://docs.x.ai/build/modes-and-commands
const GROKCLI_UI_KEY = "ui";
const GROKCLI_PERMISSION_MODE_KEY = "permission_mode";

type GrokPermissionMode = "ask" | "always-approve";

// rulesync canonical catch-all pattern (Grok's mode is global, so only a
// catch-all maps cleanly back on import).
const CATCH_ALL_PATTERN = "*";

/**
 * Permissions adapter for the xAI Grok Build CLI (`grokcli`).
 *
 * Grok has no per-tool / per-pattern permission rules. Tool gating is a single
 * coarse toggle, `[ui] permission_mode`, in `~/.grok/config.toml`:
 *   - `ask` — prompt before each tool call (Grok's default).
 *   - `always-approve` — skip prompts.
 *
 * rulesync's permission model is per-category, per-pattern `allow`/`ask`/`deny`,
 * so the mapping is **lossy** (a single mode cannot express per-pattern rules):
 *   - Generate: any `deny` or `ask` rule anywhere ⇒ `ask` (conservative — keep
 *     prompting whenever the user expressed any restriction); otherwise, if at
 *     least one `allow` rule exists and nothing is denied/asked ⇒
 *     `always-approve`; an empty config falls back to the safe default `ask`.
 *   - Import: `always-approve` ⇒ `bash: { "*": "allow" }`; `ask` (or unset) ⇒
 *     `bash: { "*": "ask" }`. `bash` is used as the representative catch-all
 *     because it is the primary permission-gated surface, and this round-trips
 *     the generate mapping.
 *
 * This surface is **global only** — `permission_mode` lives in the user-level
 * `~/.grok/config.toml`; Grok has no project-scoped permission file. The shared
 * config is merged in place: the `[ui] permission_mode` value is set and every
 * other key (e.g. `[mcp_servers]`, legacy `approval_mode`) is preserved. The
 * file is never deleted.
 */
export class GrokcliPermissions extends ToolPermissions {
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
      relativeDirPath: GROKCLI_DIR,
      relativeFilePath: GROKCLI_CONFIG_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<GrokcliPermissions> {
    if (!global) {
      throw new Error(GROKCLI_GLOBAL_ONLY_MESSAGE);
    }
    const paths = GrokcliPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";
    return new GrokcliPermissions({
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
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<GrokcliPermissions> {
    if (!global) {
      throw new Error(GROKCLI_GLOBAL_ONLY_MESSAGE);
    }
    const paths = GrokcliPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so a dry-run/check does not create the user's
    // global config.toml as a side effect (mirrors the Goose adapter).
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";

    let parsed: smolToml.TomlTable;
    try {
      parsed = existingContent.trim() === "" ? {} : smolToml.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Grok config.toml at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const mode = deriveGrokPermissionMode(rulesyncPermissions.getJson());

    const existingUi = isRecord(parsed[GROKCLI_UI_KEY]) ? parsed[GROKCLI_UI_KEY] : {};
    parsed[GROKCLI_UI_KEY] = {
      ...existingUi,
      [GROKCLI_PERMISSION_MODE_KEY]: mode,
    } as smolToml.TomlTable;

    return new GrokcliPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: smolToml.stringify(parsed),
      validate: true,
      global: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let parsed: smolToml.TomlTable;
    try {
      const content = this.getFileContent();
      parsed = content.trim() === "" ? {} : smolToml.parse(content);
    } catch (error) {
      throw new Error(
        `Failed to parse Grok config.toml content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const ui = isRecord(parsed[GROKCLI_UI_KEY]) ? parsed[GROKCLI_UI_KEY] : {};
    const mode = ui[GROKCLI_PERMISSION_MODE_KEY];
    const action = mode === "always-approve" ? "allow" : "ask";

    const rulesyncConfig: PermissionsConfig = {
      permission: { bash: { [CATCH_ALL_PATTERN]: action } },
    };

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
  }: ToolPermissionsForDeletionParams): GrokcliPermissions {
    return new GrokcliPermissions({
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
 * Collapse a rulesync permissions config into Grok's single coarse mode.
 * Any `deny`/`ask` rule anywhere keeps prompting (`ask`); otherwise an existing
 * `allow` rule opts into `always-approve`; an empty config defaults to `ask`.
 */
function deriveGrokPermissionMode(config: PermissionsConfig): GrokPermissionMode {
  let hasAllow = false;

  for (const rules of Object.values(config.permission)) {
    for (const action of Object.values(rules)) {
      if (action === "deny" || action === "ask") {
        return "ask";
      }
      if (action === "allow") {
        hasAllow = true;
      }
    }
  }

  return hasAllow ? "always-approve" : "ask";
}

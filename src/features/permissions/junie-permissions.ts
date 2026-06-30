import { join } from "node:path";

import { JUNIE_DIR, JUNIE_PERMISSIONS_FILE_NAME } from "../../constants/junie-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  type PermissionAction,
  PermissionActionSchema,
  type PermissionsConfig,
} from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/**
 * JetBrains Junie CLI Action Allowlist (`allowlist.json`).
 *
 * Junie gates actions through an allowlist evaluated top-to-bottom (first match
 * wins). Project scope lives in `.junie/allowlist.json`; user scope lives in
 * `~/.junie/allowlist.json`.
 *
 * ```json
 * {
 *   "defaultBehavior": "ask",
 *   "allowReadonlyCommands": true,
 *   "rules": {
 *     "executables":       [ { "prefix": "git ", "action": "allow" } ],
 *     "fileEditing":       [ { "pattern": "src/**", "action": "allow" } ],
 *     "mcpTools":          [ { "prefix": "search", "action": "allow" } ],
 *     "readOutsideProject":[ { "pattern": "/etc/**", "action": "deny" } ]
 *   }
 * }
 * ```
 *
 * Each rule carries a literal `prefix` (matches commands that start with it) or
 * a glob `pattern` (`*`, `**`, `?`, `[abc]`, `[!abc]`) plus an `action`
 * (`allow` | `ask` | `deny`). rulesync's canonical actions map 1:1 onto Junie's.
 *
 * Category mapping (rulesync canonical <-> Junie rule group):
 * - `bash`         <-> `executables`
 * - `edit`/`write` -> `fileEditing`  (imported back as `edit`)
 * - `read`         <-> `readOutsideProject`
 * - `mcp`          <-> `mcpTools`
 *
 * Categories Junie cannot represent (e.g. `webfetch`) are skipped on export
 * (with a warning when they carry rules). The top-level `defaultBehavior` and
 * `allowReadonlyCommands` settings have no canonical equivalent: they are
 * preserved verbatim on export but not imported into the rulesync model.
 *
 * @see https://junie.jetbrains.com/docs/action-allowlist-junie-cli.html
 */
const JUNIE_RULE_GROUPS = ["executables", "fileEditing", "mcpTools", "readOutsideProject"] as const;
type JunieRuleGroup = (typeof JUNIE_RULE_GROUPS)[number];

type JunieRule = {
  prefix?: string;
  pattern?: string;
  action: PermissionAction;
};

type JunieAllowlist = {
  defaultBehavior?: PermissionAction;
  allowReadonlyCommands?: boolean;
  rules?: Partial<Record<JunieRuleGroup, JunieRule[]>>;
  [key: string]: unknown;
};

const CANONICAL_TO_JUNIE_GROUP: Record<string, JunieRuleGroup> = {
  bash: "executables",
  edit: "fileEditing",
  write: "fileEditing",
  read: "readOutsideProject",
  mcp: "mcpTools",
};

const JUNIE_GROUP_TO_CANONICAL: Record<JunieRuleGroup, string> = {
  executables: "bash",
  fileEditing: "edit",
  mcpTools: "mcp",
  readOutsideProject: "read",
};

// Junie's default response mode when no rule matches; used when an existing
// allowlist.json does not already declare one.
const JUNIE_DEFAULT_BEHAVIOR: PermissionAction = "ask";

function isPermissionAction(value: unknown): value is PermissionAction {
  return PermissionActionSchema.safeParse(value).success;
}

/**
 * Whether a rulesync pattern uses glob syntax. Junie expresses literal
 * "starts-with" matches as `prefix` and glob matches as `pattern`, so a pattern
 * containing any glob metacharacter (`*`, `?`, `[`) is emitted as `pattern`.
 */
function isGlobPattern(pattern: string): boolean {
  return /[*?[]/.test(pattern);
}

export class JuniePermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    // allowlist.json may carry user-managed top-level settings
    // (defaultBehavior / allowReadonlyCommands) that rulesync does not model,
    // so the permissions feature must never delete it.
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    // Project: `.junie/allowlist.json`; global: `~/.junie/allowlist.json`
    // (the home directory is resolved by the processor through outputRoot).
    return {
      relativeDirPath: JUNIE_DIR,
      relativeFilePath: JUNIE_PERMISSIONS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<JuniePermissions> {
    const paths = JuniePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new JuniePermissions({
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
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<JuniePermissions> {
    const paths = JuniePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = await readOrInitializeFileContent(filePath, "{}");

    let existing: JunieAllowlist;
    try {
      const parsed: unknown = JSON.parse(existingContent);
      existing =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as JunieAllowlist)
          : {};
    } catch (error) {
      throw new Error(
        `Failed to parse existing Junie allowlist at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();
    const rules = convertRulesyncToJunieRules({ config, logger });

    // rulesync owns the four rule groups; every other top-level key
    // (defaultBehavior, allowReadonlyCommands, ...) is preserved verbatim.
    const merged: JunieAllowlist = {
      ...existing,
      defaultBehavior: existing.defaultBehavior ?? JUNIE_DEFAULT_BEHAVIOR,
      rules,
    };

    return new JuniePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(merged, null, 2),
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let allowlist: JunieAllowlist;
    try {
      const parsed: unknown = JSON.parse(this.getFileContent());
      allowlist =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as JunieAllowlist)
          : {};
    } catch (error) {
      throw new Error(
        `Failed to parse Junie permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = convertJunieToRulesyncPermissions({ allowlist });

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(config, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): JuniePermissions {
    // Kept for interface parity; isDeletable() returns false so the file is
    // never actually removed by the permissions feature.
    return new JuniePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}

/**
 * Convert rulesync permissions config into Junie's `rules` object. Categories
 * with no Junie rule group (e.g. `webfetch`) are skipped, with a warning when
 * they carry any rule so the gap is surfaced.
 */
function convertRulesyncToJunieRules({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: Logger;
}): Partial<Record<JunieRuleGroup, JunieRule[]>> {
  const rules: Partial<Record<JunieRuleGroup, JunieRule[]>> = {};

  for (const [category, patterns] of Object.entries(config.permission)) {
    const group = CANONICAL_TO_JUNIE_GROUP[category];
    if (!group) {
      if (Object.keys(patterns).length > 0) {
        logger?.warn(
          `Junie allowlist only models executables/fileEditing/mcpTools/readOutsideProject ` +
            `(canonical bash/edit/write/read/mcp); '${category}' rules cannot be represented and ` +
            `were skipped.`,
        );
      }
      continue;
    }

    for (const [pattern, action] of Object.entries(patterns)) {
      const rule: JunieRule = isGlobPattern(pattern)
        ? { pattern, action }
        : { prefix: pattern, action };
      (rules[group] ??= []).push(rule);
    }
  }

  return rules;
}

/**
 * Convert a Junie allowlist back into rulesync permissions config. The
 * top-level `defaultBehavior` / `allowReadonlyCommands` settings have no
 * canonical equivalent and are not imported.
 */
function convertJunieToRulesyncPermissions({
  allowlist,
}: {
  allowlist: JunieAllowlist;
}): PermissionsConfig {
  const permission: PermissionsConfig["permission"] = {};
  const rules = allowlist.rules;

  if (rules && typeof rules === "object") {
    for (const group of JUNIE_RULE_GROUPS) {
      const list = rules[group];
      if (!Array.isArray(list)) {
        continue;
      }
      const category = JUNIE_GROUP_TO_CANONICAL[group];
      for (const rule of list) {
        if (!rule || typeof rule !== "object") {
          continue;
        }
        const pattern =
          typeof rule.pattern === "string"
            ? rule.pattern
            : typeof rule.prefix === "string"
              ? rule.prefix
              : undefined;
        if (pattern === undefined || !isPermissionAction(rule.action)) {
          continue;
        }
        (permission[category] ??= {})[pattern] = rule.action;
      }
    }
  }

  return { permission };
}

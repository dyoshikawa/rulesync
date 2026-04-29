import { join } from "node:path";

import { z } from "zod/mini";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/**
 * AugmentCode CLI uses `.augment/settings.json` (project) or `~/.augment/settings.json` (global).
 * The schema:
 * ```json
 * {
 *   "toolPermissions": [
 *     { "toolName": "...", "shellInputRegex": "...", "permission": { "type": "allow" | "deny" | "ask-user" } }
 *   ]
 * }
 * ```
 * First match wins.
 */

const AugmentPermissionTypeSchema = z.enum(["allow", "deny", "ask-user"]);
type AugmentPermissionType = z.infer<typeof AugmentPermissionTypeSchema>;

const AugmentToolPermissionSchema = z.looseObject({
  toolName: z.string(),
  shellInputRegex: z.optional(z.string()),
  permission: z.looseObject({
    type: AugmentPermissionTypeSchema,
  }),
});

type AugmentToolPermission = z.infer<typeof AugmentToolPermissionSchema>;

const AugmentSettingsSchema = z.looseObject({
  toolPermissions: z.optional(z.array(AugmentToolPermissionSchema)),
});

type AugmentSettings = z.infer<typeof AugmentSettingsSchema>;

const CANONICAL_TO_AUGMENT_TOOL_NAMES: Record<string, string> = {
  bash: "launch-process",
  read: "view",
  edit: "str-replace-editor",
  write: "save-file",
  webfetch: "web-fetch",
  websearch: "web-search",
};

const AUGMENT_TO_CANONICAL_TOOL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_AUGMENT_TOOL_NAMES).map(([k, v]) => [v, k]),
);

function toAugmentToolName(canonical: string): string {
  return CANONICAL_TO_AUGMENT_TOOL_NAMES[canonical] ?? canonical;
}

function toCanonicalToolName(augmentName: string): string {
  return AUGMENT_TO_CANONICAL_TOOL_NAMES[augmentName] ?? augmentName;
}

function actionToAugmentType(action: PermissionAction): AugmentPermissionType {
  switch (action) {
    case "allow":
      return "allow";
    case "deny":
      return "deny";
    case "ask":
      return "ask-user";
  }
}

function augmentTypeToAction(type: AugmentPermissionType): PermissionAction {
  switch (type) {
    case "allow":
      return "allow";
    case "deny":
      return "deny";
    case "ask-user":
      return "ask";
  }
}

/**
 * Convert a glob-like pattern into a regex string for AugmentCode's `shellInputRegex`.
 * Maps glob `*` to `.*`, `?` to `.`, escapes other regex metacharacters, and anchors at both ends.
 */
function globToShellRegex(glob: string): string {
  let regex = "";
  for (const char of glob) {
    if (char === "*") {
      regex += ".*";
    } else if (char === "?") {
      regex += ".";
    } else if (/[\\^$.|+(){}[\]]/.test(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
  }
  return `^${regex}$`;
}

/**
 * Recover an approximate glob pattern from an AugmentCode regex.
 * Reverses `globToShellRegex` for the common cases produced by us; otherwise returns the regex as-is.
 */
function shellRegexToGlob(regex: string): string {
  let body = regex;
  if (body.startsWith("^")) body = body.slice(1);
  if (body.endsWith("$")) body = body.slice(0, -1);

  let glob = "";
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "\\" && i + 1 < body.length) {
      glob += body[i + 1];
      i += 2;
      continue;
    }
    if (ch === "." && body[i + 1] === "*") {
      glob += "*";
      i += 2;
      continue;
    }
    if (ch === ".") {
      glob += "?";
      i += 1;
      continue;
    }
    glob += ch;
    i += 1;
  }
  return glob;
}

const MANAGED_AUGMENT_TOOL_NAMES = new Set(Object.values(CANONICAL_TO_AUGMENT_TOOL_NAMES));

export class AugmentcodePermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: ".augment",
      relativeFilePath: "settings.json",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<AugmentcodePermissions> {
    const paths = AugmentcodePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"toolPermissions":[]}';
    return new AugmentcodePermissions({
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
    global = false,
    logger,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<AugmentcodePermissions> {
    const paths = AugmentcodePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    let settings: AugmentSettings;
    try {
      const parsed = JSON.parse(existingContent);
      const result = AugmentSettingsSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(formatError(result.error));
      }
      settings = result.data;
    } catch (error) {
      throw new Error(
        `Failed to parse existing AugmentCode settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();
    const generated = convertRulesyncToAugmentEntries({ config, logger });

    // Determine which toolNames are managed by this conversion (rulesync-mapped names only)
    const managedToolNames = new Set<string>();
    for (const category of Object.keys(config.permission)) {
      const augmentName = toAugmentToolName(category);
      if (MANAGED_AUGMENT_TOOL_NAMES.has(augmentName)) {
        managedToolNames.add(augmentName);
      }
    }

    const existingEntries = settings.toolPermissions ?? [];
    const preservedEntries = existingEntries.filter(
      (entry) => !managedToolNames.has(entry.toolName),
    );

    const merged: AugmentSettings = {
      ...settings,
      toolPermissions: [...preservedEntries, ...generated],
    };

    const fileContent = JSON.stringify(merged, null, 2);

    return new AugmentcodePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let settings: AugmentSettings;
    try {
      const parsed = JSON.parse(this.getFileContent());
      const result = AugmentSettingsSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(formatError(result.error));
      }
      settings = result.data;
    } catch (error) {
      throw new Error(
        `Failed to parse AugmentCode permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = convertAugmentToRulesyncPermissions({
      entries: settings.toolPermissions ?? [],
    });

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
  }: ToolPermissionsForDeletionParams): AugmentcodePermissions {
    return new AugmentcodePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ toolPermissions: [] }, null, 2),
      validate: false,
    });
  }
}

function convertRulesyncToAugmentEntries({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
}): AugmentToolPermission[] {
  const entries: AugmentToolPermission[] = [];

  for (const [category, rules] of Object.entries(config.permission)) {
    const augmentToolName = toAugmentToolName(category);
    const isManaged = MANAGED_AUGMENT_TOOL_NAMES.has(augmentToolName);

    if (!isManaged && augmentToolName === category) {
      logger?.warn(
        `AugmentCode permissions: passing through unknown tool category '${category}' as toolName.`,
      );
    }

    for (const [pattern, action] of Object.entries(rules)) {
      const augmentType = actionToAugmentType(action);

      if (augmentToolName === "launch-process") {
        // Bash category: use shellInputRegex for non-wildcard patterns
        if (pattern === "*") {
          entries.push({
            toolName: augmentToolName,
            permission: { type: augmentType },
          });
        } else {
          entries.push({
            toolName: augmentToolName,
            shellInputRegex: globToShellRegex(pattern),
            permission: { type: augmentType },
          });
        }
      } else {
        // Non-bash: emit one entry per pattern (without shellInputRegex). For non-wildcard patterns,
        // AugmentCode would otherwise need finer matching that the spec does not document, so we
        // emit a catch-all entry per (toolName, action) and warn once when the pattern is non-wildcard.
        if (pattern !== "*") {
          logger?.warn(
            `AugmentCode permissions: pattern '${pattern}' for category '${category}' is approximated by a catch-all entry; AugmentCode does not document a per-input matcher for this tool.`,
          );
        }
        entries.push({
          toolName: augmentToolName,
          permission: { type: augmentType },
        });
      }
    }
  }

  return entries;
}

function convertAugmentToRulesyncPermissions({
  entries,
}: {
  entries: AugmentToolPermission[];
}): PermissionsConfig {
  const permission: Record<string, Record<string, PermissionAction>> = {};

  for (const entry of entries) {
    const canonical = toCanonicalToolName(entry.toolName);
    const action = augmentTypeToAction(entry.permission.type);
    const pattern =
      entry.toolName === "launch-process" && entry.shellInputRegex
        ? shellRegexToGlob(entry.shellInputRegex)
        : "*";

    if (!permission[canonical]) {
      permission[canonical] = {};
    }
    permission[canonical][pattern] = action;
  }

  return { permission };
}

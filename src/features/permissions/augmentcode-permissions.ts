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

    const existingEntries = settings.toolPermissions ?? [];

    // Preservation policy:
    // - For non-launch-process managed toolNames (view, str-replace-editor, save-file, web-fetch, web-search):
    //   replace entirely (Rulesync owns the namespace; non-bash entries do not have a documented matcher).
    // - For launch-process: preserve existing `deny` entries to fail-closed if the user manually added them,
    //   except those that exactly match a generated entry (which will be re-emitted from rulesync).
    const generatedKeys = new Set(
      generated.map((e) => `${e.toolName}|${e.shellInputRegex ?? ""}|${e.permission.type}`),
    );

    const preservedEntries = existingEntries.filter((entry) => {
      // Keep all entries whose toolName is unmanaged.
      if (!MANAGED_AUGMENT_TOOL_NAMES.has(entry.toolName)) return true;

      // For launch-process: keep existing `deny` entries (fail-closed) unless they are duplicated by
      // a generated entry (which would be re-emitted with the same shape).
      if (entry.toolName === "launch-process" && entry.permission.type === "deny") {
        const key = `${entry.toolName}|${entry.shellInputRegex ?? ""}|${entry.permission.type}`;
        return !generatedKeys.has(key);
      }

      // Otherwise the rulesync-managed namespace replaces existing entries.
      return false;
    });

    const sortedGenerated = sortAugmentEntries(generated);

    const merged: AugmentSettings = {
      ...settings,
      // Generated entries first (sorted by specificity / deny-priority), then preserved trailing entries.
      toolPermissions: [...sortedGenerated, ...preservedEntries],
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

    if (augmentToolName === "launch-process") {
      // Bash category: every pattern can be encoded as a shellInputRegex.
      for (const [pattern, action] of Object.entries(rules)) {
        const augmentType = actionToAugmentType(action);
        if (pattern === "*") {
          entries.push({ toolName: augmentToolName, permission: { type: augmentType } });
        } else {
          entries.push({
            toolName: augmentToolName,
            shellInputRegex: globToShellRegex(pattern),
            permission: { type: augmentType },
          });
        }
      }
      continue;
    }

    // Non-bash categories: AugmentCode does not document a per-input matcher for view / save-file /
    // str-replace-editor / web-fetch / web-search. Emitting only catch-all entries silently downgrades
    // explicit `deny` rules to `allow` (since first-match-wins and the catch-all `allow` would shadow
    // the catch-all `deny`). Adopt fail-closed semantics:
    //   (a) If any pattern is `deny`, emit ONE catch-all `deny` entry and drop allow/ask for that tool.
    //   (b) Otherwise, only `*` patterns are emitted as catch-all entries; non-`*` allow/ask are dropped
    //       with an aggregated warning so that a user-supplied pattern cannot create false sense of safety.
    const hasAnyDeny = Object.values(rules).some((a) => a === "deny");
    if (hasAnyDeny) {
      // Collect non-`*` patterns to surface what is being collapsed.
      const collapsed = Object.keys(rules).filter((p) => p !== "*");
      if (collapsed.length > 0) {
        logger?.warn(
          `AugmentCode permissions: category '${category}' contains a 'deny' rule. ` +
            `AugmentCode lacks a per-input matcher for this tool category, so all rules collapse ` +
            `into a single catch-all 'deny' (fail-closed). Affected patterns: ${collapsed.join(", ")}.`,
        );
      }
      entries.push({ toolName: augmentToolName, permission: { type: "deny" } });
      continue;
    }

    // No deny: only catch-all (`*`) entries are safe to emit. Aggregate-warn once per category for
    // the non-`*` allow/ask patterns we are dropping.
    const droppedPatterns: string[] = [];
    for (const [pattern, action] of Object.entries(rules)) {
      if (pattern === "*") {
        entries.push({
          toolName: augmentToolName,
          permission: { type: actionToAugmentType(action) },
        });
      } else {
        droppedPatterns.push(pattern);
      }
    }
    if (droppedPatterns.length > 0) {
      logger?.warn(
        `AugmentCode permissions: dropping non-wildcard patterns for category '${category}' ` +
          `(${droppedPatterns.join(", ")}); AugmentCode does not document a per-input matcher ` +
          `for this tool. Use a 'deny' rule with pattern '*' if you need to block this tool entirely.`,
      );
    }
  }

  return entries;
}

/**
 * Sort AugmentCode tool-permission entries to make the `first-match-wins` semantics safe and predictable.
 *
 * Augment evaluates `toolPermissions` top-to-bottom and stops at the first match. To prevent a
 * catch-all rule from shadowing a specific one, we place **more specific** rules first. Within the
 * same specificity bucket we still apply a fail-closed bias by ordering `deny` before `ask` before
 * `allow`.
 *
 * Ordering, applied stably:
 *   1. Entries with `shellInputRegex` (specific) come before entries without (`launch-process` catch-all).
 *   2. Among entries with `shellInputRegex`, longer regex first (more specific).
 *   3. Within the same specificity bucket, `deny` < `ask` < `allow` (fail-closed bias).
 *   4. Otherwise preserve insertion order.
 */
function sortAugmentEntries(entries: AugmentToolPermission[]): AugmentToolPermission[] {
  const typePriority: Record<AugmentPermissionType, number> = {
    deny: 0,
    "ask-user": 1,
    allow: 2,
  };
  const decorated = entries.map((entry, index) => ({ entry, index }));
  decorated.sort((a, b) => {
    const aHasRegex = a.entry.shellInputRegex ? 1 : 0;
    const bHasRegex = b.entry.shellInputRegex ? 1 : 0;
    // 1. Entries with shellInputRegex come FIRST.
    if (aHasRegex !== bHasRegex) return bHasRegex - aHasRegex;
    // 2. Among regex entries, longer regex first.
    if (a.entry.shellInputRegex && b.entry.shellInputRegex) {
      const aLen = a.entry.shellInputRegex.length;
      const bLen = b.entry.shellInputRegex.length;
      if (aLen !== bLen) return bLen - aLen;
    }
    // 3. Within same specificity, deny < ask-user < allow.
    const aType = typePriority[a.entry.permission.type];
    const bType = typePriority[b.entry.permission.type];
    if (aType !== bType) return aType - bType;
    // 4. Stable.
    return a.index - b.index;
  });
  return decorated.map((d) => d.entry);
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

    // Only launch-process supports per-input pattern recovery via shellInputRegex.
    // For other categories (view, str-replace-editor, save-file, web-fetch, web-search) the
    // AugmentCode schema does not carry per-pattern information, so they are imported as the
    // catch-all `*` pattern. This is the inverse of the fail-closed export side and is documented
    // in `docs/reference/file-formats.md`.
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

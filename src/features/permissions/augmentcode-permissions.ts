import { join } from "node:path";

import { z } from "zod/mini";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { ConsoleLogger, type Logger } from "../../utils/logger.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

// Module-level logger used by the importing direction (toRulesyncPermissions),
// where the instance method has no `logger` parameter. Mirrors the Qwen
// permissions translator's pattern.
const moduleLogger: Logger = new ConsoleLogger();

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

/**
 * Detect whether an AugmentCode `shellInputRegex` is faithfully roundtrippable
 * through our glob-based representation. Rulesync stores patterns as globs,
 * and on re-export `globToShellRegex` always produces an anchored pattern of
 * the form `^...$` whose body contains only literal characters, escaped
 * metacharacters, `.*` (from `*`), and `.` (from `?`).
 *
 * A user-authored regex that is unanchored or uses regex features outside
 * that small subset (`+`, `|`, character classes, groups, quantifiers) cannot
 * be losslessly converted to a glob; a naive conversion would silently narrow
 * (e.g. `"rm"` → glob `"rm"` → re-exported as `"^rm$"`, which only matches
 * the exact string `"rm"`) or otherwise change the matched set.
 */
function isShellRegexRoundtrippable(regex: string): boolean {
  if (!regex.startsWith("^") || !regex.endsWith("$")) {
    return false;
  }
  const body = regex.slice(1, -1);
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "\\" && i + 1 < body.length) {
      // Skip escaped char.
      i += 2;
      continue;
    }
    if (ch === "." && body[i + 1] === "*") {
      i += 2;
      continue;
    }
    if (ch === ".") {
      i += 1;
      continue;
    }
    // Any unescaped regex metacharacter that we don't generate marks the
    // regex as non-roundtrippable. `.` is handled above; the remaining ones
    // here are regex-only constructs.
    if (/[$^|+?*(){}[\]]/.test(ch ?? "")) {
      return false;
    }
    i += 1;
  }
  return true;
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

    // Preservation policy (fail-closed):
    // - Entries with unmanaged toolNames: kept verbatim (Rulesync does not own that namespace).
    // - Entries with managed toolNames AND `permission.type === "deny"`: preserved so user-added
    //   denies cannot be silently dropped by regeneration. This applies to ALL managed tools
    //   (launch-process / view / str-replace-editor / save-file / web-fetch / web-search), not
    //   just shell commands. Duplicates that exactly match a generated entry are dropped to avoid
    //   double-emitting the same row.
    // - Existing managed-tool `allow` / `ask-user` entries: replaced (rulesync owns the
    //   permissive surface for managed namespaces).
    const generatedKeys = new Set(
      generated.map((e) => `${e.toolName}|${e.shellInputRegex ?? ""}|${e.permission.type}`),
    );

    const preservedEntries = existingEntries.filter((entry) => {
      // Keep all entries whose toolName is unmanaged.
      if (!MANAGED_AUGMENT_TOOL_NAMES.has(entry.toolName)) return true;

      // For ANY managed tool: keep existing `deny` entries (fail-closed) unless they are
      // duplicated by a generated entry (which would be re-emitted with the same shape).
      if (entry.permission.type === "deny") {
        const key = `${entry.toolName}|${entry.shellInputRegex ?? ""}|${entry.permission.type}`;
        return !generatedKeys.has(key);
      }

      // Otherwise the rulesync-managed namespace replaces existing entries.
      return false;
    });

    // Sort the COMBINED list (generated + preserved) so that preserved `deny` entries cannot be
    // shadowed by a generated catch-all `allow`/`ask` under AugmentCode's first-match-wins
    // evaluation. Sorting a single time over the union also keeps preserved entries in their
    // correct fail-closed slot regardless of how many were retained.
    const sortedAll = sortAugmentEntries([...generated, ...preservedEntries]);

    const merged: AugmentSettings = {
      ...settings,
      toolPermissions: sortedAll,
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
      logger: moduleLogger,
    });

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(config, null, 2),
    });
  }

  validate(): ValidationResult {
    // Mirror Kilo's `safeParse`-based pattern: actually verify that the file
    // content is JSON-parseable and conforms to the AugmentCode settings
    // schema. A no-op validate would let malformed files slip past the
    // generate/import boundary and surface as confusing errors deeper in the
    // pipeline.
    try {
      const parsed = JSON.parse(this.fileContent || "{}");
      const result = AugmentSettingsSchema.safeParse(parsed);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: new Error(`Failed to parse AugmentCode permissions JSON: ${formatError(error)}`),
      };
    }
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
 * catch-all rule from shadowing a specific one, we place **more specific** rules first. We also
 * apply a fail-closed bias by ordering `deny` before `ask` before `allow` *before* falling back
 * to a regex-length specificity heuristic — this way a `deny` always wins over an `allow` of
 * equal-or-greater regex length.
 *
 * Ordering, applied stably:
 *   1. Entries with `shellInputRegex` (specific) come before entries without (`launch-process`
 *      catch-all).
 *   2. Within each "has-regex" bucket, fail-closed type priority: `deny` < `ask-user` < `allow`.
 *      This is intentionally applied BEFORE the length-based heuristic so e.g. `^rm .*$` (deny)
 *      lands above `^git .*$` (allow) regardless of which is the longer string.
 *   3. Among same-type regex entries, longer regex first (more specific).
 *   4. Within the catch-all (no-regex) bucket, the same fail-closed type priority.
 *   5. Otherwise preserve insertion order.
 *
 * Heuristic limits: regex-length is a coarse proxy for specificity. It does not detect actual
 * pattern overlap, so when two regexes match overlapping inputs the resulting precedence
 * depends on length, not semantics. The deny-first bias above ensures the dangerous case
 * (deny shadowed by a longer allow) is handled correctly even so.
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
    // 2. Apply fail-closed type priority BEFORE length-based specificity, so that within the
    //    has-regex bucket a `deny` cannot be ordered after an `allow` of greater regex length.
    const aType = typePriority[a.entry.permission.type];
    const bType = typePriority[b.entry.permission.type];
    if (aType !== bType) return aType - bType;
    // 3. Within the same fail-closed bucket and same regex-presence bucket, longer regex first.
    if (a.entry.shellInputRegex && b.entry.shellInputRegex) {
      const aLen = a.entry.shellInputRegex.length;
      const bLen = b.entry.shellInputRegex.length;
      if (aLen !== bLen) return bLen - aLen;
    }
    // 4. Stable.
    return a.index - b.index;
  });
  return decorated.map((d) => d.entry);
}

function convertAugmentToRulesyncPermissions({
  entries,
  logger,
}: {
  entries: AugmentToolPermission[];
  logger?: Logger;
}): PermissionsConfig {
  // Iteration-order-independent fail-closed precedence: when multiple entries collapse to the
  // same `(canonical, pattern)` key (which happens for the non-launch-process managed tools that
  // always use the catch-all `*` pattern on the import side), pick the most restrictive action
  // rather than letting the last entry silently overwrite earlier ones.
  // Precedence: deny > ask > allow.
  const actionPriority: Record<PermissionAction, number> = {
    deny: 2,
    ask: 1,
    allow: 0,
  };
  const permission: Record<string, Record<string, PermissionAction>> = {};

  for (const entry of entries) {
    const canonical = toCanonicalToolName(entry.toolName);
    const action = augmentTypeToAction(entry.permission.type);

    // Only launch-process supports per-input pattern recovery via shellInputRegex.
    // For other categories (view, str-replace-editor, save-file, web-fetch, web-search) the
    // AugmentCode schema does not carry per-pattern information, so they are imported as the
    // catch-all `*` pattern. This is the inverse of the fail-closed export side and is documented
    // in `docs/reference/file-formats.md`.
    let pattern: string;
    if (entry.toolName === "launch-process" && entry.shellInputRegex) {
      const regex = entry.shellInputRegex;
      if (isShellRegexRoundtrippable(regex)) {
        // Faithful import: glob round-trips back to an equivalent regex.
        pattern = shellRegexToGlob(regex);
      } else {
        // Non-roundtrippable user-authored regex (e.g. unanchored `"rm"`,
        // alternation `"rm|del"`, character classes `"[a-z]+"`). Naively
        // converting via `shellRegexToGlob` would silently weaken the rule on
        // re-export — for example `"rm"` would round-trip to `"^rm$"`, which
        // only matches the exact string. Apply asymmetric fallback per the
        // category:
        // - `deny`: broaden to `*` (fail-closed) — over-blocking is safer than
        //   under-blocking, so a user-authored deny continues to protect
        //   against the original threat surface (and more).
        // - `allow` / `ask`: warn but proceed with the lossy conversion. We
        //   cannot safely broaden these because broadening an allow would
        //   weaken security; dropping them would silently strip the user's
        //   rule. Lossy conversion preserves the user's intent on the most
        //   common patterns at the cost of the narrow regex semantics that
        //   only AugmentCode supports.
        if (action === "deny") {
          logger?.warn(
            `AugmentCode permissions: shellInputRegex '${regex}' on tool '${entry.toolName}' ` +
              `is not faithfully roundtrippable to a glob. Importing as the catch-all '*' ` +
              `pattern (fail-closed) so the deny rule cannot be silently narrowed on regenerate.`,
          );
          pattern = "*";
        } else {
          pattern = shellRegexToGlob(regex);
          logger?.warn(
            `AugmentCode permissions: shellInputRegex '${regex}' on tool '${entry.toolName}' ` +
              `is not faithfully roundtrippable to a glob. Importing as glob '${pattern}'; ` +
              `the rule may match a different set of inputs after regenerate.`,
          );
        }
      }
    } else {
      pattern = "*";
    }

    if (!permission[canonical]) {
      permission[canonical] = {};
    }
    const existing = permission[canonical][pattern];
    if (existing === undefined || actionPriority[action] > actionPriority[existing]) {
      permission[canonical][pattern] = action;
    }
  }

  return { permission };
}

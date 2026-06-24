import { join } from "node:path";

import { uniq } from "es-toolkit";
import { parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";

import {
  AMP_DIR,
  AMP_GLOBAL_DIR,
  AMP_SETTINGS_FILE_NAME,
  AMP_SETTINGS_JSONC_FILE_NAME,
} from "../../constants/amp-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { isPlainObject } from "../../utils/type-guards.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/**
 * Amp's `"amp.tools.disable"` setting disables tools by name. It accepts a glob
 * `*` (disable everything) and a `builtin:<tool>` prefix (disable only the
 * builtin of that name). It lives in the shared Amp settings file:
 * `.amp/settings.json` (project) and `~/.config/amp/settings.json` (global).
 *
 * Reference: https://ampcode.com/manual ("amp.tools.disable").
 */
const AMP_TOOLS_DISABLE_KEY = "amp.tools.disable";

/**
 * Amp's `"amp.permissions"` setting is an ordered array of per-tool rules with
 * argument-level matching. Each entry is
 * `{ tool: string, action: "allow" | "reject" | "ask" | "delegate", matches?: { cmd?: string } }`.
 * Tool names support globs (`*`, `mcp__*`); `matches.cmd` is a per-argument
 * glob. Rules are evaluated **first-match-wins**. It lives in the same shared
 * Amp settings file as `amp.tools.disable`.
 *
 * `amp.permissions` is Amp's documented legacy/backwards-compat surface — it
 * remains functional and is the only place to express `allow`/`ask` and
 * argument-specific `reject` rules (the simpler `amp.tools.disable` array can
 * only disable whole tools).
 *
 * Reference: https://ampcode.com/manual ("amp.permissions").
 */
const AMP_PERMISSIONS_KEY = "amp.permissions";

/**
 * Actions rulesync owns and regenerates wholesale in `amp.permissions`.
 * `delegate` is intentionally excluded: it has no canonical equivalent, so any
 * existing `delegate` entry is preserved verbatim rather than regenerated.
 */
type AmpManagedAction = "allow" | "reject" | "ask";
type AmpAction = AmpManagedAction | "delegate";

type AmpPermissionEntry = {
  tool: string;
  action: AmpAction;
  matches?: { cmd?: string };
  [key: string]: unknown;
};

function parseAmpSettings(fileContent: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const parsed: unknown = parseJsonc(fileContent || "{}", errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    const details = errors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join(", ");
    throw new Error(`Failed to parse Amp settings: ${details}`);
  }

  // `isPlainObject` (not `isRecord`) rejects class instances for
  // prototype-pollution hardening; the JSONC parser always yields a plain object.
  if (!isPlainObject(parsed)) {
    throw new Error("Amp settings must be a JSON object");
  }

  return parsed;
}

function toDisableList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Read an `amp.permissions` array from untrusted parsed settings. Only entries
 * whose shape rulesync understands are retained; the original objects are kept
 * by reference (with a normalized `action`) so unknown sibling keys survive a
 * round-trip when the entry is preserved.
 */
function toPermissionsList(value: unknown): AmpPermissionEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: AmpPermissionEntry[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw)) continue;
    const { tool, action } = raw;
    if (typeof tool !== "string" || typeof action !== "string") continue;
    if (action !== "allow" && action !== "reject" && action !== "ask" && action !== "delegate") {
      continue;
    }
    const matches = raw.matches;
    let normalizedMatches: { cmd?: string } | undefined;
    if (isPlainObject(matches) && typeof matches.cmd === "string") {
      normalizedMatches = { cmd: matches.cmd };
    }
    entries.push({
      ...raw,
      tool,
      action,
      ...(normalizedMatches ? { matches: normalizedMatches } : {}),
    } as AmpPermissionEntry);
  }
  return entries;
}

/**
 * Permissions generator for Amp (ampcode).
 *
 * Amp exposes two permission surfaces in the same shared settings file:
 *
 * - `amp.tools.disable` — a bare list of tool names to disable. This can only
 *   express "disable the whole tool", which maps cleanly to a rulesync
 *   whole-tool `deny` (`{ "*": "deny" }`).
 * - `amp.permissions` — an ordered, first-match-wins array of
 *   `{ tool, action, matches?: { cmd } }` rules that can express `allow`,
 *   `reject` (deny), and `ask` with optional per-argument (`cmd`) matching.
 *
 * Export strategy (resolves issue #2000): a whole-tool `deny` (pattern `*`)
 * stays in `amp.tools.disable` for backwards compatibility, while every lossy
 * case — argument-specific `deny`, and all `allow`/`ask` rules — is emitted as
 * `amp.permissions` entries instead of being silently dropped.
 *
 * The settings file is shared with the MCP feature (`amp.mcpServers`), so reads
 * and writes merge into the existing JSON rather than overwriting it, and the
 * file is never deleted.
 */
export class AmpPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  /**
   * The settings file may carry other Amp settings (e.g. `amp.mcpServers`), so
   * we never delete it; only the managed `amp.tools.disable` /
   * `amp.permissions` keys are rewritten.
   */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return global
      ? { relativeDirPath: AMP_GLOBAL_DIR, relativeFilePath: AMP_SETTINGS_FILE_NAME }
      : { relativeDirPath: AMP_DIR, relativeFilePath: AMP_SETTINGS_FILE_NAME };
  }

  /**
   * Probe `<jsonDir>/settings.jsonc` first, falling back to `settings.json`, so
   * an existing user file is read-modified-written in place instead of a fresh
   * sibling being created next to a hand-authored `.jsonc`. Defaults to
   * `settings.json` when neither file exists.
   */
  private static async resolveSettingsFile(
    jsonDir: string,
  ): Promise<{ fileContent: string | null; relativeFilePath: string }> {
    const jsoncContent = await readFileContentOrNull(join(jsonDir, AMP_SETTINGS_JSONC_FILE_NAME));
    if (jsoncContent !== null) {
      return { fileContent: jsoncContent, relativeFilePath: AMP_SETTINGS_JSONC_FILE_NAME };
    }
    const jsonContent = await readFileContentOrNull(join(jsonDir, AMP_SETTINGS_FILE_NAME));
    if (jsonContent !== null) {
      return { fileContent: jsonContent, relativeFilePath: AMP_SETTINGS_FILE_NAME };
    }
    return { fileContent: null, relativeFilePath: AMP_SETTINGS_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<AmpPermissions> {
    const basePaths = AmpPermissions.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);
    const { fileContent, relativeFilePath } = await this.resolveSettingsFile(jsonDir);

    const json = fileContent ? parseAmpSettings(fileContent) : {};
    const newJson = {
      ...json,
      [AMP_TOOLS_DISABLE_KEY]: toDisableList(json[AMP_TOOLS_DISABLE_KEY]),
    };

    return new AmpPermissions({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<AmpPermissions> {
    const basePaths = AmpPermissions.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);
    const { fileContent, relativeFilePath } = await this.resolveSettingsFile(jsonDir);

    const json = fileContent ? parseAmpSettings(fileContent) : {};

    const config = rulesyncPermissions.getJson();
    const { disable, permissions } = convertRulesyncToAmp(config);

    // Preserve user-authored `delegate` entries (no canonical equivalent), and
    // place them AFTER the rulesync-generated entries. Amp is first-match-wins,
    // so rulesync's regenerated allow/ask/reject rules take precedence; the
    // surviving delegate entries act as later fallbacks. rulesync OWNS and
    // wholesale-replaces the allow/ask/reject entries.
    const existingPermissions = toPermissionsList(json[AMP_PERMISSIONS_KEY]);
    const preservedDelegates = existingPermissions.filter((entry) => entry.action === "delegate");

    const newJson: Record<string, unknown> = { ...json, [AMP_TOOLS_DISABLE_KEY]: disable };

    const mergedPermissions = [...permissions, ...preservedDelegates];
    if (mergedPermissions.length > 0) {
      newJson[AMP_PERMISSIONS_KEY] = mergedPermissions;
    } else {
      delete newJson[AMP_PERMISSIONS_KEY];
    }

    return new AmpPermissions({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const json = parseAmpSettings(this.getFileContent());
    const config = convertAmpToRulesync({
      disable: toDisableList(json[AMP_TOOLS_DISABLE_KEY]),
      permissions: toPermissionsList(json[AMP_PERMISSIONS_KEY]),
    });

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(config, null, 2),
    });
  }

  validate(): ValidationResult {
    try {
      const json = parseAmpSettings(this.fileContent);
      const disable = json[AMP_TOOLS_DISABLE_KEY];
      if (disable !== undefined && !Array.isArray(disable)) {
        return {
          success: false,
          error: new Error(`"${AMP_TOOLS_DISABLE_KEY}" must be a JSON array of strings`),
        };
      }
      const permissions = json[AMP_PERMISSIONS_KEY];
      if (permissions !== undefined && !Array.isArray(permissions)) {
        return {
          success: false,
          error: new Error(`"${AMP_PERMISSIONS_KEY}" must be a JSON array of objects`),
        };
      }
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(formatError(error)),
      };
    }
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): AmpPermissions {
    return new AmpPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ [AMP_TOOLS_DISABLE_KEY]: [] }, null, 2),
      validate: false,
    });
  }
}

/**
 * Fail-closed action priority used to order generated `amp.permissions` entries
 * for the same tool. Because Amp is first-match-wins, a more restrictive action
 * must appear before a more permissive one: `reject` < `ask` < `allow`.
 */
const ACTION_PRIORITY: Record<AmpManagedAction, number> = {
  reject: 0,
  ask: 1,
  allow: 2,
};

/**
 * Convert a rulesync permissions config into Amp's two permission surfaces.
 *
 * For each `(category, pattern, action)` — where the category name IS the Amp
 * tool name:
 * - `deny` + pattern `*` → push `category` onto `amp.tools.disable` (whole-tool
 *   disable; legacy-compatible).
 * - `deny` + pattern `!== "*"` → `amp.permissions` `{ tool, action: "reject",
 *   matches: { cmd: pattern } }` (argument-specific deny keeps its specificity).
 * - `allow` / `ask` → `amp.permissions` `{ tool, action, matches?: { cmd } }`
 *   (`matches` omitted for the `*` catch-all).
 *
 * Generated `amp.permissions` entries are ordered deterministically so the
 * first-match-wins evaluation is fail-closed and stable: sorted by `tool`, then
 * by entries WITH `matches.cmd` (more specific) before catch-alls, then by
 * action priority (`reject` < `ask` < `allow`), then by `cmd`.
 *
 * Prototype-pollution-unsafe tool names / cmd patterns (`__proto__`,
 * `constructor`, `prototype`) are skipped defensively — they would otherwise be
 * used as object keys on the import side.
 */
function convertRulesyncToAmp(config: PermissionsConfig): {
  disable: string[];
  permissions: AmpPermissionEntry[];
} {
  const disable: string[] = [];
  const permissions: AmpPermissionEntry[] = [];

  for (const [category, rules] of Object.entries(config.permission)) {
    if (isPrototypePollutionKey(category)) continue;
    for (const [pattern, action] of Object.entries(rules)) {
      if (pattern !== "*" && isPrototypePollutionKey(pattern)) continue;

      if (action === "deny") {
        if (pattern === "*") {
          // Whole-tool disable stays on the legacy `amp.tools.disable` surface.
          disable.push(category);
        } else {
          permissions.push({
            tool: category,
            action: "reject",
            matches: { cmd: pattern },
          });
        }
        continue;
      }

      // allow / ask → amp.permissions (omit `matches` for the catch-all).
      const ampAction: AmpManagedAction = action === "allow" ? "allow" : "ask";
      permissions.push({
        tool: category,
        action: ampAction,
        ...(pattern !== "*" ? { matches: { cmd: pattern } } : {}),
      });
    }
  }

  return {
    disable: uniq(disable.toSorted()),
    permissions: sortAmpPermissions(permissions),
  };
}

/**
 * Stable, deterministic ordering for generated `amp.permissions` entries.
 * Order: tool name, then specific (has `matches.cmd`) before catch-all, then
 * fail-closed action priority (`reject` < `ask` < `allow`), then `cmd`.
 */
function sortAmpPermissions(entries: AmpPermissionEntry[]): AmpPermissionEntry[] {
  const decorated = entries.map((entry, index) => ({ entry, index }));
  decorated.sort((a, b) => {
    const at = a.entry.tool;
    const bt = b.entry.tool;
    if (at !== bt) return at < bt ? -1 : 1;

    const aHasCmd = a.entry.matches?.cmd !== undefined ? 0 : 1;
    const bHasCmd = b.entry.matches?.cmd !== undefined ? 0 : 1;
    if (aHasCmd !== bHasCmd) return aHasCmd - bHasCmd;

    const ap = ACTION_PRIORITY[a.entry.action as AmpManagedAction] ?? 0;
    const bp = ACTION_PRIORITY[b.entry.action as AmpManagedAction] ?? 0;
    if (ap !== bp) return ap - bp;

    const ac = a.entry.matches?.cmd ?? "";
    const bc = b.entry.matches?.cmd ?? "";
    if (ac !== bc) return ac < bc ? -1 : 1;

    return a.index - b.index;
  });
  return decorated.map((d) => d.entry);
}

/**
 * Convert Amp's two permission surfaces back into a rulesync permissions
 * config, merging both sources into one canonical model.
 *
 * - `amp.tools.disable[tool]` → `{ tool: { "*": "deny" } }`.
 * - `amp.permissions` entry `{ tool, action, matches }` →
 *   `{ tool: { (matches?.cmd ?? "*"): mapped } }` where `reject → deny`,
 *   `allow → allow`, `ask → ask`. `delegate` is skipped (no canonical
 *   equivalent).
 *
 * When both sources target the same `(tool, pattern)`, the more restrictive
 * action wins (fail-closed): `deny` > `ask` > `allow`.
 *
 * Tool names and cmd patterns that are prototype-pollution keys are skipped
 * defensively before being used as object keys.
 */
function convertAmpToRulesync({
  disable,
  permissions,
}: {
  disable: string[];
  permissions: AmpPermissionEntry[];
}): PermissionsConfig {
  const actionPriority: Record<PermissionAction, number> = {
    deny: 2,
    ask: 1,
    allow: 0,
  };
  const permission: Record<string, Record<string, PermissionAction>> = {};

  const assign = (tool: string, pattern: string, action: PermissionAction): void => {
    if (isPrototypePollutionKey(tool)) return;
    if (isPrototypePollutionKey(pattern)) return;
    const bucket = (permission[tool] ??= {});
    const existing = bucket[pattern];
    if (existing === undefined || actionPriority[action] > actionPriority[existing]) {
      bucket[pattern] = action;
    }
  };

  for (const tool of disable) {
    assign(tool, "*", "deny");
  }

  for (const entry of permissions) {
    if (entry.action === "delegate") continue;
    const pattern = entry.matches?.cmd ?? "*";
    const action: PermissionAction =
      entry.action === "reject" ? "deny" : entry.action === "ask" ? "ask" : "allow";
    assign(entry.tool, pattern, action);
  }

  return { permission };
}

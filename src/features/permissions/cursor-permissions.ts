import { join } from "node:path";

import { uniq } from "es-toolkit";

import {
  CURSOR_DIR,
  CURSOR_PERMISSIONS_FILE_NAME,
  CURSOR_PERMISSIONS_GLOBAL_FILE_NAME,
} from "../../constants/cursor-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
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
 * Mapping from rulesync canonical tool category names (lowercase) to Cursor CLI
 * permission types (PascalCase).
 *
 * Reference: https://cursor.com/docs/cli/reference/permissions
 *
 * Cursor CLI defines five permission types:
 * - `Shell(commandBase)` — shell command access
 * - `Read(pathOrGlob)` — file read access
 * - `Write(pathOrGlob)` — file write access
 * - `WebFetch(domainOrPattern)` — web domain access
 * - `Mcp(server:tool)` — MCP tool access
 *
 * Rulesync `bash` is mapped to Cursor `Shell`. Cursor does not have an explicit
 * `edit` category; rulesync `edit` rules are merged into `Write` since editing
 * a file requires the ability to write to it.
 *
 * Per-tool MCP categories follow the canonical `mcp__<server>__<tool>` shape
 * (mirrors Claude Code's encoding); these are translated to Cursor's
 * `Mcp(server:tool)` form by `toCursorType`/`toCursorPattern`.
 */
const CANONICAL_TO_CURSOR_TYPE: Record<string, string> = {
  bash: "Shell",
  read: "Read",
  edit: "Write",
  write: "Write",
  webfetch: "WebFetch",
  mcp: "Mcp",
};

/**
 * Reverse mapping from Cursor CLI types to canonical rulesync names.
 * `Write` always rounds-trips to `write` (rulesync `edit` is therefore merged
 * into `write` on import).
 */
const CURSOR_TYPE_TO_CANONICAL: Record<string, string> = {
  Shell: "bash",
  Read: "read",
  Write: "write",
  WebFetch: "webfetch",
  Mcp: "mcp",
};

const MCP_CANONICAL_PREFIX = "mcp__";

/**
 * Returns true if the canonical category is the per-tool MCP form
 * `mcp__<server>__<tool>`.
 */
function isMcpScopedCategory(canonical: string): boolean {
  return (
    canonical.startsWith(MCP_CANONICAL_PREFIX) && canonical.length > MCP_CANONICAL_PREFIX.length
  );
}

function toCursorType(canonical: string): string {
  if (isMcpScopedCategory(canonical)) {
    return "Mcp";
  }
  return CANONICAL_TO_CURSOR_TYPE[canonical] ?? canonical;
}

/**
 * For per-tool MCP canonical categories like `mcp__puppeteer__navigate`, the
 * server+tool address is encoded in the category name itself, so the rulesync
 * pattern collapses to Cursor's `server:tool` syntax. Non-`*` patterns
 * forward-write `server:tool(<pattern>)` for symmetry with the other
 * categories, but note that Cursor CLI does not currently document this
 * argument-match form — it is preserved here only so the generated entry
 * round-trips back to the original canonical pattern via
 * {@link toCanonicalCategory}'s fallback (the entry is treated as plain `mcp`
 * on import in that case).
 */
function toCursorPattern(canonical: string, pattern: string): string {
  if (isMcpScopedCategory(canonical)) {
    const remainder = canonical.slice(MCP_CANONICAL_PREFIX.length);
    const [server, ...toolParts] = remainder.split("__");
    const tool = toolParts.length > 0 ? toolParts.join("__") : "*";
    const serverName = server ?? "*";
    const toolName = tool || "*";
    if (pattern === "*" || pattern === "") {
      return `${serverName}:${toolName}`;
    }
    return `${serverName}:${toolName}(${pattern})`;
  }
  return pattern;
}

function toCanonicalCategory(cursorType: string, pattern: string): string {
  if (cursorType === "Mcp") {
    // `Mcp(server:tool)` → canonical category `mcp__server__tool` with `*` pattern.
    // The Cursor CLI docs only define the bare `server:tool` shape, so any
    // pattern that does not match it (including potential future
    // `server:tool(arg)` variants and multi-colon `server:tool:more` shapes)
    // falls back to the plain `mcp` category to avoid silently mangling
    // unknown future syntax.
    const match = pattern.match(/^([^:()]+):([^:()]+)$/);
    if (match) {
      const server = match[1] ?? "*";
      const tool = match[2] ?? "*";
      return `${MCP_CANONICAL_PREFIX}${server}__${tool}`;
    }
    return CURSOR_TYPE_TO_CANONICAL[cursorType] ?? cursorType.toLowerCase();
  }
  return CURSOR_TYPE_TO_CANONICAL[cursorType] ?? cursorType.toLowerCase();
}

/**
 * Parse a Cursor permission entry like "Shell(npm run *)" into its type and
 * pattern. Entries without parentheses are treated as wildcard patterns ("*").
 */
function parseCursorPermissionEntry(entry: string): { type: string; pattern: string } {
  const parenIndex = entry.indexOf("(");
  if (parenIndex === -1) {
    return { type: entry, pattern: "*" };
  }
  const type = entry.slice(0, parenIndex);
  if (!entry.endsWith(")")) {
    return { type, pattern: "*" };
  }
  const pattern = entry.slice(parenIndex + 1, -1);
  return { type, pattern: pattern || "*" };
}

/**
 * Build a Cursor CLI permission entry like "Shell(npm run *)".
 * For wildcard patterns, returns just the type name.
 */
function buildCursorPermissionEntry(type: string, pattern: string): string {
  if (pattern === "*") {
    return type;
  }
  return `${type}(${pattern})`;
}

type CursorCliConfig = {
  version?: unknown;
  editor?: {
    vimMode?: unknown;
    [key: string]: unknown;
  };
  permissions?: {
    allow?: string[];
    deny?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

/**
 * Narrow `JSON.parse` output to a plain object before treating it as a Cursor
 * CLI config. Cursor's `cli.json` is documented as an object; if a hand-edited
 * file contains an array, primitive, or `null`, we fall back to an empty
 * config so the rest of the merge pipeline can produce a fresh, well-formed
 * file rather than crashing on `.permissions` access. A warning is emitted
 * (when a logger is supplied) so the user is alerted to the malformed input.
 *
 * The shallow `{ ...value }` spread is intentional: the project bans `as`
 * assertions outside tests, so returning `value` directly would not satisfy
 * the `CursorCliConfig` return type without a cast. Spreading produces a
 * fresh `Record<string, unknown>` that is structurally assignable. Every
 * downstream access still goes through additional narrowing helpers
 * (`asCursorPermissionEntryArray`, the `permissions` object guard) before
 * touching specific properties.
 */
function asCursorCliConfig(value: unknown, logger?: Logger, sourceLabel?: string): CursorCliConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    logger?.warn(
      `Cursor CLI config${sourceLabel ? ` at ${sourceLabel}` : ""} is not a JSON object; ignoring existing content.`,
    );
    return {};
  }
  return { ...value };
}

/**
 * Coerce the `permissions.allow` / `permissions.deny` fields into string
 * arrays, dropping non-string entries defensively. Cursor only documents
 * arrays of strings here; tolerating malformed input keeps a single bad
 * line from breaking the entire generate run. When a logger is supplied,
 * dropped entries trigger a warning so users notice the malformed data.
 */
function asCursorPermissionEntryArray(
  value: unknown,
  logger?: Logger,
  fieldLabel?: string,
): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      result.push(item);
    } else {
      logger?.warn(
        `Cursor CLI permissions${fieldLabel ? `.${fieldLabel}` : ""} contains a non-string entry; dropping ${JSON.stringify(item)}.`,
      );
    }
  }
  return result;
}

/**
 * Assemble the Cursor CLI config to write.
 *
 * Cursor scopes the file asymmetrically: "Only permissions can be configured at
 * the project level. All other CLI settings must be set globally." So
 * `version`, `editor.vimMode`, `approvalMode` and `sandbox` belong to
 * `~/.cursor/cli-config.json` alone — writing them into `.cursor/cli.json`
 * produces keys Cursor ignores, which silently strands an authored
 * `cursor.approvalMode`.
 *
 * @see https://cursor.com/docs/cli/reference/configuration
 */
function mergeCursorCliConfig({
  settings,
  existingEditor,
  mergedPermissions,
  cursorOverride,
  global,
  filePath,
  logger,
}: {
  settings: CursorCliConfig;
  existingEditor: Record<string, unknown>;
  mergedPermissions: Record<string, unknown>;
  cursorOverride: Record<string, unknown>;
  global: boolean;
  filePath: string;
  logger?: Logger;
}): Record<string, unknown> {
  if (!global) {
    warnAboutGlobalOnlyOverrideKeys({ cursorOverride, filePath, logger });
    // Contribute only `permissions`. Existing content is still passed through
    // untouched — including any `version` an earlier rulesync stamped here —
    // because rulesync cannot tell a key it wrote from one the user did, and
    // deleting the latter would be destructive.
    return { ...settings, permissions: mergedPermissions };
  }

  return {
    ...settings,
    // Overlay the Cursor-scoped override's top-level cli-config.json fields
    // (`approvalMode`, `sandbox`, ...). rulesync's managed `version`/`editor`/
    // `permissions` are re-applied after so the override cannot clobber them.
    ...cursorOverride,
    // When generating from a fresh `{}` settings object the existing `version`
    // is `undefined`, so we default-stamp `1` to produce a schema-conforming
    // file. Any pre-existing `version` value (including a non-`1` value) is
    // preserved verbatim to keep the round-trip stable; if Cursor ever bumps
    // the schema version, hand-edited values will not be silently overwritten.
    version: settings.version ?? 1,
    editor: { ...existingEditor, vimMode: existingEditor.vimMode ?? false },
    permissions: mergedPermissions,
  };
}

/** Name the override keys a project-scope config cannot carry. */
function warnAboutGlobalOnlyOverrideKeys({
  cursorOverride,
  filePath,
  logger,
}: {
  cursorOverride: Record<string, unknown>;
  filePath: string;
  logger?: Logger;
}): void {
  const strandedKeys = Object.keys(cursorOverride).toSorted();
  if (strandedKeys.length === 0) return;

  const names = strandedKeys.map((key) => `\`${key}\``).join(", ");
  const [wasWere, itThem] = strandedKeys.length === 1 ? ["was", "it"] : ["were", "them"];
  logger?.warn(
    `Cursor applies only \`permissions\` from a project config, so ${names} from the \`cursor\` override ${wasWere} not written to ${filePath}. Generate with --global to set ${itThem} in ~/.cursor/cli-config.json.`,
  );
}

export class CursorPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    // The cli.json / cli-config.json file may carry non-permissions
    // settings (editor, model, network, attribution), so we never delete
    // the file outright — only manage the `permissions` block.
    return false;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    // Per https://cursor.com/docs/cli/reference/configuration:
    //   - Project-level: `<project>/.cursor/cli.json`
    //   - Global: `~/.cursor/cli-config.json`
    return {
      relativeDirPath: CURSOR_DIR,
      relativeFilePath: global ? CURSOR_PERMISSIONS_GLOBAL_FILE_NAME : CURSOR_PERMISSIONS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<CursorPermissions> {
    const paths = CursorPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"permissions":{}}';
    return new CursorPermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<CursorPermissions> {
    const paths = CursorPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);
    let settings: CursorCliConfig;
    try {
      settings = asCursorCliConfig(JSON.parse(existingContent), logger, filePath);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Cursor CLI config at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();
    const { allow, deny } = convertRulesyncToCursorPermissions(config, logger);

    // Determine which Cursor types are managed by the permissions config so we
    // can preserve user-authored entries for unrelated types (e.g. `Mcp(...)`)
    // without duplicating rulesync-managed entries.
    const managedTypes = new Set(
      Object.keys(config.permission).map((category) => toCursorType(category)),
    );

    const existingEditorRaw = settings.editor;
    let existingEditor: Record<string, unknown>;
    if (existingEditorRaw === undefined) {
      existingEditor = {};
    } else if (
      existingEditorRaw !== null &&
      typeof existingEditorRaw === "object" &&
      !Array.isArray(existingEditorRaw)
    ) {
      existingEditor = existingEditorRaw;
    } else {
      logger?.warn(
        `Cursor CLI config at ${filePath} has a non-object \`editor\` field; ignoring existing editor settings.`,
      );
      existingEditor = {};
    }

    const existingPermissionsRaw = settings.permissions;
    let existingPermissions: Record<string, unknown>;
    if (existingPermissionsRaw === undefined) {
      existingPermissions = {};
    } else if (
      existingPermissionsRaw !== null &&
      typeof existingPermissionsRaw === "object" &&
      !Array.isArray(existingPermissionsRaw)
    ) {
      existingPermissions = existingPermissionsRaw;
    } else {
      logger?.warn(
        `Cursor CLI config at ${filePath} has a non-object \`permissions\` field; ignoring existing permissions.`,
      );
      existingPermissions = {};
    }
    const preservedAllow = asCursorPermissionEntryArray(
      existingPermissions.allow,
      logger,
      "allow",
    ).filter((entry) => !managedTypes.has(parseCursorPermissionEntry(entry).type));
    const preservedDeny = asCursorPermissionEntryArray(
      existingPermissions.deny,
      logger,
      "deny",
    ).filter((entry) => !managedTypes.has(parseCursorPermissionEntry(entry).type));

    // Spread the existing `permissions` object so unknown keys (e.g. a future
    // `cwd` or other forward-compat fields a user has hand-edited) are
    // preserved verbatim alongside the managed `allow` / `deny` arrays. This
    // is intentional: rulesync only governs `allow` / `deny`, and dropping
    // unrecognized keys would lose user-authored configuration on every
    // round-trip.
    const mergedPermissions: Record<string, unknown> = {
      ...existingPermissions,
    };

    const mergedAllow = uniq([...preservedAllow, ...allow].toSorted());
    const mergedDeny = uniq([...preservedDeny, ...deny].toSorted());

    mergedPermissions.allow = mergedAllow;
    if (mergedDeny.length > 0) {
      mergedPermissions.deny = mergedDeny;
    } else {
      delete mergedPermissions.deny;
    }

    const merged = mergeCursorCliConfig({
      settings,
      existingEditor,
      mergedPermissions,
      cursorOverride: config.cursor ?? {},
      global,
      filePath,
      logger,
    });
    const fileContent = JSON.stringify(merged, null, 2);

    return new CursorPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let settings: CursorCliConfig;
    try {
      settings = asCursorCliConfig(JSON.parse(this.getFileContent()));
    } catch (error) {
      throw new Error(
        `Failed to parse Cursor CLI permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const permissionsRaw = settings.permissions;
    const permissions =
      permissionsRaw !== null &&
      typeof permissionsRaw === "object" &&
      !Array.isArray(permissionsRaw)
        ? permissionsRaw
        : {};
    // The import path intentionally does not thread a logger; malformed input
    // here is silently tolerated since `toRulesyncPermissions` is best-effort
    // and may be invoked transitively by callers without a logger context.
    const config = convertCursorToRulesyncPermissions({
      allow: asCursorPermissionEntryArray(permissions.allow),
      deny: asCursorPermissionEntryArray(permissions.deny),
    });

    // Route Cursor's autonomy settings (`approvalMode`, `sandbox`) into the
    // `cursor` override — they have no canonical category and would otherwise be
    // dropped on round-trip.
    const result: Record<string, unknown> = { ...config };
    const cursorOverride: Record<string, unknown> = {};
    if (settings.approvalMode !== undefined) cursorOverride.approvalMode = settings.approvalMode;
    // Only carry `sandbox` when it is a plain object, matching the override
    // schema (`sandbox` is a `looseObject`); a malformed non-object value stays
    // in the file rather than producing a canonical config that fails validation.
    if (
      settings.sandbox !== null &&
      typeof settings.sandbox === "object" &&
      !Array.isArray(settings.sandbox)
    ) {
      cursorOverride.sandbox = settings.sandbox;
    }
    if (Object.keys(cursorOverride).length > 0) {
      result.cursor = cursorOverride;
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(result, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): CursorPermissions {
    return new CursorPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ permissions: {} }, null, 2),
      validate: false,
    });
  }
}

/**
 * Convert rulesync permissions config to Cursor CLI allow/deny arrays.
 *
 * Cursor CLI does not support an "ask" action (the docs only define
 * `allow` and `deny`), so any `ask` rules are skipped with a warning.
 */
function convertRulesyncToCursorPermissions(
  config: PermissionsConfig,
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"],
): {
  allow: string[];
  deny: string[];
} {
  const allow: string[] = [];
  const deny: string[] = [];

  for (const [category, rules] of Object.entries(config.permission)) {
    const cursorType = toCursorType(category);
    for (const [pattern, action] of Object.entries(rules)) {
      const cursorPattern = toCursorPattern(category, pattern);
      const entry = buildCursorPermissionEntry(cursorType, cursorPattern);
      switch (action) {
        case "allow":
          allow.push(entry);
          break;
        case "ask":
          logger?.warn(
            `Cursor CLI permissions do not support the "ask" action. Skipping ${category} rule: ${pattern}`,
          );
          break;
        case "deny":
          deny.push(entry);
          break;
      }
    }
  }

  return { allow, deny };
}

/**
 * Convert Cursor CLI allow/deny arrays back to rulesync permissions config.
 */
function convertCursorToRulesyncPermissions(params: {
  allow: string[];
  deny: string[];
}): PermissionsConfig {
  const permission: Record<string, Record<string, PermissionAction>> = {};

  const processEntries = (entries: string[], action: PermissionAction) => {
    for (const entry of entries) {
      const { type, pattern } = parseCursorPermissionEntry(entry);
      const canonical = toCanonicalCategory(type, pattern);
      if (!permission[canonical]) {
        permission[canonical] = {};
      }
      // For per-tool MCP canonical categories (`mcp__server__tool`), the server
      // and tool address is already encoded in the category name, so the
      // pattern collapses to `*` to mirror the generation path.
      const canonicalPattern =
        type === "Mcp" && canonical.startsWith(MCP_CANONICAL_PREFIX) ? "*" : pattern;
      permission[canonical][canonicalPattern] = action;
    }
  };

  processEntries(params.allow, "allow");
  processEntries(params.deny, "deny");

  return { permission };
}

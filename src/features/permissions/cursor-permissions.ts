import { join } from "node:path";

import { uniq } from "es-toolkit";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
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
 * server+tool address is encoded in the category name itself, so the user's
 * pattern is collapsed into Cursor's `server:tool` syntax. Non-`*` patterns are
 * preserved when explicitly provided (rare, but supported for forward
 * compatibility with future Cursor argument matching).
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
    // Parse the pattern's server:tool prefix; preserve any trailing `(...)` as
    // the canonical pattern (forward-compat — Cursor docs do not currently
    // define this shape, but the round-trip stays lossless).
    const match = pattern.match(/^([^:()]+):([^()]+)$/);
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
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  [key: string]: unknown;
};

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
      relativeDirPath: ".cursor",
      relativeFilePath: global ? "cli-config.json" : "cli.json",
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
    const existingContent = await readOrInitializeFileContent(
      filePath,
      JSON.stringify({}, null, 2),
    );
    let settings: CursorCliConfig;
    try {
      settings = JSON.parse(existingContent);
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

    const existingPermissions = settings.permissions ?? {};
    const preservedAllow = (existingPermissions.allow ?? []).filter(
      (entry) => !managedTypes.has(parseCursorPermissionEntry(entry).type),
    );
    const preservedDeny = (existingPermissions.deny ?? []).filter(
      (entry) => !managedTypes.has(parseCursorPermissionEntry(entry).type),
    );

    const mergedPermissions: Record<string, unknown> = {
      ...existingPermissions,
    };

    const mergedAllow = uniq([...preservedAllow, ...allow].toSorted());
    const mergedDeny = uniq([...preservedDeny, ...deny].toSorted());

    if (mergedAllow.length > 0) {
      mergedPermissions.allow = mergedAllow;
    } else {
      delete mergedPermissions.allow;
    }
    if (mergedDeny.length > 0) {
      mergedPermissions.deny = mergedDeny;
    } else {
      delete mergedPermissions.deny;
    }

    const merged = { ...settings, permissions: mergedPermissions };
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
      settings = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Cursor CLI permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const permissions = settings.permissions ?? {};
    const config = convertCursorToRulesyncPermissions({
      allow: permissions.allow ?? [],
      deny: permissions.deny ?? [],
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

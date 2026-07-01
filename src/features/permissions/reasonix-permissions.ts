import { join } from "node:path";

import { uniq } from "es-toolkit";
import * as smolToml from "smol-toml";

import {
  REASONIX_GLOBAL_DIR,
  REASONIX_GLOBAL_PERMISSIONS_FILE_NAME,
  REASONIX_PROJECT_PERMISSIONS_FILE_NAME,
} from "../../constants/reasonix-paths.js";
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
 * Mapping from rulesync canonical tool category names (lowercase) to Reasonix
 * permission-rule tool families (PascalCase).
 *
 * Reasonix's `[permissions]` rule syntax (SPEC.md §3.7) is explicitly
 * documented as "Claude Code-style": "Bash and file mutation approvals use
 * Claude Code-style families such as `Bash(npm run build)`, `Bash(npm run
 * test:*)`, and `Edit(docs/**)`." Reasonix also accepts legacy lowercase tool
 * IDs for compatibility, but new rules are saved using these PascalCase
 * families, so rulesync reuses the same mapping `claudecode-permissions.ts`
 * uses (the closest documented precedent for this syntax).
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/SPEC.md
 */
const CANONICAL_TO_REASONIX_TOOL_NAMES: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  grep: "Grep",
  glob: "Glob",
  notebookedit: "NotebookEdit",
  agent: "Agent",
};

/**
 * Reverse mapping from Reasonix tool names to rulesync canonical names.
 */
const REASONIX_TO_CANONICAL_TOOL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_REASONIX_TOOL_NAMES).map(([k, v]) => [v, k]),
);

function toReasonixToolName(canonical: string): string {
  return CANONICAL_TO_REASONIX_TOOL_NAMES[canonical] ?? canonical;
}

function toCanonicalToolName(reasonixName: string): string {
  return REASONIX_TO_CANONICAL_TOOL_NAMES[reasonixName] ?? reasonixName;
}

/**
 * Parse a Reasonix permission entry like "Bash(npm run *)" into tool name and pattern.
 * If no parentheses, returns the tool name with "*" as the pattern.
 */
function parseReasonixPermissionEntry(entry: string): { toolName: string; pattern: string } {
  const parenIndex = entry.indexOf("(");
  if (parenIndex === -1) {
    return { toolName: entry, pattern: "*" };
  }
  const toolName = entry.slice(0, parenIndex);
  // Verify closing parenthesis exists at the end before extracting the pattern
  if (!entry.endsWith(")")) {
    return { toolName, pattern: "*" };
  }
  const pattern = entry.slice(parenIndex + 1, -1);
  return { toolName, pattern: pattern || "*" };
}

/**
 * Build a Reasonix permission entry like "Bash(npm run *)".
 * If the pattern is "*", returns just the tool name.
 */
function buildReasonixPermissionEntry(toolName: string, pattern: string): string {
  if (pattern === "*") {
    return toolName;
  }
  return `${toolName}(${pattern})`;
}

type ReasonixConfig = Record<string, unknown>;

type ReasonixPermissionsTable = Record<string, unknown> & {
  mode?: string;
  allow?: string[];
  ask?: string[];
  deny?: string[];
};

function parseReasonixConfig(fileContent: string): ReasonixConfig {
  const parsed = smolToml.parse(fileContent || smolToml.stringify({}));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return { ...(parsed as Record<string, unknown>) };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function toPermissionsTable(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

export class ReasonixPermissions extends ToolPermissions {
  private readonly toml: ReasonixConfig;

  constructor(params: AiFileParams) {
    super(params);
    this.toml = parseReasonixConfig(this.getFileContent());
  }

  override isDeletable(): boolean {
    // The Reasonix config file may hold many other settings (providers, ui,
    // agent, MCP `[[plugins]]`, …), so it must never be deleted when no
    // rulesync-managed permission rules remain.
    return false;
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    // Project config lives at the repository root (`./reasonix.toml`), while the
    // global config lives at `~/.reasonix/config.toml`; the home root is supplied
    // by the processor via outputRoot. Same file the MCP adapter reads/writes.
    if (global) {
      return {
        relativeDirPath: REASONIX_GLOBAL_DIR,
        relativeFilePath: REASONIX_GLOBAL_PERMISSIONS_FILE_NAME,
      };
    }
    return {
      relativeDirPath: ".",
      relativeFilePath: REASONIX_PROJECT_PERMISSIONS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<ReasonixPermissions> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? smolToml.stringify({});
    return new ReasonixPermissions({
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
    validate = true,
    logger,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<ReasonixPermissions> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? smolToml.stringify({});
    const parsed = parseReasonixConfig(existingContent);

    const config = rulesyncPermissions.getJson();
    const { allow, ask, deny } = convertRulesyncToReasonixPermissions(config);

    // Determine which tool names are managed by the permissions config
    const managedToolNames = new Set(
      Object.keys(config.permission).map((category) => toReasonixToolName(category)),
    );

    // Read existing permission arrays and preserve entries for tools NOT in the permissions config
    const existingPermissions = toPermissionsTable(parsed.permissions);
    const preservedAllow = toStringArray(existingPermissions.allow).filter(
      (entry) => !managedToolNames.has(parseReasonixPermissionEntry(entry).toolName),
    );
    const preservedAsk = toStringArray(existingPermissions.ask).filter(
      (entry) => !managedToolNames.has(parseReasonixPermissionEntry(entry).toolName),
    );
    const preservedDeny = toStringArray(existingPermissions.deny).filter(
      (entry) => !managedToolNames.has(parseReasonixPermissionEntry(entry).toolName),
    );

    // Warn when permissions feature overwrites ignore-generated Read(...) deny entries
    if (logger && managedToolNames.has("Read")) {
      const droppedReadDenyEntries = toStringArray(existingPermissions.deny).filter((entry) => {
        const { toolName } = parseReasonixPermissionEntry(entry);
        return toolName === "Read";
      });
      if (droppedReadDenyEntries.length > 0) {
        logger.warn(
          `Permissions feature manages 'Read' tool and will overwrite ${droppedReadDenyEntries.length} existing Read deny entries (possibly from ignore feature). Permissions take precedence.`,
        );
      }
    }

    // `mode` (the writer fallback: ask|allow|deny) has no equivalent in
    // rulesync's canonical permissions model, so any existing value is
    // preserved untouched via this spread rather than being managed here.
    const mergedPermissions: ReasonixPermissionsTable = { ...existingPermissions };

    const mergedAllow = uniq([...preservedAllow, ...allow].toSorted());
    const mergedAsk = uniq([...preservedAsk, ...ask].toSorted());
    const mergedDeny = uniq([...preservedDeny, ...deny].toSorted());

    if (mergedAllow.length > 0) {
      mergedPermissions.allow = mergedAllow;
    } else {
      delete mergedPermissions.allow;
    }
    if (mergedAsk.length > 0) {
      mergedPermissions.ask = mergedAsk;
    } else {
      delete mergedPermissions.ask;
    }
    if (mergedDeny.length > 0) {
      mergedPermissions.deny = mergedDeny;
    } else {
      delete mergedPermissions.deny;
    }

    // Preserve every other top-level key (MCP `[[plugins]]`, `[agent]`, `[ui]`,
    // …) exactly like `reasonix-mcp.ts`'s read-modify-write TOML merge.
    const merged: ReasonixConfig = { ...parsed, permissions: mergedPermissions };
    const fileContent = smolToml.stringify(merged);

    return new ReasonixPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const permissions = toPermissionsTable(this.toml.permissions);
    const config = convertReasonixToRulesyncPermissions({
      allow: toStringArray(permissions.allow),
      ask: toStringArray(permissions.ask),
      deny: toStringArray(permissions.deny),
    });

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(config, null, 2),
    });
  }

  validate(): ValidationResult {
    try {
      parseReasonixConfig(this.getFileContent());
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: new Error(`Failed to parse Reasonix config TOML: ${formatError(error)}`),
      };
    }
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): ReasonixPermissions {
    return new ReasonixPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: smolToml.stringify({}),
      validate: false,
    });
  }
}

/**
 * Convert rulesync permissions config to Reasonix allow/ask/deny arrays.
 */
function convertRulesyncToReasonixPermissions(config: PermissionsConfig): {
  allow: string[];
  ask: string[];
  deny: string[];
} {
  const allow: string[] = [];
  const ask: string[] = [];
  const deny: string[] = [];

  for (const [category, rules] of Object.entries(config.permission)) {
    const reasonixToolName = toReasonixToolName(category);
    for (const [pattern, action] of Object.entries(rules)) {
      const entry = buildReasonixPermissionEntry(reasonixToolName, pattern);
      switch (action) {
        case "allow":
          allow.push(entry);
          break;
        case "ask":
          ask.push(entry);
          break;
        case "deny":
          deny.push(entry);
          break;
      }
    }
  }

  return { allow, ask, deny };
}

/**
 * Convert Reasonix allow/ask/deny arrays to rulesync permissions config.
 */
function convertReasonixToRulesyncPermissions(params: {
  allow: string[];
  ask: string[];
  deny: string[];
}): PermissionsConfig {
  const permission: Record<string, Record<string, PermissionAction>> = {};

  const processEntries = (entries: string[], action: PermissionAction) => {
    for (const entry of entries) {
      const { toolName, pattern } = parseReasonixPermissionEntry(entry);
      const canonical = toCanonicalToolName(toolName);
      if (!permission[canonical]) {
        permission[canonical] = {};
      }
      permission[canonical][pattern] = action;
    }
  };

  processEntries(params.allow, "allow");
  processEntries(params.ask, "ask");
  processEntries(params.deny, "deny");

  return { permission };
}

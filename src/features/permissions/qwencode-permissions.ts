import { join } from "node:path";

import { uniq } from "es-toolkit";
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

/**
 * Qwen Code uses a settings.json file in `.qwen/` (project) or `~/.qwen/` (global).
 * The shape mirrors Claude Code's `permissions.allow/ask/deny` arrays with
 * entries like `Bash(<pattern>)`, `Read(<pattern>)`, etc.
 */

const QwenSettingsPermissionsSchema = z.looseObject({
  allow: z.optional(z.array(z.string())),
  ask: z.optional(z.array(z.string())),
  deny: z.optional(z.array(z.string())),
});

const QwenSettingsSchema = z.looseObject({
  permissions: z.optional(QwenSettingsPermissionsSchema),
});

type QwenSettings = z.infer<typeof QwenSettingsSchema>;

// Module-level logger used by the importing direction (toRulesyncPermissions), where the
// instance method has no `logger` parameter. The exporting direction (fromRulesyncPermissions)
// forwards the caller-supplied logger explicitly.
const moduleLogger: Logger = new ConsoleLogger();

/**
 * Mapping from rulesync canonical tool category names (lowercase) to Qwen Code tool names (PascalCase).
 * Unknown names pass through as-is (e.g., mcp__server__tool).
 */
const CANONICAL_TO_QWEN_TOOL_NAMES: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  grep: "Grep",
  glob: "Glob",
  agent: "Agent",
};

const QWEN_TO_CANONICAL_TOOL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_QWEN_TOOL_NAMES).map(([k, v]) => [v, k]),
);

function toQwenToolName(canonical: string): string {
  return CANONICAL_TO_QWEN_TOOL_NAMES[canonical] ?? canonical;
}

function toCanonicalToolName(qwenName: string): string {
  return QWEN_TO_CANONICAL_TOOL_NAMES[qwenName] ?? qwenName;
}

type ParsedQwenEntry =
  | { ok: true; toolName: string; pattern: string }
  | { ok: false; toolName: string; raw: string };

function parseQwenPermissionEntry(
  entry: string,
  options: { logger?: Logger } = {},
): ParsedQwenEntry {
  const parenIndex = entry.indexOf("(");
  if (parenIndex === -1) {
    return { ok: true, toolName: entry, pattern: "*" };
  }
  const toolName = entry.slice(0, parenIndex);
  // Use `lastIndexOf(')')` so patterns containing nested parentheses (e.g. `Bash(echo (a))`) round-trip
  // without truncating the inner content. If no closing paren is found, the entry is malformed.
  const lastParenIndex = entry.lastIndexOf(")");
  if (lastParenIndex < parenIndex) {
    options.logger?.warn(
      `Qwen permissions: malformed entry '${entry}' is missing a closing parenthesis.`,
    );
    return { ok: false, toolName, raw: entry };
  }
  // The entry MUST end with the last `)` — anything trailing it (e.g. `Bash(...)x`) is malformed.
  if (lastParenIndex !== entry.length - 1) {
    options.logger?.warn(
      `Qwen permissions: malformed entry '${entry}' has trailing characters after the closing parenthesis.`,
    );
    return { ok: false, toolName, raw: entry };
  }
  const pattern = entry.slice(parenIndex + 1, lastParenIndex);
  return { ok: true, toolName, pattern: pattern || "*" };
}

function buildQwenPermissionEntry(toolName: string, pattern: string): string {
  if (pattern === "*") {
    return toolName;
  }
  return `${toolName}(${pattern})`;
}

export class QwencodePermissions extends ToolPermissions {
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
      relativeDirPath: ".qwen",
      relativeFilePath: "settings.json",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<QwencodePermissions> {
    const paths = QwencodePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"permissions":{}}';
    return new QwencodePermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<QwencodePermissions> {
    const paths = QwencodePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Use null-fallback (instead of readOrInitializeFileContent) so generation has no filesystem
    // side effects when the destination directory does not yet exist (important for dry-run).
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    let settings: QwenSettings;
    try {
      const parsed = JSON.parse(existingContent);
      const result = QwenSettingsSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(formatError(result.error));
      }
      settings = result.data;
    } catch (error) {
      throw new Error(
        `Failed to parse existing Qwen settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();
    const { allow, ask, deny } = convertRulesyncToQwenPermissions(config);

    const managedToolNames = new Set(
      Object.keys(config.permission).map((category) => toQwenToolName(category)),
    );

    const existingPermissions = settings.permissions ?? {};
    // For preservation filtering we only need the tool name; whether the entry is malformed is
    // irrelevant here since we are forwarding it verbatim back into the merged output.
    const preservedAllow = (existingPermissions.allow ?? []).filter(
      (entry) => !managedToolNames.has(parseQwenPermissionEntry(entry, { logger }).toolName),
    );
    const preservedAsk = (existingPermissions.ask ?? []).filter(
      (entry) => !managedToolNames.has(parseQwenPermissionEntry(entry, { logger }).toolName),
    );
    const preservedDeny = (existingPermissions.deny ?? []).filter(
      (entry) => !managedToolNames.has(parseQwenPermissionEntry(entry, { logger }).toolName),
    );

    const mergedPermissions: {
      allow?: string[];
      ask?: string[];
      deny?: string[];
      [k: string]: unknown;
    } = {
      ...existingPermissions,
    };

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

    const merged = { ...settings, permissions: mergedPermissions };
    const fileContent = JSON.stringify(merged, null, 2);

    return new QwencodePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let settings: QwenSettings;
    try {
      const parsed = JSON.parse(this.getFileContent());
      const result = QwenSettingsSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(formatError(result.error));
      }
      settings = result.data;
    } catch (error) {
      throw new Error(
        `Failed to parse Qwen permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const permissions = settings.permissions ?? {};
    const config = convertQwenToRulesyncPermissions({
      allow: permissions.allow ?? [],
      ask: permissions.ask ?? [],
      deny: permissions.deny ?? [],
    });

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(config, null, 2),
    });
  }

  validate(): ValidationResult {
    // Mirror Kilo's `safeParse`-based pattern: actually verify that the file
    // content is JSON-parseable and conforms to the Qwen settings schema.
    // A no-op validate would let malformed files slip past the
    // generate/import boundary and surface as confusing errors deeper in the
    // pipeline.
    try {
      const parsed = JSON.parse(this.fileContent || "{}");
      const result = QwenSettingsSchema.safeParse(parsed);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: new Error(`Failed to parse Qwen permissions JSON: ${formatError(error)}`),
      };
    }
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): QwencodePermissions {
    return new QwencodePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ permissions: {} }, null, 2),
      validate: false,
    });
  }
}

function convertRulesyncToQwenPermissions(config: PermissionsConfig): {
  allow: string[];
  ask: string[];
  deny: string[];
} {
  const allow: string[] = [];
  const ask: string[] = [];
  const deny: string[] = [];

  for (const [category, rules] of Object.entries(config.permission)) {
    const qwenToolName = toQwenToolName(category);
    for (const [pattern, action] of Object.entries(rules)) {
      const entry = buildQwenPermissionEntry(qwenToolName, pattern);
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

function convertQwenToRulesyncPermissions(params: {
  allow: string[];
  ask: string[];
  deny: string[];
  logger?: Logger;
}): PermissionsConfig {
  const permission: Record<string, Record<string, PermissionAction>> = {};
  // Forward a logger to `parseQwenPermissionEntry` so its malformed-entry warnings are not
  // dead code in production. Default to the module-level ConsoleLogger when the caller did not
  // supply one (the instance-side `toRulesyncPermissions()` has no logger parameter to thread).
  const logger = params.logger ?? moduleLogger;

  const processEntries = (entries: string[], action: PermissionAction) => {
    for (const entry of entries) {
      const parsed = parseQwenPermissionEntry(entry, { logger });
      if (!parsed.ok) {
        // Fail-closed asymmetry by category:
        // - `deny`: keep the existing fallback to `*` so a malformed deny still blocks (broader is safer).
        // - `allow` / `ask`: dropping is safer than broadening a narrow user rule into `*`. The
        //   already-emitted warn from `parseQwenPermissionEntry` makes the drop visible.
        if (action === "deny") {
          const canonical = toCanonicalToolName(parsed.toolName);
          if (!permission[canonical]) {
            permission[canonical] = {};
          }
          permission[canonical]["*"] = action;
        }
        continue;
      }
      const { toolName, pattern } = parsed;
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

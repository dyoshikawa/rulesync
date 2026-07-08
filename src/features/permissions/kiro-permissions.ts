import { join } from "node:path";

import { z } from "zod/mini";

import { KIRO_AGENTS_DIR_PATH, KIRO_HOOKS_FILE_NAME } from "../../constants/kiro-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
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

const KiroAgentSchema = z.looseObject({
  allowedTools: z.optional(z.array(z.string())),
  toolsSettings: z.optional(z.record(z.string(), z.unknown())),
});

type KiroAgent = z.infer<typeof KiroAgentSchema>;
const UnknownRecordSchema = z.record(z.string(), z.unknown());

export class KiroPermissions extends ToolPermissions {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: KIRO_AGENTS_DIR_PATH,
      relativeFilePath: KIRO_HOOKS_FILE_NAME,
    };
  }

  override isDeletable(): boolean {
    return false;
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolPermissionsFromFileParams): Promise<KiroPermissions> {
    const paths = this.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);
    return new KiroPermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<KiroPermissions> {
    const paths = this.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);

    const parsedResult = KiroAgentSchema.safeParse(JSON.parse(existingContent));
    if (!parsedResult.success) {
      throw new Error(
        `Failed to parse existing Kiro agent config at ${filePath}: ${formatError(parsedResult.error)}`,
      );
    }

    const config = rulesyncPermissions.getJson();
    const next = buildKiroPermissionsFromRulesync({ config, logger, existing: parsedResult.data });

    return new KiroPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(next, null, 2),
      validate,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let parsed: KiroAgent;
    try {
      parsed = KiroAgentSchema.parse(JSON.parse(this.getFileContent()));
    } catch (error) {
      throw new Error(
        `Failed to parse Kiro permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const permission: PermissionsConfig["permission"] = {};
    const toolsSettings = parsed.toolsSettings ?? {};

    const shellRules = rulesFromArrays(
      asRecord(toolsSettings.shell),
      "allowedCommands",
      "deniedCommands",
    );
    if (Object.keys(shellRules).length > 0) permission.bash = shellRules;

    // read/write/grep/glob all use `{ allowedPaths, deniedPaths }` under their
    // own toolsSettings key, mapping 1:1 to the canonical category name.
    for (const category of ["read", "write", "grep", "glob"] as const) {
      const rules = rulesFromArrays(
        asRecord(toolsSettings[category]),
        "allowedPaths",
        "deniedPaths",
      );
      if (Object.keys(rules).length > 0) permission[category] = rules;
    }

    const allowedTools = new Set(parsed.allowedTools ?? []);
    if (allowedTools.has("web_fetch")) {
      permission.webfetch = { "*": "allow" };
    }
    if (allowedTools.has("web_search")) {
      permission.websearch = { "*": "allow" };
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify({ permission }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): KiroPermissions {
    return new KiroPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({}, null, 2),
      validate: false,
    });
  }
}

function buildKiroPermissionsFromRulesync({
  config,
  logger,
  existing,
}: {
  config: PermissionsConfig;
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
  existing: KiroAgent;
}): KiroAgent {
  const nextAllowedTools = new Set(existing.allowedTools ?? []);
  const nextToolsSettings = { ...asRecord(existing.toolsSettings) };

  // Path/command categories map to a `{ <allowKey>: [], <denyKey>: [] }` table
  // under a `toolsSettings` key. `edit` and `write` both fold into `write`.
  const pathBuckets: Record<string, { allow: string[]; deny: string[] }> = {};
  const pushPath = (key: string, action: PermissionAction, pattern: string): void => {
    const bucket = (pathBuckets[key] ??= { allow: [], deny: [] });
    (action === "allow" ? bucket.allow : bucket.deny).push(pattern);
  };
  const shell = { allowedCommands: [] as string[], deniedCommands: [] as string[] };

  for (const [category, rules] of Object.entries(config.permission)) {
    for (const [pattern, action] of Object.entries(rules)) {
      if (action === "ask") {
        logger?.warn(`Kiro permissions do not support "ask". Skipping ${category}:${pattern}`);
        continue;
      }
      if (category === "bash") {
        (action === "allow" ? shell.allowedCommands : shell.deniedCommands).push(pattern);
      } else if (category === "read" || category === "grep" || category === "glob") {
        pushPath(category, action, pattern);
      } else if (category === "edit" || category === "write") {
        pushPath("write", action, pattern);
      } else if (category === "webfetch" || category === "websearch") {
        applyKiroWebPermission({ category, pattern, action, nextAllowedTools, logger });
      } else {
        logger?.warn(`Kiro permissions do not support category: ${category}. Skipping.`);
      }
    }
  }

  // `shell`/`read`/`write` are always emitted (even empty) to match the prior
  // behavior; `grep`/`glob` are only emitted when they carry a rule so existing
  // configs do not gain empty tables.
  nextToolsSettings.shell = shell;
  nextToolsSettings.read = pathTable(pathBuckets.read);
  nextToolsSettings.write = pathTable(pathBuckets.write);
  for (const key of ["grep", "glob"] as const) {
    const bucket = pathBuckets[key];
    if (bucket && (bucket.allow.length > 0 || bucket.deny.length > 0)) {
      nextToolsSettings[key] = pathTable(bucket);
    }
  }

  return {
    ...existing,
    allowedTools: [...nextAllowedTools].toSorted(),
    toolsSettings: nextToolsSettings,
  };
}

function pathTable(bucket: { allow: string[]; deny: string[] } | undefined): {
  allowedPaths: string[];
  deniedPaths: string[];
} {
  return { allowedPaths: bucket?.allow ?? [], deniedPaths: bucket?.deny ?? [] };
}

function applyKiroWebPermission({
  category,
  pattern,
  action,
  nextAllowedTools,
  logger,
}: {
  category: "webfetch" | "websearch";
  pattern: string;
  action: PermissionAction;
  nextAllowedTools: Set<string>;
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
}): void {
  if (pattern !== "*") {
    logger?.warn(
      `Kiro ${category} supports only wildcard (*) via allowedTools. Skipping rule: ${pattern}`,
    );
    return;
  }
  const toolName = category === "webfetch" ? "web_fetch" : "web_search";
  if (action === "allow") {
    nextAllowedTools.add(toolName);
  } else {
    nextAllowedTools.delete(toolName);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  const result = UnknownRecordSchema.safeParse(value);
  return result.success ? result.data : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Build a canonical `{ pattern: action }` map from a Kiro tool settings record's
 * allow/deny string arrays (e.g. `allowedPaths`/`deniedPaths` or
 * `allowedCommands`/`deniedCommands`).
 */
function rulesFromArrays(
  settings: Record<string, unknown>,
  allowKey: string,
  denyKey: string,
): Record<string, PermissionAction> {
  const rules: Record<string, PermissionAction> = {};
  for (const pattern of asStringArray(settings[allowKey])) rules[pattern] = "allow";
  for (const pattern of asStringArray(settings[denyKey])) rules[pattern] = "deny";
  return rules;
}

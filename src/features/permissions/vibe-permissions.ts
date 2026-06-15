import { join } from "node:path";

import * as smolToml from "smol-toml";

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

type VibeToolConfig = Record<string, unknown> & {
  permission?: string;
  allow?: string[];
  deny?: string[];
  allowlist?: string[];
  denylist?: string[];
};

type VibeConfig = Record<string, unknown> & {
  enabled_tools?: string[];
  disabled_tools?: string[];
  tools?: Record<string, VibeToolConfig>;
};

const CANONICAL_TO_VIBE_TOOL_NAMES: Record<string, string> = {
  bash: "bash",
  read: "read_file",
  edit: "write_file",
  write: "write_file",
  webfetch: "fetch",
  websearch: "search_web",
};

const VIBE_TO_CANONICAL_TOOL_NAMES: Record<string, string> = {
  bash: "bash",
  read_file: "read",
  write_file: "edit",
  fetch: "webfetch",
  search_web: "websearch",
};

export class VibePermissions extends ToolPermissions {
  private readonly toml: VibeConfig;

  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? smolToml.stringify({}),
    });
    this.toml = parseVibeConfig(this.fileContent);
  }

  getToml(): VibeConfig {
    return this.toml;
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: ".vibe",
      relativeFilePath: "config.toml",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<VibePermissions> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? smolToml.stringify({});

    return new VibePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    validate = true,
    logger,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<VibePermissions> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? smolToml.stringify({});
    const config = parseVibeConfig(existingContent);

    const permission = rulesyncPermissions.getJson().permission;

    const tools = toVibeToolsRecord(config.tools);
    const enabledTools = new Set(toStringArray(config.enabled_tools));
    const disabledTools = new Set(toStringArray(config.disabled_tools));

    // rulesync is the source of truth for every tool it configures, so drop any
    // stale enabled/disabled filters for those tools before reapplying the
    // current state. Filters for tools rulesync does not configure are kept as-is
    // (e.g. a user-defined `enabled_tools` entry for a Vibe-only tool).
    for (const category of Object.keys(permission)) {
      const vibeToolName = toVibeToolName(category);
      enabledTools.delete(vibeToolName);
      disabledTools.delete(vibeToolName);
    }

    for (const [category, rules] of Object.entries(permission)) {
      const vibeToolName = toVibeToolName(category);
      const existingTool = toVibeToolConfig(tools[vibeToolName]);
      const nextTool: VibeToolConfig = { ...existingTool };
      const allow = new Set(toStringArray(existingTool.allow ?? existingTool.allowlist));
      const deny = new Set(toStringArray(existingTool.deny ?? existingTool.denylist));

      for (const [pattern, action] of Object.entries(rules)) {
        if (pattern === "*") {
          applyWildcardPermission({ action, toolConfig: nextTool });
          if (action === "deny") {
            disabledTools.add(vibeToolName);
            enabledTools.delete(vibeToolName);
          } else if (action === "allow") {
            enabledTools.add(vibeToolName);
            disabledTools.delete(vibeToolName);
          }
          continue;
        }

        if (action === "ask") {
          logger?.warn(
            `Vibe permissions do not support pattern-level "ask" rules. Skipping ${category}: ${pattern}`,
          );
          continue;
        }

        if (action === "allow") {
          allow.add(pattern);
        } else {
          deny.add(pattern);
        }
      }

      if (allow.size > 0) {
        nextTool.allow = [...allow].toSorted();
      }
      if (deny.size > 0) {
        nextTool.deny = [...deny].toSorted();
      }
      tools[vibeToolName] = nextTool;
    }

    config.tools = tools;
    if (enabledTools.size > 0) {
      config.enabled_tools = [...enabledTools].toSorted();
    } else {
      delete config.enabled_tools;
    }
    if (disabledTools.size > 0) {
      config.disabled_tools = [...disabledTools].toSorted();
    } else {
      delete config.disabled_tools;
    }

    return new VibePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: smolToml.stringify(config),
      validate,
      global,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const permission: PermissionsConfig["permission"] = {};

    for (const tool of toStringArray(this.toml.enabled_tools)) {
      ensurePermission(permission, toCanonicalToolName(tool))["*"] = "allow";
    }
    for (const tool of toStringArray(this.toml.disabled_tools)) {
      ensurePermission(permission, toCanonicalToolName(tool))["*"] = "deny";
    }

    for (const [vibeToolName, toolConfig] of Object.entries(toVibeToolsRecord(this.toml.tools))) {
      const category = toCanonicalToolName(vibeToolName);
      const rules = ensurePermission(permission, category);
      const action = fromVibePermission(toolConfig.permission);
      if (action !== undefined) {
        rules["*"] = action;
      }
      for (const pattern of toStringArray(toolConfig.allow ?? toolConfig.allowlist)) {
        rules[pattern] = "allow";
      }
      for (const pattern of toStringArray(toolConfig.deny ?? toolConfig.denylist)) {
        rules[pattern] = "deny";
      }
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify({ permission }, null, 2),
    });
  }

  validate(): ValidationResult {
    try {
      parseVibeConfig(this.fileContent);
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: new Error(`Failed to parse Vibe permissions TOML: ${formatError(error)}`),
      };
    }
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolPermissionsForDeletionParams): VibePermissions {
    return new VibePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: smolToml.stringify({}),
      validate: false,
      global,
    });
  }
}

function parseVibeConfig(fileContent: string): VibeConfig {
  const parsed = smolToml.parse(fileContent || smolToml.stringify({}));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return { ...(parsed as Record<string, unknown>) };
}

function toVibeToolName(category: string): string {
  return CANONICAL_TO_VIBE_TOOL_NAMES[category] ?? category;
}

function toCanonicalToolName(vibeToolName: string): string {
  return VIBE_TO_CANONICAL_TOOL_NAMES[vibeToolName] ?? vibeToolName;
}

function toVibeToolsRecord(value: unknown): Record<string, VibeToolConfig> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([toolName, config]) => [
      toolName,
      toVibeToolConfig(config),
    ]),
  );
}

function toVibeToolConfig(value: unknown): VibeToolConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function applyWildcardPermission({
  action,
  toolConfig,
}: {
  action: PermissionAction;
  toolConfig: VibeToolConfig;
}): void {
  if (action === "allow") {
    toolConfig.permission = "always";
  } else if (action === "ask") {
    toolConfig.permission = "ask";
  } else if (toolConfig.permission !== undefined) {
    delete toolConfig.permission;
  }
}

function fromVibePermission(value: unknown): PermissionAction | undefined {
  if (value === "always" || value === "allow") {
    return "allow";
  }
  if (value === "ask") {
    return "ask";
  }
  if (value === "deny" || value === "never") {
    return "deny";
  }
  return undefined;
}

function ensurePermission(
  permission: PermissionsConfig["permission"],
  category: string,
): Record<string, PermissionAction> {
  const existing = permission[category];
  if (existing) {
    return existing;
  }
  const created: Record<string, PermissionAction> = {};
  permission[category] = created;
  return created;
}

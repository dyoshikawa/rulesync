import { join } from "node:path";

import * as smolToml from "smol-toml";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type {
  PermissionAction,
  PermissionsConfig,
  VibePermissionsOverride,
} from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
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
  sensitive_patterns?: string[];
};

type VibeConfig = Record<string, unknown> & {
  enabled_tools?: string[];
  disabled_tools?: string[];
  tools?: Record<string, VibeToolConfig>;
};

/**
 * Vibe's builtin tool names are the snake_case of each tool class
 * (`BaseTool.get_name()`): `Edit` → `edit`, `WebFetch` → `web_fetch`,
 * `WebSearch` → `web_search`, alongside `read_file`, `write_file`, `bash` and
 * `grep`. `edit` and `write_file` are distinct tools — `write_file` has been
 * create-only since v2.14.0 — so the canonical `edit` and `write` categories
 * must not collapse onto one name.
 */
const CANONICAL_TO_VIBE_TOOL_NAMES: Record<string, string> = {
  bash: "bash",
  read: "read_file",
  edit: "edit",
  write: "write_file",
  webfetch: "web_fetch",
  websearch: "web_search",
};

const VIBE_TO_CANONICAL_TOOL_NAMES: Record<string, string> = {
  bash: "bash",
  read_file: "read",
  edit: "edit",
  write_file: "write",
  web_fetch: "webfetch",
  web_search: "websearch",
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
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
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

      // Vibe's per-tool config honors `allowlist`/`denylist` (BaseToolConfig);
      // the legacy `allow`/`deny` keys are tolerated (extra="allow") but never
      // consulted. Emit the canonical keys and drop any legacy keys carried over
      // from the existing file so a server is never left with both.
      delete nextTool.allow;
      delete nextTool.deny;
      if (allow.size > 0) {
        nextTool.allowlist = [...allow].toSorted();
      }
      if (deny.size > 0) {
        nextTool.denylist = [...deny].toSorted();
      }
      tools[vibeToolName] = nextTool;
    }

    applyVibeSensitivePatterns(tools, rulesyncPermissions.getJson().vibe);

    return new VibePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "permissions",
        existingContent,
        patch: {
          tools,
          enabled_tools: enabledTools.size > 0 ? [...enabledTools].toSorted() : undefined,
          disabled_tools: disabledTools.size > 0 ? [...disabledTools].toSorted() : undefined,
        },
        filePath,
      }),
      validate,
      global,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const permission: PermissionsConfig["permission"] = {};
    const vibeOverridePermission: Record<string, { sensitive_patterns: string[] }> = {};

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

      // `sensitive_patterns` (escalate-to-ASK-when-ALWAYS) has no canonical
      // action, so it round-trips through the `vibe` override rather than the
      // shared block.
      const sensitivePatterns = toStringArray(toolConfig.sensitive_patterns);
      if (sensitivePatterns.length > 0) {
        vibeOverridePermission[category] = { sensitive_patterns: sensitivePatterns };
      }
    }

    // Drop categories that ended up with no rules (e.g. a Vibe tool that carries
    // only `sensitive_patterns`, which routes into the `vibe` override) so the
    // shared block does not accumulate empty `{}` entries.
    for (const [category, rules] of Object.entries(permission)) {
      if (Object.keys(rules).length === 0) {
        delete permission[category];
      }
    }

    const json: PermissionsConfig =
      Object.keys(vibeOverridePermission).length > 0
        ? { permission, vibe: { permission: vibeOverridePermission } }
        : { permission };

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(json, null, 2),
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

/**
 * Apply the Vibe-scoped override's per-tool `sensitive_patterns` (patterns that
 * escalate to ASK even when the base permission is ALWAYS). rulesync owns this
 * list for any category the override names: a present list is set, an empty
 * one clears it. Categories not named keep whatever the existing file had.
 */
function applyVibeSensitivePatterns(
  tools: Record<string, VibeToolConfig>,
  vibeOverride: VibePermissionsOverride | undefined,
): void {
  for (const [category, toolOverride] of Object.entries(vibeOverride?.permission ?? {})) {
    const vibeToolName = toVibeToolName(category);
    const nextTool = toVibeToolConfig(tools[vibeToolName]);
    const patterns = toStringArray(toolOverride.sensitive_patterns);
    if (patterns.length > 0) {
      nextTool.sensitive_patterns = [...patterns].toSorted();
    } else {
      delete nextTool.sensitive_patterns;
    }
    tools[vibeToolName] = nextTool;
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

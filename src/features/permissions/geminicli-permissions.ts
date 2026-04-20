import { join } from "node:path";

import * as smolToml from "smol-toml";
import { z } from "zod/mini";

import type { ValidationResult } from "../../types/ai-file.js";
import type { PermissionsConfig } from "../../types/permissions.js";
import { ToolFile } from "../../types/tool-file.js";
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

const GeminiCliSettingsSchema = z.looseObject({
  policyPaths: z.optional(z.array(z.string())),
  tools: z.optional(
    z.looseObject({
      allowed: z.optional(z.array(z.string())),
      exclude: z.optional(z.array(z.string())),
    }),
  ),
});

type GeminiCliSettings = z.infer<typeof GeminiCliSettingsSchema>;

const RULESYNC_TO_GEMINICLI_TOOL_NAME: Record<string, string> = {
  bash: "run_shell_command",
  read: "read_file",
  edit: "replace",
  write: "write_file",
  webfetch: "web_fetch",
};

export class GeminicliPermissions extends ToolPermissions {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: ".gemini",
      relativeFilePath: "settings.json",
    };
  }

  override isDeletable(): boolean {
    return false;
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<GeminicliPermissions> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);
    return new GeminicliPermissions({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static async fromRulesyncPermissions({
    baseDir = process.cwd(),
    rulesyncPermissions,
    validate = true,
    logger,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<GeminicliPermissions> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);

    const settingsResult = GeminiCliSettingsSchema.safeParse(JSON.parse(existingContent));
    if (!settingsResult.success) {
      throw new Error(
        `Failed to parse existing Gemini CLI settings at ${filePath}: ${formatError(settingsResult.error)}`,
      );
    }

    const { allowed: _allowed, exclude: _exclude } = convertRulesyncToGeminicliTools({
      config: rulesyncPermissions.getJson(),
      logger,
    });
    void _allowed;
    void _exclude;
    const { allowed, exclude, ...restTools } = settingsResult.data.tools ?? {};
    void allowed;
    void exclude;
    const merged = {
      ...settingsResult.data,
      ...(Object.keys(restTools).length > 0 ? { tools: restTools } : {}),
      policyPaths: mergePolicyPaths({
        policyPaths: settingsResult.data.policyPaths,
        rulesyncPolicyPath: join(".gemini", "rulesync-permissions.toml"),
      }),
    };

    return new GeminicliPermissions({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(merged, null, 2),
      validate,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let settings: GeminiCliSettings;
    try {
      const parsed = JSON.parse(this.getFileContent());
      settings = GeminiCliSettingsSchema.parse(parsed);
    } catch (error) {
      throw new Error(
        `Failed to parse Gemini CLI permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const permission: PermissionsConfig["permission"] = {};

    for (const toolEntry of settings.tools?.allowed ?? []) {
      const mapped = parseGeminicliToolEntry({ entry: toolEntry });
      const rules = (permission[mapped.category] ??= {});
      rules[mapped.pattern] = "allow";
    }

    for (const toolEntry of settings.tools?.exclude ?? []) {
      const mapped = parseGeminicliToolEntry({ entry: toolEntry });
      const rules = (permission[mapped.category] ??= {});
      rules[mapped.pattern] = "deny";
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify({ permission }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): GeminicliPermissions {
    return new GeminicliPermissions({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({}, null, 2),
      validate: false,
    });
  }
}

export class GeminicliPolicyFile extends ToolFile {
  validate(): ValidationResult {
    return { success: true, error: null };
  }
}

export function createGeminicliPolicyFile({
  baseDir = process.cwd(),
  config,
}: {
  baseDir?: string;
  config: PermissionsConfig;
}): GeminicliPolicyFile {
  return new GeminicliPolicyFile({
    baseDir,
    relativeDirPath: ".gemini",
    relativeFilePath: "rulesync-permissions.toml",
    fileContent: buildGeminicliPolicyContent(config),
  });
}

function buildGeminicliPolicyContent(config: PermissionsConfig): string {
  const rule: Record<string, unknown>[] = [];
  for (const [toolName, rules] of Object.entries(config.permission)) {
    const mappedToolName = RULESYNC_TO_GEMINICLI_TOOL_NAME[toolName] ?? toolName;
    for (const [pattern, action] of Object.entries(rules)) {
      const currentRule: Record<string, unknown> = {
        toolName: mappedToolName,
        decision: mapToGeminicliDecision(action),
        priority: 100,
      };
      if (mappedToolName === "run_shell_command") {
        if (pattern !== "*") {
          currentRule.commandPrefix = pattern.endsWith(" *") ? pattern.slice(0, -2) : pattern;
        }
      } else if (pattern !== "*") {
        currentRule.argsPattern = globPatternToRegex(pattern);
      }
      rule.push(currentRule);
    }
  }
  return smolToml.stringify({ rule });
}

function mapToGeminicliDecision(action: "allow" | "deny" | "ask"): "allow" | "deny" | "ask_user" {
  if (action === "ask") {
    return "ask_user";
  }
  return action;
}

function globPatternToRegex(pattern: string): string {
  let regex = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === undefined) {
      continue;
    }
    const next = pattern[i + 1];
    if (char === "*" && next === "*") {
      regex += ".*";
      i += 1;
      continue;
    }
    if (char === "*") {
      regex += '[^\\"]*';
      continue;
    }
    if (/[.+?^${}()|[\]\\]/.test(char)) {
      regex += `\\${char}`;
      continue;
    }
    regex += char;
  }
  return regex;
}

function mergePolicyPaths({
  policyPaths,
  rulesyncPolicyPath,
}: {
  policyPaths: unknown;
  rulesyncPolicyPath: string;
}): string[] {
  const existingPolicyPaths = Array.isArray(policyPaths)
    ? policyPaths.filter((value): value is string => typeof value === "string")
    : [];
  if (existingPolicyPaths.includes(rulesyncPolicyPath)) {
    return existingPolicyPaths;
  }
  return [...existingPolicyPaths, rulesyncPolicyPath];
}

function convertRulesyncToGeminicliTools({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
}): { allowed: string[]; exclude: string[] } {
  const allowed: string[] = [];
  const exclude: string[] = [];

  for (const [toolName, rules] of Object.entries(config.permission)) {
    const mappedToolName = RULESYNC_TO_GEMINICLI_TOOL_NAME[toolName] ?? toolName;
    if (!RULESYNC_TO_GEMINICLI_TOOL_NAME[toolName]) {
      logger?.warn(`Gemini CLI permissions use direct tool names. Mapping as-is: ${toolName}`);
    }
    for (const [pattern, action] of Object.entries(rules)) {
      if (action === "ask") {
        logger?.warn(
          `Gemini CLI does not support explicit "ask" rules in settings. Skipping ${toolName}:${pattern}`,
        );
        continue;
      }

      const geminiEntry = pattern === "*" ? mappedToolName : `${mappedToolName}(${pattern})`;
      if (action === "allow") {
        allowed.push(geminiEntry);
      } else {
        exclude.push(geminiEntry);
      }
    }
  }

  return { allowed, exclude };
}

function parseGeminicliToolEntry({ entry }: { entry: string }): {
  category: string;
  pattern: string;
} {
  const match = /^([^()]+?)(?:\((.*)\))?$/.exec(entry);
  if (!match) return { category: entry, pattern: "*" };
  const rawToolName = match[1]?.trim() ?? entry;
  const mappedCategory = Object.entries(RULESYNC_TO_GEMINICLI_TOOL_NAME).find(
    ([, value]) => value === rawToolName,
  )?.[0];
  return {
    category: mappedCategory ?? rawToolName,
    pattern: (match[2] ?? "*").trim(),
  };
}

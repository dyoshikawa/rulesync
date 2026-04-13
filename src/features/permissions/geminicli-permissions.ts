import { join } from "node:path";

import { z } from "zod/mini";

import type { ValidationResult } from "../../types/ai-file.js";
import type { PermissionsConfig } from "../../types/permissions.js";
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

    const { allowed, exclude } = convertRulesyncToGeminicliTools({
      config: rulesyncPermissions.getJson(),
      logger,
    });
    const merged = {
      ...settingsResult.data,
      tools: {
        ...settingsResult.data.tools,
        ...(allowed.length > 0 ? { allowed } : {}),
        ...(exclude.length > 0 ? { exclude } : {}),
      },
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

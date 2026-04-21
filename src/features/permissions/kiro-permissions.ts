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

const KiroAgentSchema = z.looseObject({
  allowedTools: z.optional(z.array(z.string())),
  toolsSettings: z.optional(z.record(z.string(), z.unknown())),
});

type KiroAgent = z.infer<typeof KiroAgentSchema>;
const UnknownRecordSchema = z.record(z.string(), z.unknown());

export class KiroPermissions extends ToolPermissions {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: join(".kiro", "agents"),
      relativeFilePath: "default.json",
    };
  }

  override isDeletable(): boolean {
    return false;
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
  }: ToolPermissionsFromFileParams): Promise<KiroPermissions> {
    const paths = this.getSettablePaths();
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);
    return new KiroPermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<KiroPermissions> {
    const paths = this.getSettablePaths();
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
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
      baseDir,
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

    const shellSettings = asRecord(toolsSettings.shell);
    const shellAllow = asStringArray(shellSettings.allowedCommands);
    const shellDeny = asStringArray(shellSettings.deniedCommands);
    if (shellAllow.length > 0 || shellDeny.length > 0) {
      permission.bash = {};
      for (const pattern of shellAllow) permission.bash[pattern] = "allow";
      for (const pattern of shellDeny) permission.bash[pattern] = "deny";
    }

    const readSettings = asRecord(toolsSettings.read);
    const readAllow = asStringArray(readSettings.allowedPaths);
    const readDeny = asStringArray(readSettings.deniedPaths);
    if (readAllow.length > 0 || readDeny.length > 0) {
      permission.read = {};
      for (const pattern of readAllow) permission.read[pattern] = "allow";
      for (const pattern of readDeny) permission.read[pattern] = "deny";
    }

    const writeSettings = asRecord(toolsSettings.write);
    const writeAllow = asStringArray(writeSettings.allowedPaths);
    const writeDeny = asStringArray(writeSettings.deniedPaths);
    if (writeAllow.length > 0 || writeDeny.length > 0) {
      permission.write = {};
      for (const pattern of writeAllow) permission.write[pattern] = "allow";
      for (const pattern of writeDeny) permission.write[pattern] = "deny";
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
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): KiroPermissions {
    return new KiroPermissions({
      baseDir,
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

  const shell: { allowedCommands: string[]; deniedCommands: string[] } = {
    allowedCommands: [],
    deniedCommands: [],
  };
  const read: { allowedPaths: string[]; deniedPaths: string[] } = {
    allowedPaths: [],
    deniedPaths: [],
  };
  const write: { allowedPaths: string[]; deniedPaths: string[] } = {
    allowedPaths: [],
    deniedPaths: [],
  };

  for (const [category, rules] of Object.entries(config.permission)) {
    for (const [pattern, action] of Object.entries(rules)) {
      if (action === "ask") {
        logger?.warn(`Kiro permissions do not support "ask". Skipping ${category}:${pattern}`);
        continue;
      }
      if (category === "bash") {
        (action === "allow" ? shell.allowedCommands : shell.deniedCommands).push(pattern);
      } else if (category === "read") {
        (action === "allow" ? read.allowedPaths : read.deniedPaths).push(pattern);
      } else if (category === "edit" || category === "write") {
        (action === "allow" ? write.allowedPaths : write.deniedPaths).push(pattern);
      } else if (category === "webfetch" || category === "websearch") {
        if (pattern !== "*") {
          logger?.warn(
            `Kiro ${category} supports only wildcard (*) via allowedTools. Skipping rule: ${pattern}`,
          );
          continue;
        }
        const toolName = category === "webfetch" ? "web_fetch" : "web_search";
        if (action === "allow") {
          nextAllowedTools.add(toolName);
        } else {
          nextAllowedTools.delete(toolName);
        }
      } else {
        logger?.warn(`Kiro permissions do not support category: ${category}. Skipping.`);
      }
    }
  }

  nextToolsSettings.shell = shell;
  nextToolsSettings.read = read;
  nextToolsSettings.write = write;

  return {
    ...existing,
    allowedTools: [...nextAllowedTools].toSorted(),
    toolsSettings: nextToolsSettings,
  };
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

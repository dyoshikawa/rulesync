import { join } from "node:path";

import * as smolToml from "smol-toml";
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

const GEMINICLI_POLICY_RELATIVE_DIR_PATH = join(".gemini", "policies");
const GEMINICLI_POLICY_FILE_NAME = "rulesync.toml";

const RULESYNC_TO_GEMINICLI_TOOL_NAME: Record<string, string> = {
  bash: "run_shell_command",
  read: "read_file",
  edit: "replace",
  write: "write_file",
  webfetch: "web_fetch",
};

const GEMINICLI_TO_RULESYNC_TOOL_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(RULESYNC_TO_GEMINICLI_TOOL_NAME).map(([k, v]) => [v, k]),
);

export class GeminicliPermissions extends ToolPermissions {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: GEMINICLI_POLICY_RELATIVE_DIR_PATH,
      relativeFilePath: GEMINICLI_POLICY_FILE_NAME,
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<GeminicliPermissions> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";
    return new GeminicliPermissions({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static fromRulesyncPermissions({
    baseDir = process.cwd(),
    rulesyncPermissions,
    validate = true,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): GeminicliPermissions {
    const paths = this.getSettablePaths({ global });
    const fileContent = buildGeminicliPolicyContent(rulesyncPermissions.getJson());

    return new GeminicliPermissions({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const permission: PermissionsConfig["permission"] = {};

    const fileContent = this.getFileContent();
    if (fileContent.trim().length > 0) {
      let parsed: unknown;
      try {
        parsed = smolToml.parse(fileContent);
      } catch (error) {
        throw new Error(
          `Failed to parse Gemini CLI policy TOML in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
          { cause: error },
        );
      }

      const rules = extractRules(parsed);
      for (const rule of rules) {
        const category = GEMINICLI_TO_RULESYNC_TOOL_NAME[rule.toolName] ?? rule.toolName;
        const action = mapFromGeminicliDecision(rule.decision);
        if (!action) continue;
        const pattern = extractPattern(rule);
        const target = (permission[category] ??= {});
        target[pattern] = action;
      }
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
      fileContent: "",
      validate: false,
    });
  }
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

function mapFromGeminicliDecision(decision: unknown): "allow" | "deny" | "ask" | null {
  if (decision === "allow") return "allow";
  if (decision === "deny") return "deny";
  if (decision === "ask_user") return "ask";
  return null;
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

function regexToGlobPattern(regex: string): string {
  let glob = "";
  let i = 0;
  while (i < regex.length) {
    if (regex.startsWith('[^\\"]*', i)) {
      glob += "*";
      i += 6;
      continue;
    }
    if (regex.startsWith(".*", i)) {
      glob += "**";
      i += 2;
      continue;
    }
    const char = regex[i];
    if (char === "\\") {
      const escaped = regex[i + 1];
      if (escaped !== undefined) {
        glob += escaped;
        i += 2;
        continue;
      }
    }
    glob += char ?? "";
    i += 1;
  }
  return glob;
}

const GeminicliPolicyRuleSchema = z.looseObject({
  toolName: z.string(),
  decision: z.optional(z.unknown()),
  commandPrefix: z.optional(z.string()),
  argsPattern: z.optional(z.string()),
});

const GeminicliPolicyFileSchema = z.looseObject({
  rule: z.optional(z.array(z.looseObject({}))),
});

type GeminicliPolicyRule = z.infer<typeof GeminicliPolicyRuleSchema>;

function extractRules(parsed: unknown): GeminicliPolicyRule[] {
  const parsedFile = GeminicliPolicyFileSchema.safeParse(parsed);
  if (!parsedFile.success || !parsedFile.data.rule) {
    return [];
  }
  const rules: GeminicliPolicyRule[] = [];
  for (const entry of parsedFile.data.rule) {
    const result = GeminicliPolicyRuleSchema.safeParse(entry);
    if (result.success) {
      rules.push(result.data);
    }
  }
  return rules;
}

function extractPattern(rule: GeminicliPolicyRule): string {
  if (rule.toolName === "run_shell_command") {
    if (!rule.commandPrefix) return "*";
    return rule.commandPrefix.endsWith(" *") || rule.commandPrefix.endsWith("*")
      ? rule.commandPrefix
      : `${rule.commandPrefix} *`;
  }
  return rule.argsPattern ? regexToGlobPattern(rule.argsPattern) : "*";
}

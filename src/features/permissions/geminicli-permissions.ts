import { join } from "node:path";

import * as smolToml from "smol-toml";
import { z } from "zod/mini";

import type { ValidationResult } from "../../types/ai-file.js";
import type { PermissionsConfig } from "../../types/permissions.js";
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

// Priority values chosen so `deny` beats `ask` beats `allow` in first-match order, which
// the Gemini CLI Policy Engine does not otherwise enforce.
const PRIORITY_DENY = 300;
const PRIORITY_ASK = 200;
const PRIORITY_ALLOW = 100;

// Regex fragments emitted for glob wildcards. `*` is single-segment (no `/`, no `"`),
// `**` spans segments. `"` is excluded so the pattern cannot leak out of a JSON string
// value (the Policy Engine matches argsPattern against a JSON-stringified args object).
const SINGLE_STAR_REGEX = '[^/\\"]*';
const DOUBLE_STAR_REGEX = ".*";
// Legacy emission prior to segment-aware encoding; accepted on import for compatibility.
const LEGACY_STAR_REGEX = '[^\\"]*';
const COMMAND_ARGS_ANCHOR = '"command":"';

const moduleLogger: Logger = new ConsoleLogger();

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
    logger = moduleLogger,
  }: ToolPermissionsFromRulesyncPermissionsParams): GeminicliPermissions {
    const paths = this.getSettablePaths({ global });
    const fileContent = buildGeminicliPolicyContent(rulesyncPermissions.getJson(), logger);

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

      const rules = extractRules(parsed, moduleLogger);
      for (const [index, rule] of rules.entries()) {
        const category = GEMINICLI_TO_RULESYNC_TOOL_NAME[rule.toolName] ?? rule.toolName;
        const action = mapFromGeminicliDecision(rule.decision);
        if (!action) {
          moduleLogger.warn(
            `Skipping rule #${index} in ${this.getRelativeFilePath()}: unknown decision ${JSON.stringify(rule.decision)}`,
          );
          continue;
        }
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

function buildGeminicliPolicyContent(config: PermissionsConfig, logger: Logger): string {
  const rules: Record<string, unknown>[] = [];
  for (const [toolName, entries] of Object.entries(config.permission)) {
    const mappedToolName = RULESYNC_TO_GEMINICLI_TOOL_NAME[toolName] ?? toolName;
    for (const [pattern, action] of Object.entries(entries)) {
      const decision = mapToGeminicliDecision(action);
      const currentRule: Record<string, unknown> = {
        toolName: mappedToolName,
        decision,
        priority: priorityForDecision(decision),
      };
      if (mappedToolName === "run_shell_command") {
        applyShellPattern({ rule: currentRule, pattern, toolName, logger });
      } else if (pattern !== "*") {
        currentRule.argsPattern = `"${globPatternToRegex(pattern)}`;
      }
      rules.push(currentRule);
    }
  }
  // Stable-sort by priority descending so deny rules win the engine's first-match.
  rules.sort((a, b) => toNumber(b.priority) - toNumber(a.priority));
  return smolToml.stringify({ rule: rules });
}

function toNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function applyShellPattern({
  rule,
  pattern,
  toolName,
  logger,
}: {
  rule: Record<string, unknown>;
  pattern: string;
  toolName: string;
  logger: Logger;
}): void {
  if (pattern === "*") {
    return;
  }
  const trailingWildcardStripped = pattern.endsWith(" *") ? pattern.slice(0, -2) : pattern;
  if (hasGlobMetacharacter(trailingWildcardStripped)) {
    // Interior wildcards are meaningless inside commandPrefix (Gemini CLI escapes the
    // string as a literal), so emit argsPattern with a JSON-anchor instead.
    rule.argsPattern = `${COMMAND_ARGS_ANCHOR}${globPatternToRegex(pattern)}`;
    logger.warn(
      `Gemini CLI does not support glob metacharacters inside a bash command prefix; emitting argsPattern for rule "${toolName}: ${pattern}".`,
    );
    return;
  }
  rule.commandPrefix = trailingWildcardStripped;
}

function hasGlobMetacharacter(pattern: string): boolean {
  return /[*?[\]]/.test(pattern);
}

function priorityForDecision(decision: "allow" | "deny" | "ask_user"): number {
  if (decision === "deny") return PRIORITY_DENY;
  if (decision === "ask_user") return PRIORITY_ASK;
  return PRIORITY_ALLOW;
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
      regex += DOUBLE_STAR_REGEX;
      i += 1;
      continue;
    }
    if (char === "*") {
      regex += SINGLE_STAR_REGEX;
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
    if (regex.startsWith(SINGLE_STAR_REGEX, i)) {
      glob += "*";
      i += SINGLE_STAR_REGEX.length;
      continue;
    }
    if (regex.startsWith(LEGACY_STAR_REGEX, i)) {
      glob += "*";
      i += LEGACY_STAR_REGEX.length;
      continue;
    }
    if (regex.startsWith(DOUBLE_STAR_REGEX, i)) {
      glob += "**";
      i += DOUBLE_STAR_REGEX.length;
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

function extractRules(parsed: unknown, logger: Logger): GeminicliPolicyRule[] {
  const parsedFile = GeminicliPolicyFileSchema.safeParse(parsed);
  if (!parsedFile.success || !parsedFile.data.rule) {
    return [];
  }
  const rules: GeminicliPolicyRule[] = [];
  for (const [index, entry] of parsedFile.data.rule.entries()) {
    const result = GeminicliPolicyRuleSchema.safeParse(entry);
    if (result.success) {
      rules.push(result.data);
      continue;
    }
    logger.warn(
      `Skipping malformed Gemini CLI policy rule at index ${index}: ${formatError(result.error)}`,
    );
  }
  return rules;
}

function extractPattern(rule: GeminicliPolicyRule): string {
  if (rule.toolName === "run_shell_command") {
    if (rule.argsPattern) {
      const stripped = rule.argsPattern.startsWith(COMMAND_ARGS_ANCHOR)
        ? rule.argsPattern.slice(COMMAND_ARGS_ANCHOR.length)
        : rule.argsPattern;
      return regexToGlobPattern(stripped);
    }
    if (!rule.commandPrefix) return "*";
    // Canonicalize reverse to "<prefix> *" — the engine matches commandPrefix with a
    // word boundary, so "git" and "git *" are equivalent inside Gemini CLI.
    return rule.commandPrefix.endsWith(" *") || rule.commandPrefix.endsWith("*")
      ? rule.commandPrefix
      : `${rule.commandPrefix} *`;
  }
  if (!rule.argsPattern) return "*";
  const regex = rule.argsPattern.startsWith('"') ? rule.argsPattern.slice(1) : rule.argsPattern;
  return regexToGlobPattern(regex);
}

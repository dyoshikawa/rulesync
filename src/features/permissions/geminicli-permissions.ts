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
// the Gemini CLI Policy Engine does not otherwise enforce. The spread is wide enough that
// a hand-authored rule in a sibling `.toml` under `.gemini/policies/` is unlikely to outrank
// a rulesync-managed deny by accident.
const PRIORITY_DENY = 1_000_000;
const PRIORITY_ASK = 1_000;
const PRIORITY_ALLOW = 1;

// Regex fragments emitted for glob wildcards. Both exclude `"` so the pattern cannot leak
// across a JSON string boundary when the Policy Engine matches argsPattern against a
// JSON-stringified args object. `*` additionally excludes `/` to stay within a single path
// segment; `**` spans segments but still stops at the closing string quote.
const SINGLE_STAR_REGEX = '[^/\\"]*';
const DOUBLE_STAR_REGEX = '[^\\"]*';
const SINGLE_CHAR_REGEX = '[^/\\"]';
// Legacy encodings accepted on import for backward compatibility with earlier iterations
// of this PR that emitted un-segmented or un-bounded wildcards.
const LEGACY_SINGLE_STAR_REGEX = '[^\\"]*';
const LEGACY_DOUBLE_STAR_REGEX = ".*";
const COMMAND_ARGS_ANCHOR = '"command":"';
const VALUE_END_ANCHOR = '\\"';

// Reserved JavaScript object keys that would either alias the prototype chain (prototype
// pollution) or be silently swallowed when used as a plain-object key. We reject these on
// both the `category` (tool name) and `pattern` sides when importing.
const RESERVED_OBJECT_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

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
        // Use Object.hasOwn to avoid inheriting accessors (e.g., `__proto__`) from the
        // mapping object; falling back to the raw toolName preserves behavior for tools
        // we don't know about yet.
        const mappedCategory = Object.hasOwn(GEMINICLI_TO_RULESYNC_TOOL_NAME, rule.toolName)
          ? GEMINICLI_TO_RULESYNC_TOOL_NAME[rule.toolName]
          : undefined;
        const category = mappedCategory ?? rule.toolName;
        if (RESERVED_OBJECT_KEYS.has(category)) {
          moduleLogger.warn(
            `Skipping rule #${index} in ${this.getRelativeFilePath()}: toolName "${rule.toolName}" maps to a reserved object key ("${category}") and would risk prototype pollution.`,
          );
          continue;
        }
        const action = mapFromGeminicliDecision(rule.decision);
        if (!action) {
          moduleLogger.warn(
            `Skipping rule #${index} (toolName="${rule.toolName}", commandPrefix=${JSON.stringify(rule.commandPrefix)}, argsPattern=${JSON.stringify(rule.argsPattern)}) in ${this.getRelativeFilePath()}: unknown decision ${JSON.stringify(rule.decision)}`,
          );
          continue;
        }
        if (
          rule.toolName === "run_shell_command" &&
          rule.commandPrefix !== undefined &&
          rule.argsPattern !== undefined
        ) {
          moduleLogger.warn(
            `Rule #${index} in ${this.getRelativeFilePath()} sets both commandPrefix and argsPattern; rulesync will honor argsPattern and ignore commandPrefix=${JSON.stringify(rule.commandPrefix)}.`,
          );
        }
        const pattern = extractPattern(rule);
        if (RESERVED_OBJECT_KEYS.has(pattern)) {
          moduleLogger.warn(
            `Skipping rule #${index} in ${this.getRelativeFilePath()}: pattern "${pattern}" is a reserved object key.`,
          );
          continue;
        }
        // Use Object.hasOwn to avoid touching inherited accessors like `__proto__` when
        // the Set guard above is ever bypassed (e.g., future tool-name mapping changes).
        const existing = Object.hasOwn(permission, category) ? permission[category] : undefined;
        const target = existing ?? {};
        if (existing === undefined) {
          permission[category] = target;
        }
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
  const rules: { rule: Record<string, unknown>; order: number }[] = [];
  let order = 0;
  for (const [toolName, entries] of Object.entries(config.permission)) {
    const mappedToolName = RULESYNC_TO_GEMINICLI_TOOL_NAME[toolName] ?? toolName;
    for (const [pattern, action] of Object.entries(entries)) {
      if (pattern === "") {
        logger.warn(
          `Skipping rule "${toolName}: "": empty pattern is not a valid permission target and would silently match every invocation (bash) or nothing (other tools).`,
        );
        continue;
      }
      if (hasUnsafeAnchorChar(pattern)) {
        logger.warn(
          `Skipping rule "${toolName}: ${pattern}": pattern contains a character (" or \\) that would break JSON-anchor matching in the Gemini CLI Policy Engine.`,
        );
        continue;
      }
      const decision = mapToGeminicliDecision(action);
      if (
        mappedToolName === "run_shell_command" &&
        (pattern === "*" || pattern === "**") &&
        decision !== "ask_user"
      ) {
        // `*` / `**` on bash would emit a rule with no commandPrefix / argsPattern, which
        // the Policy Engine treats as "match every shell command". At PRIORITY_DENY this is
        // a global shell lockout; at PRIORITY_ALLOW it silently opens arbitrary execution.
        // Catch-all is only meaningful at `ask_user` (interactive prompting).
        logger.warn(
          `Skipping rule "${toolName}: ${pattern}" with decision ${decision}: bash match-all patterns are only supported with "ask" because they would otherwise affect every shell command.`,
        );
        continue;
      }
      const currentRule: Record<string, unknown> = {
        toolName: mappedToolName,
        decision,
        priority: priorityForDecision(decision),
      };
      if (mappedToolName === "run_shell_command") {
        applyShellPattern({ rule: currentRule, pattern, toolName, logger });
      } else if (pattern !== "*") {
        currentRule.argsPattern = buildNonShellArgsPattern(pattern);
      }
      rules.push({ rule: currentRule, order: order++ });
    }
  }
  // Sort by priority descending; preserve input order within the same priority band by
  // using the explicit secondary key rather than relying on Array.prototype.sort stability.
  rules.sort((a, b) => {
    const diff = toNumber(b.rule.priority) - toNumber(a.rule.priority);
    return diff !== 0 ? diff : a.order - b.order;
  });
  return smolToml.stringify({ rule: rules.map((entry) => entry.rule) });
}

function buildNonShellArgsPattern(pattern: string): string {
  return `"${globPatternToRegex(pattern)}${VALUE_END_ANCHOR}`;
}

function hasUnsafeAnchorChar(pattern: string): boolean {
  return pattern.includes('"') || pattern.includes("\\");
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
  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i];
    if (char === undefined) {
      break;
    }
    if (char === "*" && pattern[i + 1] === "*") {
      regex += DOUBLE_STAR_REGEX;
      i += 2;
      continue;
    }
    if (char === "*") {
      regex += SINGLE_STAR_REGEX;
      i += 1;
      continue;
    }
    if (char === "?") {
      regex += SINGLE_CHAR_REGEX;
      i += 1;
      continue;
    }
    if (char === "[") {
      // Character classes are emitted as regex literals. A class body can easily bypass the
      // JSON-field-boundary guard via negation (`[^a]` matches `"`) or ranges that include
      // the `"` (34) or `/` (47) code points (e.g. `[!-~]`). Rather than attempt to enumerate
      // every unsafe form, we treat `[` as a literal character. Glob character classes are
      // extremely rare in permission rules and are not a feature users are expected to rely
      // on here.
      regex += escapeRegexChar(char);
      i += 1;
      continue;
    }
    if (char === "]") {
      regex += escapeRegexChar(char);
      i += 1;
      continue;
    }
    if (isRegexMetacharacter(char)) {
      regex += `\\${char}`;
      i += 1;
      continue;
    }
    regex += char;
    i += 1;
  }
  return regex;
}

function escapeRegexChar(char: string): string {
  return `\\${char}`;
}

function isRegexMetacharacter(char: string): boolean {
  return /[.+^${}()|\\]/.test(char);
}

function regexToGlobPattern(regex: string): string {
  // Strip the emitter's trailing value-end anchor so imported patterns round-trip cleanly.
  let source = regex;
  if (source.endsWith(VALUE_END_ANCHOR)) {
    source = source.slice(0, -VALUE_END_ANCHOR.length);
  }
  let glob = "";
  let i = 0;
  while (i < source.length) {
    if (source.startsWith(DOUBLE_STAR_REGEX, i)) {
      glob += "**";
      i += DOUBLE_STAR_REGEX.length;
      continue;
    }
    if (source.startsWith(LEGACY_DOUBLE_STAR_REGEX, i)) {
      glob += "**";
      i += LEGACY_DOUBLE_STAR_REGEX.length;
      continue;
    }
    if (source.startsWith(SINGLE_STAR_REGEX, i)) {
      glob += "*";
      i += SINGLE_STAR_REGEX.length;
      continue;
    }
    if (source.startsWith(LEGACY_SINGLE_STAR_REGEX, i)) {
      glob += "*";
      i += LEGACY_SINGLE_STAR_REGEX.length;
      continue;
    }
    if (source.startsWith(SINGLE_CHAR_REGEX, i)) {
      glob += "?";
      i += SINGLE_CHAR_REGEX.length;
      continue;
    }
    const char = source[i];
    if (char === "\\") {
      const escaped = source[i + 1];
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

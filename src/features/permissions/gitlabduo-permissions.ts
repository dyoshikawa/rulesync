import { join } from "node:path";

import { uniq } from "es-toolkit";
import { applyEdits, modify } from "jsonc-parser";

import { GITLABDUO_DIR, GITLABDUO_SETTINGS_FILE_NAME } from "../../constants/gitlabduo-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { createIntersectionBudget } from "../../utils/glob.js";
import { parseJsonc } from "../../utils/jsonc.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
import { isPlainObject } from "../../utils/type-guards.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ALL_TOOLS_PERMISSION_CATEGORY,
  collectShellCommandRules,
  createShadowingRestrictionsTest,
  SHELL_PERMISSION_CATEGORY,
  warnAboutUnwrittenCommandRules,
} from "./shell-command-categories.js";
import {
  ToolPermissions,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

const GITLABDUO_GLOBAL_ONLY_MESSAGE =
  "GitLab Duo CLI reads the permissions setting only from the user settings file; use --global to sync ~/.gitlab/duo/settings.json";

const TOOL_LABEL = "GitLab Duo CLI";
const PERMISSIONS_KEY = "permissions";

/** The Duo tool that runs a shell command; the only one rulesync writes statements for. */
const COMMAND_TOOL_NAME = "run_command";

/** The server refuses a pattern longer than this (`MAX_PATTERN_LENGTH`). */
const MAX_PATTERN_LENGTH = 256;

/**
 * Characters a written pattern must not hold:
 * - `; & | < > $ \` ( ) { }` and line breaks are shell metacharacters the
 *   server refuses in a command-tool pattern.
 * - Quotes and the backslash are taken off by the shell-style word split the
 *   server reads a pattern through, so the pattern would be matched as
 *   something other than what it says.
 * - `[` and `]` start an `fnmatch` character class inside a token, which the
 *   canonical glob does not read the same way.
 */
const UNSUPPORTED_PATTERN_CHARACTERS = /[;&|<>$`(){}\n\r'"\\[\]]/;

/** A canonical pattern may spell "any arguments" as a trailing `:*` (`git:*`). */
const TRAILING_ARGUMENT_WILDCARD = /:\*$/;

/** Glob characters that make a Duo pattern match more than its literal spelling. */
const GLOB_CHARACTERS = /[*?[\]]/;

type DuoPermissionStatement = {
  action: string;
  resource: string;
  effect: PermissionAction;
};

/**
 * Permissions adapter for GitLab Duo CLI.
 *
 * Duo CLI 10.5.0 reads a `permissions` array of
 * `{ action, resource, effect }` statements from the managed settings file and
 * the user's `~/.gitlab/duo/settings.json`. The project files
 * (`.gitlab/duo/settings.json`, `.gitlab/duo/settings.local.json`) are
 * deliberately not read for it, so this surface is **global only**.
 * @see https://gitlab.com/gitlab-org/editor-extensions/gitlab-lsp/-/blob/v10.5.0/packages/core/settings/src/definitions.ts
 * @see https://gitlab.com/gitlab-org/editor-extensions/gitlab-lsp/-/blob/v10.5.0/packages/core/settings/src/tool_permissions.ts
 *
 * Only `allow` is enforced: each allow statement is submitted to the GitLab
 * instance as a session pattern approval when a session starts. `ask` and
 * `deny` statements are accepted but only logged. rulesync therefore writes
 * allow statements only, and never one that could auto-approve something the
 * canonical file restricts:
 *
 * - Only canonical `bash` `allow` rules are written, as
 *   `{ action: "run_command", resource: <pattern>, effect: "allow" }`. Other
 *   categories have no Duo spelling that is known to match no wider than the
 *   canonical rule (the server matches other tools' patterns against their raw
 *   JSON arguments), so their allow rules are skipped with a warning.
 * - Every `deny` and `ask` rule under `bash` or the all-tools `*` category
 *   withholds the allow rules that could match the same command, because Duo
 *   cannot enforce the restriction itself. A deny is also reported: the command
 *   is asked about, not blocked.
 * - The GitLab server matches a command-tool pattern token by token
 *   (`CommandPatternMatcher`): a literal token must match exactly, `*` is one
 *   token that does not start with `-`, and a token holding a glob is matched
 *   on its own. That is never wider than the canonical glob, where `*` spans
 *   any characters. A trailing `:*` is written as ` *`. A pattern the server
 *   refuses (a lone `*`, `**`, shell metacharacters, more than 256 characters)
 *   or would read differently (quotes, escapes, character classes) is skipped
 *   with a warning.
 * @see https://gitlab.com/gitlab-org/gitlab/-/blob/master/ee/app/models/ai/duo_workflows/command_pattern_matcher.rb
 *
 * On generate, the statements rulesync owns — those for `run_command` — are
 * replaced, and every other statement and key of the file is kept, with the
 * comments outside the `permissions` array (the array is rewritten whole). On import, `run_command` statements come back under `bash`; an
 * allow whose resource holds a glob is skipped, since the canonical glob would
 * read it more widely than Duo does.
 */
export class GitlabduoPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  /**
   * `settings.json` holds every Duo CLI setting, so rulesync never brings it
   * into existence just to hold nothing.
   */
  override shouldSkipCreationWhenPayloadEmpty(): boolean {
    return true;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: GITLABDUO_DIR,
      relativeFilePath: GITLABDUO_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<GitlabduoPermissions> {
    if (!global) {
      throw new Error(GITLABDUO_GLOBAL_ONLY_MESSAGE);
    }
    const paths = GitlabduoPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new GitlabduoPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global: true,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    logger,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<GitlabduoPermissions> {
    if (!global) {
      throw new Error(GITLABDUO_GLOBAL_ONLY_MESSAGE);
    }
    const paths = GitlabduoPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing, so a dry run does not create the file.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const baseContent = existingContent.trim() === "" ? "{}" : existingContent;
    const settings = parseSettings({ content: baseContent, filePath });

    const existing = settings[PERMISSIONS_KEY];
    const generated = convertRulesyncToGitlabduoStatements({
      config: rulesyncPermissions.getJson(),
      logger,
    });

    let fileContent = baseContent;
    if (existing !== undefined && !Array.isArray(existing)) {
      warnWithFallback(
        logger,
        `${TOOL_LABEL}: '${PERMISSIONS_KEY}' in ${filePath} is not an array, so it was left ` +
          `untouched rather than overwritten, and no rule was written.`,
      );
    } else {
      // Statements for other tools are the user's own; rulesync owns only the
      // `run_command` ones it writes.
      const kept = (existing ?? []).filter(
        (statement: unknown) =>
          !(isPlainObject(statement) && statement.action === COMMAND_TOOL_NAME),
      );
      const statements = [...kept, ...generated];
      if (statements.length > 0 || existing !== undefined) {
        const edits = modify(
          baseContent,
          [PERMISSIONS_KEY],
          statements.length > 0 ? statements : undefined,
          { formattingOptions: { insertSpaces: true, tabSize: 2 } },
        );
        fileContent = applyEdits(baseContent, edits);
      }
    }

    return new GitlabduoPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate: true,
      global: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const selfPath = join(this.getRelativeDirPath(), this.getRelativeFilePath());
    const settings = parseSettings({ content: this.getFileContent() || "{}", filePath: selfPath });
    const raw = settings[PERMISSIONS_KEY];
    const statements = Array.isArray(raw) ? raw : [];
    if (raw !== undefined && !Array.isArray(raw)) {
      warnWithFallback(
        undefined,
        `${TOOL_LABEL} ignores '${PERMISSIONS_KEY}' unless it is an array, so nothing was ` +
          `imported from ${selfPath}.`,
      );
    }

    const bash: Record<string, PermissionAction> = {};
    const skippedAllows: string[] = [];
    for (const statement of statements) {
      if (!isDuoPermissionStatement(statement) || statement.action !== COMMAND_TOOL_NAME) {
        continue;
      }
      const { resource, effect } = statement;
      // An allow is imported only when it is a plain command the server would
      // accept as written: a glob reads more widely as a canonical pattern, and
      // a resource the server refuses (`ls; rm -rf ~`) approves nothing in Duo
      // but would approve it for every other tool.
      if (
        effect === "allow" &&
        (GLOB_CHARACTERS.test(resource) || toGitlabduoCommandResource(resource) !== resource)
      ) {
        skippedAllows.push(resource);
        continue;
      }
      // The stricter effect wins when one resource is listed twice.
      const previous = bash[resource];
      if (previous === undefined || rank(effect) > rank(previous)) {
        bash[resource] = effect;
      }
    }
    if (skippedAllows.length > 0) {
      warnWithFallback(
        undefined,
        `The run_command allow statement(s) for ${uniq(skippedAllows).join(", ")} in ` +
          `${selfPath} were not imported: a glob matches more as a canonical pattern than in ` +
          `${TOOL_LABEL} (where '*' is one argument that is not a flag), and a pattern the ` +
          `GitLab server refuses approves nothing in Duo but would for other tools.`,
      );
    }

    const config: PermissionsConfig = {
      permission: Object.keys(bash).length > 0 ? { [SHELL_PERMISSION_CATEGORY]: bash } : {},
    };
    return RulesyncPermissions.fromImportedFileContent({
      outputRoot: this.outputRoot,
      sourcePath: this.getRelativePathFromCwd(),
      fileContent: JSON.stringify(config, null, 2),
    });
  }
}

function rank(effect: PermissionAction): number {
  return effect === "deny" ? 2 : effect === "ask" ? 1 : 0;
}

function isDuoPermissionStatement(value: unknown): value is DuoPermissionStatement {
  return (
    isPlainObject(value) &&
    typeof value.action === "string" &&
    value.action.length > 0 &&
    typeof value.resource === "string" &&
    (value.effect === "allow" || value.effect === "ask" || value.effect === "deny")
  );
}

function parseSettings({
  content,
  filePath,
}: {
  content: string;
  filePath: string;
}): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseJsonc(content);
  } catch (error) {
    throw new Error(
      `Failed to parse GitLab Duo CLI settings at ${filePath}: ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`GitLab Duo CLI settings at ${filePath} must contain a JSON object.`);
  }
  return parsed;
}

/**
 * A canonical command pattern as Duo's token matcher reads it: trimmed, runs
 * of whitespace collapsed to one space (Duo splits a command into words, so
 * `git  push` and `git push` are one command), and a trailing `:*` ("any
 * arguments") spelled ` *`.
 */
export function normalizeGitlabduoCommandPattern(pattern: string): string {
  let normalized = pattern.trim();
  if (TRAILING_ARGUMENT_WILDCARD.test(normalized)) {
    normalized = `${normalized.slice(0, -2)} *`;
  }
  return normalized.trim().split(/\s+/).join(" ");
}

/**
 * The Duo `resource` for a canonical `bash` allow pattern, or `null` when the
 * server would refuse it or read it differently from what it says. The result
 * never matches a command the canonical pattern does not match.
 */
export function toGitlabduoCommandResource(pattern: string): string | null {
  const resource = normalizeGitlabduoCommandPattern(pattern);
  if (resource === "" || resource === "*" || resource.length > MAX_PATTERN_LENGTH) return null;
  if (UNSUPPORTED_PATTERN_CHARACTERS.test(resource)) return null;
  if (resource.includes("**")) return null;
  return resource;
}

/**
 * Convert the canonical config into the `run_command` allow statements Duo CLI
 * enforces, reporting every rule that could not be carried.
 */
export function convertRulesyncToGitlabduoStatements({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: Logger;
}): DuoPermissionStatement[] {
  const { rules, foreignRestrictingCategories, ignoredAllToolsAllowPatterns } =
    collectShellCommandRules(config.permission);

  // Each restriction is compared both as written and as Duo's matcher reads
  // it (see `normalizeGitlabduoCommandPattern`), so a `git push:*` ask or a
  // `git  push` deny still withholds an allow Duo would apply to those
  // commands. Adding readings only ever adds overlaps.
  const restrictions = uniq(
    rules
      .filter(({ action }) => action !== "allow")
      .flatMap(({ pattern }) => [pattern, normalizeGitlabduoCommandPattern(pattern)])
      .filter((pattern) => pattern !== ""),
  ).map((pattern) => ({ pattern, fromAllToolsCategory: false }));
  const budget = createIntersectionBudget();
  const shadowingRestrictions = createShadowingRestrictionsTest(restrictions, { budget });

  const resources: string[] = [];
  const shadowedAllowPatterns: string[] = [];
  const unsupportedPatterns: string[] = [];
  for (const { pattern, action } of rules) {
    if (action !== "allow") continue;
    const resource = toGitlabduoCommandResource(pattern);
    if (resource === null) {
      unsupportedPatterns.push(pattern);
      continue;
    }
    // Compared as the resource actually written: Duo matches it token by
    // token, never more widely than the glob it reads as here.
    if (shadowingRestrictions(resource).length > 0) {
      shadowedAllowPatterns.push(pattern);
      continue;
    }
    resources.push(resource);
  }

  warnAboutUnwrittenCommandRules({
    toolLabel: TOOL_LABEL,
    surfaceLabel: `${PERMISSIONS_KEY} statements for ${COMMAND_TOOL_NAME}`,
    foreignRestrictingCategories,
    shadowedAllowPatterns: uniq(shadowedAllowPatterns),
    ignoredAllToolsAllowPatterns,
    intersectionBudgetExhausted: budget.remaining === 0,
    logger,
  });

  const denyPatterns = uniq(
    rules.filter(({ action }) => action === "deny").map(({ pattern }) => pattern),
  );
  if (denyPatterns.length > 0) {
    warnWithFallback(
      logger,
      `${TOOL_LABEL} enforces only allow statements in '${PERMISSIONS_KEY}' (ask and deny are ` +
        `logged and ignored), so the deny rule(s) for ${denyPatterns.join(", ")} were not ` +
        `written. Those commands are asked about rather than blocked.`,
    );
  }

  const foreignAllowCategories = Object.entries(config.permission)
    .filter(
      ([category, categoryRules]) =>
        category !== SHELL_PERMISSION_CATEGORY &&
        category !== ALL_TOOLS_PERMISSION_CATEGORY &&
        Object.values(categoryRules).includes("allow"),
    )
    .map(([category]) => category);
  if (foreignAllowCategories.length > 0) {
    warnWithFallback(
      logger,
      `${TOOL_LABEL}: only 'bash' allow rules are written (as ${COMMAND_TOOL_NAME} statements), ` +
        `so the allow rules of '${foreignAllowCategories.join("', '")}' were skipped.`,
    );
  }

  if (unsupportedPatterns.length > 0) {
    warnWithFallback(
      logger,
      `${TOOL_LABEL} refuses a ${COMMAND_TOOL_NAME} pattern that is a lone '*', holds '**' or a ` +
        `shell metacharacter, or is longer than ${MAX_PATTERN_LENGTH} characters, and reads ` +
        `quotes, escapes and '[...]' differently from the canonical glob, so the allow rule(s) ` +
        `for ${uniq(unsupportedPatterns).join(", ")} were skipped.`,
    );
  }

  return uniq(resources).map((resource) => ({
    action: COMMAND_TOOL_NAME,
    resource,
    effect: "allow" as const,
  }));
}

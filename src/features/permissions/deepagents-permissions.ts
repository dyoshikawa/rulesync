import { join } from "node:path";

import { uniq } from "es-toolkit";
import * as smolToml from "smol-toml";

import { DEEPAGENTS_CONFIG_FILE_NAME, DEEPAGENTS_DIR } from "../../constants/deepagents-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

const DEEPAGENTS_GLOBAL_ONLY_MESSAGE =
  "deepagents-cli permissions are global-only; use --global to sync ~/.deepagents/config.toml";

// `[shell].allow_list` — the shell commands dcode runs without asking.
const SHELL_TABLE_KEY = "shell";
const ALLOW_LIST_KEY = "allow_list";

// `[startup]` holds the approval-mode knobs the `deepagents` override authors.
const STARTUP_TABLE_KEY = "startup";
// Keys lifted back into the override on import. `startup.recent` is
// app-managed (dcode rewrites it as the user cycles modes) and
// `startup.onboarding` is cosmetic, so neither round-trips through a
// permissions file that gets committed.
const DEEPAGENTS_STARTUP_KEYS = ["mode", "yolo_switcher", "read_project_dotenv"] as const;

// Sentinels `parse_shell_allow_list_items` recognizes instead of a command
// name: `all` allows everything (and must be the sole entry), `recommended`
// expands to a curated list dcode owns.
const ALLOW_ALL_SENTINEL = "all";
const RECOMMENDED_SENTINEL = "recommended";

// dcode compares the first token of each pipeline segment against the list
// with `==`, so an entry carrying a glob character never matches anything.
const GLOB_CHARACTERS_PATTERN = /[*?[\]]/;
// A canonical pattern may spell "any arguments" as a trailing `:*` on the
// executable itself (`git:*`) rather than as a separate word (`git *`).
const TRAILING_ARGUMENT_WILDCARD_PATTERN = /:\*$/;

/**
 * Permissions adapter for deepagents-cli (dcode).
 *
 * dcode auto-approves a shell command when the **executable name** of every
 * segment of its pipeline appears in `[shell].allow_list` of the user config
 * (`~/.deepagents/config.toml`); everything else prompts. There is no denylist
 * and no per-argument form: matching is an exact `==` against the first token
 * of each segment, after a dangerous-pattern check that rejects command
 * substitution, redirects and process substitution outright.
 * @see https://docs.langchain.com/oss/deepagents/code/configuration
 *
 * This surface is **global only** — dcode reads no project-level config file,
 * so there is nothing to write into a repository.
 *
 * Only the canonical `bash` category maps, and only its `allow` rules:
 *
 * - A pattern is reduced to its executable token, because that is all dcode
 *   matches on — `git *`, `git:*` and `git commit:*` all become `git`. The
 *   last of those *widens* the rule (every `git` subcommand is then
 *   auto-approved), so it is written with a warning rather than silently.
 * - `*` becomes the `all` sentinel, which auto-approves every command **and**
 *   skips the dangerous-pattern check. That is a big enough jump to warn about
 *   on its own, and upstream rejects the whole option when `all` shares the
 *   list with anything else, so it is emitted as the sole entry.
 * - A token that still holds a glob after the reduction (`npm-*`, `*.sh`) has
 *   no counterpart and is skipped with a warning: written verbatim it would
 *   match no command at all, which reads as an allow rule that quietly does
 *   nothing.
 * - `ask` rules need no output — a command outside the list already prompts —
 *   but `deny` rules are reported, because dcode cannot express them: the
 *   command is still asked about rather than blocked.
 *
 * dcode's approval mode is a separate axis from the allowlist and is authored
 * through the `deepagents` override namespace (see
 * `DeepagentsPermissionsOverrideSchema`): `[startup].mode`
 * (`manual` / `auto` / `yolo`), `[startup].yolo_switcher` and
 * `[startup].read_project_dotenv` are merged into the file on generate and
 * lifted back into the override on import.
 *
 * On **import** the allowlist comes back as `bash` `allow` rules named by the
 * executable, `all` as the `*` pattern, and a list that mixes `all` with
 * command names as nothing at all — upstream raises on that combination and
 * ignores the option, so importing it as a partial allowlist would record
 * permissions dcode is not applying. A `recommended` entry is dropped rather
 * than expanded: the curated list behind it is upstream's to edit, and a copy
 * frozen into `.rulesync/permissions.jsonc` would drift away from it silently.
 * The next generate therefore does not write `recommended` back, which removes
 * those commands from the allowlist — fewer auto-approvals than before, so it
 * fails closed, but re-add the ones you want by name.
 *
 * `config.toml` holds every dcode setting, so the tables above are merged in
 * place and the file is never deleted.
 */
export class DeepagentsPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
    });
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: DEEPAGENTS_DIR,
      relativeFilePath: DEEPAGENTS_CONFIG_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<DeepagentsPermissions> {
    if (!global) {
      throw new Error(DEEPAGENTS_GLOBAL_ONLY_MESSAGE);
    }
    const paths = DeepagentsPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";
    return new DeepagentsPermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<DeepagentsPermissions> {
    if (!global) {
      throw new Error(DEEPAGENTS_GLOBAL_ONLY_MESSAGE);
    }
    const paths = DeepagentsPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing, so a dry run does not create the user's global
    // config as a side effect (mirrors the Warp and Zed adapters).
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";

    let settings: Record<string, unknown>;
    try {
      settings = smolToml.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing deepagents config at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();
    const allowList = convertRulesyncToDeepagentsAllowList({ config, logger });

    // Merge into `[shell]`, preserving every other key of that table.
    const shell = isRecord(settings[SHELL_TABLE_KEY]) ? { ...settings[SHELL_TABLE_KEY] } : {};
    if (allowList.length > 0) {
      shell[ALLOW_LIST_KEY] = allowList;
    } else {
      delete shell[ALLOW_LIST_KEY];
    }
    if (Object.keys(shell).length > 0) {
      settings[SHELL_TABLE_KEY] = shell;
    } else {
      // Nothing left to say about the shell; an empty `[shell]` table would be
      // noise in a file the user also edits by hand.
      delete settings[SHELL_TABLE_KEY];
    }

    const startupOverride = config.deepagents?.startup;
    if (isRecord(startupOverride) && Object.keys(startupOverride).length > 0) {
      const startup = isRecord(settings[STARTUP_TABLE_KEY])
        ? { ...settings[STARTUP_TABLE_KEY] }
        : {};
      // Verbatim, so a key added upstream passes through the loose override.
      Object.assign(startup, startupOverride);
      settings[STARTUP_TABLE_KEY] = startup;
    }

    return new DeepagentsPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: smolToml.stringify(settings as smolToml.TomlTable),
      validate: true,
      global: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let settings: Record<string, unknown>;
    try {
      settings = smolToml.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse deepagents permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const shell = isRecord(settings[SHELL_TABLE_KEY]) ? settings[SHELL_TABLE_KEY] : {};
    const config = convertDeepagentsToRulesyncPermissions({
      allowList: readAllowListEntries(shell[ALLOW_LIST_KEY]),
    });

    const startup = isRecord(settings[STARTUP_TABLE_KEY]) ? settings[STARTUP_TABLE_KEY] : {};
    const startupOverride: Record<string, unknown> = {};
    for (const key of DEEPAGENTS_STARTUP_KEYS) {
      if (startup[key] !== undefined) startupOverride[key] = startup[key];
    }

    const result: Record<string, unknown> = { ...config };
    if (Object.keys(startupOverride).length > 0) {
      result.deepagents = { startup: startupOverride };
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(result, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): DeepagentsPermissions {
    return new DeepagentsPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global: true,
    });
  }
}

/**
 * Read `[shell].allow_list` the way dcode does: a TOML array is taken element
 * by element, while a string is split on commas — the one spelling that cannot
 * carry a command name containing a comma.
 */
function readAllowListEntries(raw: unknown): string[] {
  if (isStringArray(raw)) {
    return raw.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return [];
}

/**
 * Reduce a canonical `bash` pattern to the executable token dcode matches on,
 * or `null` when nothing usable is left.
 */
function toExecutableToken(pattern: string): { token: string; widened: boolean } | null {
  const trimmed = pattern.trim();
  const [first = "", ...rest] = trimmed.split(/\s+/);
  const token = first.replace(TRAILING_ARGUMENT_WILDCARD_PATTERN, "");
  if (token.length === 0 || GLOB_CHARACTERS_PATTERN.test(token)) {
    return null;
  }
  // Anything after the executable — `git commit:*`, `npm run build` — is a
  // narrower rule than dcode can hold, except the bare `*` that already means
  // "any arguments".
  const remainder = rest.join(" ");
  return { token, widened: remainder.length > 0 && remainder !== "*" };
}

/**
 * Convert rulesync permissions config to dcode's `[shell].allow_list`. Only
 * `bash` `allow` rules map; everything else is skipped, with a warning
 * wherever the skip loses a restriction rather than a redundancy.
 */
function convertRulesyncToDeepagentsAllowList({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: Logger;
}): string[] {
  const allowed: string[] = [];
  const widenedPatterns: string[] = [];
  const unmatchablePatterns: string[] = [];
  const sentinelPatterns: string[] = [];
  let denyRuleCount = 0;
  let allowAll = false;

  for (const [category, rules] of Object.entries(config.permission)) {
    if (category !== "bash") {
      const hasDeny = Object.values(rules).some((action) => action === "deny");
      if (hasDeny && logger) {
        logger.warn(
          `deepagents-cli only models shell-command permissions ([shell].allow_list), so ` +
            `'${category}' deny rules cannot be represented and were skipped.`,
        );
      }
      continue;
    }
    for (const [pattern, action] of Object.entries(rules)) {
      if (action === "deny") {
        denyRuleCount += 1;
        continue;
      }
      if (action === "ask") {
        // A command outside the allowlist already prompts, so `ask` is the
        // default rather than something to write.
        continue;
      }
      if (pattern.trim() === "*") {
        allowAll = true;
        continue;
      }
      const reduced = toExecutableToken(pattern);
      if (!reduced) {
        unmatchablePatterns.push(pattern);
        continue;
      }
      // `all` and `recommended` are read as sentinels rather than as command
      // names, so a pattern that reduces to one of them cannot be written: it
      // would either allow every command or splice in a list rulesync did not
      // author.
      if (
        reduced.token.toLowerCase() === ALLOW_ALL_SENTINEL ||
        reduced.token.toLowerCase() === RECOMMENDED_SENTINEL
      ) {
        sentinelPatterns.push(pattern);
        continue;
      }
      if (reduced.widened) {
        widenedPatterns.push(pattern);
      }
      allowed.push(reduced.token);
    }
  }

  if (logger) {
    if (denyRuleCount > 0) {
      logger.warn(
        `deepagents-cli has no command denylist — a command it does not auto-approve is asked ` +
          `about, not blocked — so ${denyRuleCount} bash deny rule(s) from ` +
          `.rulesync/permissions.jsonc were skipped and those commands remain runnable on ` +
          `approval.`,
      );
    }
    if (widenedPatterns.length > 0) {
      logger.warn(
        `deepagents-cli matches only the executable name of a command, so ` +
          `${widenedPatterns.join(", ")} were widened to their first token — every invocation of ` +
          `those executables is now auto-approved, not just the listed arguments.`,
      );
    }
    if (unmatchablePatterns.length > 0) {
      logger.warn(
        `deepagents-cli compares allow_list entries to the executable name exactly, so the ` +
          `pattern(s) ${unmatchablePatterns.join(", ")} would match no command and were skipped.`,
      );
    }
    if (sentinelPatterns.length > 0) {
      logger.warn(
        `deepagents-cli reads 'all' and 'recommended' in allow_list as sentinels rather than ` +
          `command names, so ${sentinelPatterns.join(", ")} were skipped. Use the '*' pattern to ` +
          `allow every command.`,
      );
    }
  }

  if (allowAll) {
    if (logger) {
      logger.warn(
        `The bash '*' allow rule became allow_list = ["all"] for deepagents-cli, which ` +
          `auto-approves every command and skips its dangerous-pattern check (command ` +
          `substitution, redirects, process substitution). List the executables you want ` +
          `instead if that is more than you meant.`,
      );
    }
    // Upstream rejects the whole option when `all` shares the list, and every
    // other entry is redundant beside it anyway.
    return [ALLOW_ALL_SENTINEL];
  }

  return uniq(allowed.toSorted());
}

/**
 * Convert dcode's `[shell].allow_list` back to rulesync config under the
 * `bash` category. Entries are lifted verbatim — an executable name is already
 * a canonical pattern, and it is what the generate direction writes back.
 */
function convertDeepagentsToRulesyncPermissions({
  allowList,
}: {
  allowList: string[];
}): PermissionsConfig {
  const bash: Record<string, PermissionAction> = {};

  if (allowList.length === 1 && allowList[0]?.toLowerCase() === ALLOW_ALL_SENTINEL) {
    return { permission: { bash: { "*": "allow" } } };
  }
  // `all` mixed with command names makes dcode raise and ignore the option
  // outright, so importing it as a partial allowlist would model permissions
  // the tool is not applying.
  if (allowList.some((entry) => entry.toLowerCase() === ALLOW_ALL_SENTINEL)) {
    return { permission: {} };
  }

  for (const entry of allowList) {
    // `recommended` names a curated list dcode owns; expanding it here would
    // freeze a copy that drifts as upstream edits it, so it is left out and
    // the generate direction simply does not write it back.
    if (entry.toLowerCase() === RECOMMENDED_SENTINEL) {
      continue;
    }
    bash[entry] = "allow";
  }

  return Object.keys(bash).length > 0 ? { permission: { bash } } : { permission: {} };
}

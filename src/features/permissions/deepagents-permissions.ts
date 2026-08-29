import { join } from "node:path";

import { uniq } from "es-toolkit";
import * as smolToml from "smol-toml";

import { DEEPAGENTS_CONFIG_FILE_NAME, DEEPAGENTS_DIR } from "../../constants/deepagents-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
import { parseCommaSeparatedList } from "../../utils/parse-comma-separated-list.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { isPlainObject } from "../../utils/type-guards.js";
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
 *   list with anything else, so it is emitted as the sole entry. When the
 *   config also *denies* something, `all` is not written at all: switching the
 *   dangerous-pattern check off in the name of a rule meant to restrict would
 *   leave the user with less than dcode's own default, so deny wins.
 * - A token that still holds a glob after the reduction (`npm-*`, `*.sh`) has
 *   no counterpart and is skipped with a warning: written verbatim it would
 *   match no command at all, which reads as an allow rule that quietly does
 *   nothing.
 * - `ask` rules need no output — a command outside the list already prompts —
 *   but `deny` rules are reported, because dcode cannot express them: the
 *   command is still asked about rather than blocked. An `ask` or `deny` on a
 *   narrower pattern than an `allow` beside it (`npm publish` against `npm *`)
 *   is worse than unenforced — the reduction collides them on `npm` and dcode
 *   keeps the allow — so those are warned about separately.
 *
 * dcode's approval mode is a separate axis from the allowlist and is authored
 * through the `deepagents` override namespace (see
 * `DeepagentsPermissionsOverrideSchema`): `[startup].mode`
 * (`manual` / `auto` / `yolo`), `[startup].yolo_switcher` and
 * `[startup].read_project_dotenv` are merged into the file on generate and
 * lifted back into the override on import.
 *
 * On **import** the allowlist comes back as `bash` `allow` rules named by the
 * executable — skipping any entry dcode could not match in the first place, so
 * an inert `git status` does not come back as a rule the next generate would
 * widen — `all` as the `*` pattern, and a list that mixes `all` with
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
 * place and the file is never deleted. The merge is a parse and a re-emit,
 * which keeps every unrelated key and table but does not preserve comments.
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

    // Merge into `[shell]`, preserving every other key of that table. A
    // `shell` that is not a table at all — an array of tables, a scalar — is
    // something rulesync did not write and cannot merge into, so it is left
    // exactly as the user has it rather than replaced.
    const existingShell = settings[SHELL_TABLE_KEY];
    if (existingShell !== undefined && !isPlainObject(existingShell)) {
      warnWithFallback(
        logger,
        `deepagents-cli: '${SHELL_TABLE_KEY}' in ${filePath} is not a table, so ` +
          `${ALLOW_LIST_KEY} was left untouched rather than overwriting it.`,
      );
    } else {
      const shell = isPlainObject(existingShell) ? { ...existingShell } : {};
      if (allowList.length > 0) {
        shell[ALLOW_LIST_KEY] = allowList;
      } else if (shell[ALLOW_LIST_KEY] !== undefined) {
        // Removing an allowlist only ever asks about more commands, so it fails
        // closed — but it discards a list the user may have curated by hand
        // (`recommended` among it), which is worth saying out loud.
        warnWithFallback(
          logger,
          `deepagents-cli: no bash allow rule maps to an executable name, so the existing ` +
            `[${SHELL_TABLE_KEY}].${ALLOW_LIST_KEY} in ${filePath} was removed and those ` +
            `commands will be asked about again.`,
        );
        delete shell[ALLOW_LIST_KEY];
      }
      if (Object.keys(shell).length > 0) {
        settings[SHELL_TABLE_KEY] = shell;
      } else {
        // Nothing left to say about the shell; an empty `[shell]` table would be
        // noise in a file the user also edits by hand.
        delete settings[SHELL_TABLE_KEY];
      }
    }

    const startupOverride = config.deepagents?.startup;
    if (isPlainObject(startupOverride) && Object.keys(startupOverride).length > 0) {
      const existingStartup = settings[STARTUP_TABLE_KEY];
      if (existingStartup !== undefined && !isPlainObject(existingStartup)) {
        warnWithFallback(
          logger,
          `deepagents-cli: '${STARTUP_TABLE_KEY}' in ${filePath} is not a table, so the ` +
            `deepagents startup override was skipped rather than overwriting it.`,
        );
      } else {
        const startup = isPlainObject(existingStartup) ? { ...existingStartup } : {};
        const previousStartup = { ...startup };
        // Copied key by key rather than `Object.assign`ed, so a `__proto__`
        // coming from the JSON config cannot reach the object's prototype.
        for (const [key, value] of Object.entries(startupOverride)) {
          if (isPrototypePollutionKey(key)) continue;
          // Verbatim, so a key added upstream passes through the loose override.
          startup[key] = value;
        }
        warnAboutStartupRelaxations({ startupOverride, previousStartup, filePath, logger });
        settings[STARTUP_TABLE_KEY] = startup;
      }
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

    // `isPlainObject`, not `isRecord`: smol-toml returns a datetime as a
    // `Date` subclass, which is a record but not a table to merge into.
    const shell = isPlainObject(settings[SHELL_TABLE_KEY]) ? settings[SHELL_TABLE_KEY] : {};
    const config = convertDeepagentsToRulesyncPermissions({
      allowList: readAllowListEntries(shell[ALLOW_LIST_KEY]),
    });

    const startup = isPlainObject(settings[STARTUP_TABLE_KEY]) ? settings[STARTUP_TABLE_KEY] : {};
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
 * Say what the reduction to executable names could not write. Split out from
 * `convertRulesyncToDeepagentsAllowList` because the rules it reports on
 * outnumber the ones it writes: every category dcode cannot express is a
 * sentence here.
 */
function warnAboutUnwrittenBashRules({
  allowList,
  allowAll,
  requestedAllowAll,
  askPatterns,
  denyPatterns,
  widenedPatterns,
  unmatchablePatterns,
  sentinelPatterns,
  logger,
}: {
  allowList: string[];
  allowAll: boolean;
  requestedAllowAll: boolean;
  askPatterns: string[];
  denyPatterns: string[];
  widenedPatterns: string[];
  unmatchablePatterns: string[];
  sentinelPatterns: string[];
  logger?: Logger;
}): void {
  // A rule that is not written is one thing; a rule the reduction *inverts*
  // is another. Reducing to the executable makes an `ask` or `deny` on a
  // narrower pattern (`npm publish`) collide with an `allow` on a wider one
  // (`npm *`), and dcode keeps only the allow — so the command the author
  // wanted stopped runs with no prompt at all.
  const allowedTokens = new Set(allowList);
  const isAutoApproved = (pattern: string): boolean => {
    if (allowAll) return true;
    const token = toExecutableToken(pattern)?.token;
    return token !== undefined && allowedTokens.has(token);
  };
  const shadowedAsk = askPatterns.filter(isAutoApproved);
  const shadowedDeny = denyPatterns.filter(isAutoApproved);
  const unenforcedDeny = denyPatterns.filter((pattern) => !isAutoApproved(pattern));

  if (unenforcedDeny.length > 0) {
    warnWithFallback(
      logger,
      `deepagents-cli has no command denylist — a command it does not auto-approve is asked ` +
        `about, not blocked — so ${unenforcedDeny.length} bash deny rule(s) from ` +
        `.rulesync/permissions.jsonc were skipped and those commands remain runnable on ` +
        `approval.`,
    );
  }
  const shadowReason = allowAll
    ? `allow_list = ["all"] auto-approves every command`
    : `their executable is in the generated allow_list`;
  if (shadowedDeny.length > 0) {
    warnWithFallback(
      logger,
      `deepagents-cli matches only the executable name, so the deny rule(s) ` +
        `${shadowedDeny.join(", ")} are not merely unenforced: ${shadowReason}, so those ` +
        `commands run without a prompt. Narrow or drop the allow rule that covers them.`,
    );
  }
  if (shadowedAsk.length > 0) {
    warnWithFallback(
      logger,
      `deepagents-cli matches only the executable name, so the ask rule(s) ` +
        `${shadowedAsk.join(", ")} run without a prompt: ${shadowReason}. Narrow or drop the ` +
        `allow rule that covers them.`,
    );
  }
  if (widenedPatterns.length > 0) {
    warnWithFallback(
      logger,
      `deepagents-cli matches only the executable name of a command, so ` +
        `${widenedPatterns.join(", ")} were widened to their first token — every invocation of ` +
        `those executables is now auto-approved, not just the listed arguments.`,
    );
  }
  if (unmatchablePatterns.length > 0) {
    warnWithFallback(
      logger,
      `deepagents-cli compares allow_list entries to the executable name exactly, so the ` +
        `pattern(s) ${unmatchablePatterns.join(", ")} would match no command and were skipped.`,
    );
  }
  if (sentinelPatterns.length > 0) {
    warnWithFallback(
      logger,
      `deepagents-cli reads 'all' and 'recommended' in allow_list as sentinels rather than ` +
        `command names, so ${sentinelPatterns.join(", ")} were skipped. Use the '*' pattern to ` +
        `allow every command.`,
    );
  }
  if (requestedAllowAll && !allowAll) {
    // A deny rule for another tool (`Read(...)`, `WebFetch(...)`) blocks the
    // sentinel just as a bash one does: 'all' turns dcode's dangerous-pattern
    // check off wholesale, so any denial in the config makes it too broad.
    const denyReason =
      denyPatterns.length > 0
        ? `your config denies commands`
        : `your config has deny rules for other tools`;
    warnWithFallback(
      logger,
      `The bash '*' allow rule was not written as allow_list = ["all"] for deepagents-cli, ` +
        `because 'all' also turns off its dangerous-pattern check (command substitution, ` +
        `redirects, process substitution) and ${denyReason} — the two together would be weaker ` +
        `than dcode's own default. List the executables you want auto-approved instead.`,
    );
  }
  if (allowAll) {
    warnWithFallback(
      logger,
      `The bash '*' allow rule became allow_list = ["all"] for deepagents-cli, which ` +
        `auto-approves every command and skips its dangerous-pattern check (command ` +
        `substitution, redirects, process substitution). List the executables you want ` +
        `instead if that is more than you meant.`,
    );
  }
}

/**
 * Warn when the `deepagents` startup override relaxes what dcode may do on its
 * own, because that override is written into the user's **global** config from
 * a `.rulesync/permissions.jsonc` that a repository can carry: cloning a
 * project and running `rulesync generate --global` would otherwise switch a
 * machine's approval mode with nothing said about it.
 *
 * `mode` decides whether dcode asks before acting at all (`auto` and `yolo`
 * approve on their own), `yolo_switcher` puts YOLO in the mode cycle, and
 * `read_project_dotenv` loads an untrusted repository's `.env` into the
 * process environment. The value being replaced is named alongside, so a
 * setting the user had turned down is visible as such.
 */
function warnAboutStartupRelaxations({
  startupOverride,
  previousStartup,
  filePath,
  logger,
}: {
  startupOverride: Record<string, unknown>;
  previousStartup: Record<string, unknown>;
  filePath: string;
  logger?: Logger;
}): void {
  const relaxations: string[] = [];
  const describe = (key: string, value: unknown): string => {
    const previous = previousStartup[key];
    return previous === undefined || previous === value
      ? `${key} = ${JSON.stringify(value)}`
      : `${key} = ${JSON.stringify(value)} (was ${JSON.stringify(previous)})`;
  };

  const mode = startupOverride.mode;
  if (mode === "auto" || mode === "yolo") {
    relaxations.push(describe("mode", mode));
  }
  if (startupOverride.yolo_switcher === true) {
    relaxations.push(describe("yolo_switcher", true));
  }
  if (startupOverride.read_project_dotenv === true) {
    relaxations.push(describe("read_project_dotenv", true));
  }
  if (relaxations.length === 0) {
    return;
  }

  warnWithFallback(
    logger,
    `The deepagents startup override wrote ${relaxations.join(", ")} into ${filePath}, which is ` +
      `your global deepagents-cli config: it relaxes how much dcode does without asking, for ` +
      `every project on this machine, not just this one.`,
  );
}

/**
 * Read `[shell].allow_list` the way dcode does: a TOML array is taken element
 * by element, while a string is split on commas — the one spelling that cannot
 * carry a command name containing a comma.
 */
function readAllowListEntries(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    // Element by element, so one non-string entry does not discard the command
    // names beside it — dcode reads the array the same way.
    return raw
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (typeof raw === "string") {
    return parseCommaSeparatedList(raw);
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
  const askPatterns: string[] = [];
  const denyPatterns: string[] = [];
  let hasForeignDeny = false;
  let requestedAllowAll = false;

  for (const [category, rules] of Object.entries(config.permission)) {
    if (category !== "bash") {
      const hasDeny = Object.values(rules).some((action) => action === "deny");
      if (hasDeny) {
        hasForeignDeny = true;
      }
      if (hasDeny) {
        warnWithFallback(
          logger,
          `deepagents-cli only models shell-command permissions ([shell].allow_list), so ` +
            `'${category}' deny rules cannot be represented and were skipped.`,
        );
      }
      continue;
    }
    for (const [pattern, action] of Object.entries(rules)) {
      if (action === "deny") {
        denyPatterns.push(pattern);
        continue;
      }
      if (action === "ask") {
        askPatterns.push(pattern);
        continue;
      }
      // `*` and `*:*` are the same rule — "every command, any arguments" —
      // spelled the two ways the canonical format allows.
      if (pattern.trim().replace(TRAILING_ARGUMENT_WILDCARD_PATTERN, "") === "*") {
        requestedAllowAll = true;
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

  // `all` does not merely allow everything: it also turns off dcode's
  // dangerous-pattern check, so writing it for a config that *denies*
  // something would hand the user a weaker setup than dcode's own default in
  // the name of a rule meant to restrict it. Deny wins that conflict, and the
  // `*` allow is dropped instead.
  const hasDenyRule = hasForeignDeny || denyPatterns.length > 0;
  const allowAll = requestedAllowAll && !hasDenyRule;
  // Upstream rejects the whole option when `all` shares the list, and every
  // other entry is redundant beside it anyway.
  const allowList = allowAll ? [ALLOW_ALL_SENTINEL] : uniq(allowed.toSorted());

  warnAboutUnwrittenBashRules({
    allowList,
    allowAll,
    requestedAllowAll,
    askPatterns,
    denyPatterns,
    widenedPatterns,
    unmatchablePatterns,
    sentinelPatterns,
    logger,
  });

  return allowList;
}

/**
 * Convert dcode's `[shell].allow_list` back to rulesync config under the
 * `bash` category. An executable name is already a canonical pattern, and it
 * is what the generate direction writes back.
 *
 * Sentinels are recognized case-insensitively because that is how
 * `parse_shell_allow_list_items` reads them (`item.strip().lower()`), so an
 * `ALL` entry really does allow everything.
 *
 * An entry dcode itself cannot match is **not** lifted: it compares an entry to
 * the first token of each pipeline segment with `==`, so `git status` (a space)
 * and `npm-*` (a glob) auto-approve nothing at all. Importing them as allow
 * rules would record permissions the tool is not applying, and the next
 * generate would widen `git status` to every `git` invocation.
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

  const inertEntries: string[] = [];
  for (const entry of allowList) {
    // `recommended` names a curated list dcode owns; expanding it here would
    // freeze a copy that drifts as upstream edits it, so it is left out and
    // the generate direction simply does not write it back.
    if (entry.toLowerCase() === RECOMMENDED_SENTINEL) {
      continue;
    }
    if (/\s/.test(entry) || GLOB_CHARACTERS_PATTERN.test(entry)) {
      inertEntries.push(entry);
      continue;
    }
    bash[entry] = "allow";
  }

  if (inertEntries.length > 0) {
    warnWithFallback(
      undefined,
      `deepagents-cli matches an allow_list entry against the executable name exactly, so ` +
        `${inertEntries.join(", ")} auto-approve nothing and were not imported as allow rules.`,
    );
  }

  return Object.keys(bash).length > 0 ? { permission: { bash } } : { permission: {} };
}

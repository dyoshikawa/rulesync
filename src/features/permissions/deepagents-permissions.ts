import { join } from "node:path";

import { uniq } from "es-toolkit";
import * as smolToml from "smol-toml";

import { DEEPAGENTS_CONFIG_FILE_NAME, DEEPAGENTS_DIR } from "../../constants/deepagents-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import {
  createIntersectionBudget,
  parsedGlobsIntersect,
  parseGlobPattern,
} from "../../utils/glob.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
import { parseCommaSeparatedList } from "../../utils/parse-comma-separated-list.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { isPlainObject } from "../../utils/type-guards.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  collectShellCommandRules,
  warnAboutUnwrittenCommandRules,
} from "./shell-command-categories.js";
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

/** The approval modes dcode reads; anything else is `Invalid` upstream. */
const DEEPAGENTS_STARTUP_MODES = ["manual", "auto", "yolo"] as const;

/**
 * dcode's own record of the last approval mode the user switched to. It is
 * app-managed state, and it is also a second way into `auto`: with no explicit
 * `[startup].mode`, `load_startup_mode` restores `recent` when
 * `is_recent_startup_mode_restorable` allows it. A repository's
 * `.rulesync/permissions.jsonc` must not reach it, so neither direction
 * carries the key — import skips it with `DEEPAGENTS_STARTUP_KEYS`, and
 * generate drops it here.
 */
const STARTUP_RECENT_KEY = "recent";

/**
 * Upstream defaults for the boolean startup knobs. Writing one of these on a
 * machine that has not set it changes nothing, so it is not a relaxation to
 * warn about.
 *
 * @see https://github.com/langchain-ai/deepagents `config_manifest.py`
 */
const DEEPAGENTS_STARTUP_BOOLEAN_DEFAULTS: Record<string, boolean> = {
  yolo_switcher: true,
  read_project_dotenv: true,
};

// Sentinels `parse_shell_allow_list_items` recognizes instead of a command
// name: `all` allows everything (and must be the sole entry), `recommended`
// expands to a curated list dcode owns.
const ALLOW_ALL_SENTINEL = "all";
const RECOMMENDED_SENTINEL = "recommended";

// dcode compares the first token of each pipeline segment against the list
// with `==`, so an entry carrying a glob character never matches anything.
const GLOB_CHARACTERS_PATTERN = /[*?[\]]/;

/**
 * Characters that stop dcode comparing an entry to a command name as written:
 * it splits a command on `&&`, `||`, `|` and `;` before comparing, rejects
 * `$(...)`, backticks, redirects and process substitution outright, and reads
 * the name through `shlex.split`, which takes the quotes and escapes off. An
 * entry holding one of them therefore matches nothing, or matches only by
 * accident of the shell — either way it is not a rule worth writing into a
 * global config.
 */
const SHELL_METACHARACTERS_PATTERN = /[;&|$`()<>'"\\]/;
// The subset `shlex.split` strips rather than refuses — quotes and the
// backslash escape — so a name spelled with them still reaches dcode's
// comparison, as the name without them.
const SHLEX_STRIPPED_PATTERN = /['"\\]/g;
// `NAME_MAX` on every filesystem dcode runs on, and so the longest a command's
// own name can be. A token past it is a path spelled out in full or a mistake,
// neither of which belongs in a list dcode compares executable names against;
// it is refused with a warning rather than trimmed, and it bounds the value
// side of the glob comparison below, which both sides otherwise lack.
const MAX_EXECUTABLE_NAME_LENGTH = 255;
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
 * Only `allow` rules map, and only from the canonical `bash` category — the
 * all-tools `*` category contributes its restricting rules instead, since a rule
 * written there covers shell commands too (see `collectShellCommandRules`):
 *
 * - A pattern is reduced to its executable token, because that is all dcode
 *   matches on — `git *`, `git:*`, `git commit:*` and a bare `git` all become
 *   `git`. Every spelling but the first two *widens* the rule (every `git`
 *   subcommand is then auto-approved, and a bare name that meant "no arguments
 *   at all" covers them all), so those are written with a warning rather than
 *   silently.
 * - `*` becomes the `all` sentinel, which auto-approves every command **and**
 *   skips the dangerous-pattern check. That is a big enough jump to warn about
 *   on its own, and upstream rejects the whole option when `all` shares the
 *   list with anything else, so it is emitted as the sole entry. When the
 *   config also *denies* something, `all` is not written at all: switching the
 *   dangerous-pattern check off in the name of a rule meant to restrict would
 *   leave the user with less than dcode's own default, so deny wins.
 * - A token that still holds a glob (`npm-*`, `*.sh`), a shell metacharacter
 *   (`git;rm`, `$(id)`), a quote (`"git"`) or an escape (`\\git`) after the
 *   reduction — or one longer than a command's own name can be — has no
 *   counterpart and is skipped with a warning: dcode compares the name exactly,
 *   and splits, refuses, or unquotes a command holding one before it compares
 *   anything, so writing one would leave a rule in the user's global config
 *   that never fires.
 * - `ask` rules need no output — a command outside the list already prompts —
 *   but `deny` rules are reported, because dcode cannot express them: the
 *   command is still asked about rather than blocked. An `ask` or `deny` on a
 *   narrower pattern than an `allow` beside it (`npm publish` against `npm *`)
 *   is worse than unenforced — the reduction collides them on `npm` and dcode
 *   keeps the allow — so those are warned about separately. A *broader* ask or
 *   deny is warned about too (`*` beside a `git *` allow): canonically the
 *   stricter rule wins whatever its width, so that one is inverted as surely as
 *   a narrow one.
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
      // Converted anyway, but told that nothing is written: the sentences about
      // what the allowlist *became* — "every command is auto-approved and the
      // dangerous-pattern check is off" among them — would describe a global
      // relaxation that did not happen, while the ones about a deny rule dcode
      // cannot express stay true and are all the user hears here.
      convertRulesyncToDeepagentsAllowList({ config, willWrite: false, logger });
    } else {
      const allowList = convertRulesyncToDeepagentsAllowList({
        config,
        willWrite: true,
        logger,
      });
      const shell = isPlainObject(existingShell) ? { ...existingShell } : {};
      if (allowList.length > 0) {
        shell[ALLOW_LIST_KEY] = allowList;
      } else if (shell[ALLOW_LIST_KEY] !== undefined) {
        // Removing an allowlist only ever asks about more commands, so it fails
        // closed — but it discards a list the user may have curated by hand
        // (`recommended` among it), which is worth saying out loud.
        warnWithFallback(
          logger,
          `deepagents-cli: no bash allow rule is left to auto-approve — none maps to an ` +
            `executable name, or every one of them is covered by a stricter rule — so the ` +
            `existing [${SHELL_TABLE_KEY}].${ALLOW_LIST_KEY} in ${filePath} was removed and ` +
            `those commands will be asked about again.`,
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
      mergeStartupOverride({ settings, startupOverride, filePath, logger });
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
    const selfPath = join(this.getRelativeDirPath(), this.getRelativeFilePath());
    let settings: Record<string, unknown>;
    try {
      settings = smolToml.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse deepagents permissions content in ${selfPath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    // `isPlainObject`, not `isRecord`: smol-toml returns a datetime as a
    // `Date` subclass, which is a record but not a table to merge into.
    const shell = isPlainObject(settings[SHELL_TABLE_KEY]) ? settings[SHELL_TABLE_KEY] : {};
    const allowList = readAllowListEntries(shell[ALLOW_LIST_KEY]);
    if (allowList === null) {
      warnWithFallback(
        undefined,
        `deepagents-cli ignores '${ALLOW_LIST_KEY}' entirely unless it is a string or an array ` +
          `of strings, so nothing in ${selfPath} is auto-approved and no bash allow rules were ` +
          `imported.`,
      );
    }
    const config = convertDeepagentsToRulesyncPermissions({ allowList: allowList ?? [] });

    const startup = isPlainObject(settings[STARTUP_TABLE_KEY]) ? settings[STARTUP_TABLE_KEY] : {};
    const startupOverride = liftStartupOverride({ startup, selfPath });

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
 * Split the restricting rules by what the generated allowlist does to them, and
 * name the entries that have to go.
 *
 * An allowlist entry auto-approves its executable however it is invoked, so an
 * `ask` or `deny` on any command that entry would run — a narrower pattern
 * (`npm publish`) beside an allowed `npm *`, or one naming no executable at all
 * (`*delete*` beside an allowed `kubectl`) — collides with it. dcode has no
 * denylist, so the collision cannot be settled there: keeping the allow would
 * auto-approve the very command the author wanted stopped. The colliding
 * entries are therefore withheld — canonically the stricter rule wins whatever
 * its width — which leaves those executables prompting, which is what an `ask`
 * asks for and the closest dcode can come to a `deny`.
 */
function partitionRestrictingRules({
  allowList,
  askPatterns,
  denyPatterns,
  willWrite,
}: {
  allowList: readonly string[];
  askPatterns: readonly string[];
  denyPatterns: readonly string[];
  willWrite: boolean;
}): {
  shadowedAsk: string[];
  shadowedDeny: string[];
  unenforcedDeny: string[];
  withheldTokens: Set<string>;
  intersectionBudgetExhausted: boolean;
} {
  // An entry auto-approves its executable *however it is invoked*: `kubectl` in
  // the list runs `kubectl delete pod` without a prompt, since dcode holds no
  // arguments to narrow the name by. What one entry approves is therefore the
  // two patterns `token` and `token *`, and a restriction collides with it when
  // it can match either. Comparing the restriction's own first token instead
  // would miss `*delete*` — a pattern naming no executable that nevertheless
  // matches half of what an allowed `kubectl` runs unasked.
  const approved = allowList.map((token) => ({
    token,
    globs: [parseGlobPattern(token), parseGlobPattern(`${token} *`)],
  }));
  // Every restriction is matched against every allowed name, so the work is
  // restrictions times entries — a product neither side's length bounds. One
  // budget is spent down across the run and, once it is gone, a pattern is
  // taken to collide with the whole list: withholding every entry restricts
  // rather than auto-approving one the config asks about.
  const budget = createIntersectionBudget();
  const collidingTokens = (pattern: string): string[] => {
    // Nothing was written, so nothing collides with anything: every deny is
    // merely unenforced, which is what the caller's sentence already says.
    if (!willWrite) return [];
    if (budget.remaining === 0) {
      // Out of budget every pair answers "collides", and saying so without
      // walking the list once more matters: asking anyway is the restrictions
      // times entries enumeration the budget exists to stop.
      return [...allowList];
    }
    // dcode reads the name through `shlex.split`, which takes the quotes and
    // escapes off, so `"git" *`, `\\git *` and `"npm*" publish` all collide with
    // the allow they would collide with spelled plainly. Stripping can also turn
    // `\\*` into the glob `*`, which reports a collision dcode would not make —
    // an odd spelling over-warning is the safe direction here. A trailing `:*`
    // is the canonical spelling of "any arguments"; widening it to `*` keeps
    // `git:*` colliding with what an allowed `git` approves.
    const restriction = parseGlobPattern(
      pattern
        .trim()
        .replace(TRAILING_ARGUMENT_WILDCARD_PATTERN, "*")
        .replaceAll(SHLEX_STRIPPED_PATTERN, ""),
    );
    // Walked rather than translated to a regex: both sides come from a file a
    // repository can carry, and `*a*a*a*a*b` as `^.*a.*a.*a.*a.*b$` costs
    // minutes against a long enough name. Each side is parsed once for the whole
    // run, so a pattern's length is paid once rather than per pair.
    return approved
      .filter(({ globs }) => globs.some((glob) => parsedGlobsIntersect(restriction, glob, budget)))
      .map(({ token }) => token);
  };

  const withheldTokens = new Set<string>();
  const collect = (pattern: string): boolean => {
    const tokens = collidingTokens(pattern);
    for (const token of tokens) {
      withheldTokens.add(token);
    }
    return tokens.length > 0;
  };

  // Canonically the stricter rule wins whatever its width — rulesync collapses
  // colliding rules as `deny > ask > allow` everywhere, and Claude Code applies
  // deny first, then ask, then allow — so a *broad* ask beside a narrow allow
  // (`*` ask, `git *` allow) is inverted by the reduction just as a narrow one
  // is: the author asked to be prompted for `git` and dcode auto-approves it.
  // A pattern written under both `bash` and the all-tools `*` category arrives
  // twice, and reporting it twice would say two rules were skipped where the
  // author wrote one.
  const shadowedAsk = uniq(askPatterns).filter(collect);
  const shadowedDeny: string[] = [];
  const unenforcedDeny: string[] = [];
  for (const pattern of uniq(denyPatterns)) {
    // Partitioned in one pass: asking twice would parse and walk the same
    // pattern twice, and spend the budget twice over for it.
    (collect(pattern) ? shadowedDeny : unenforcedDeny).push(pattern);
  }

  return {
    shadowedAsk,
    shadowedDeny,
    unenforcedDeny,
    withheldTokens,
    // Once the budget is gone every pattern is taken to collide with the whole
    // list, so `shadowedDeny` and `shadowedAsk` no longer say a comparison was
    // made — the caller has to say a limit was reached instead.
    intersectionBudgetExhausted: budget.remaining === 0,
  };
}

/**
 * Say what the reduction to executable names could not write. Split out from
 * `convertRulesyncToDeepagentsAllowList` because the rules it reports on
 * outnumber the ones it writes: every category dcode cannot express is a
 * sentence here.
 */
function warnAboutUnwrittenBashRules({
  allowAll,
  requestedAllowAll,
  askPatterns,
  denyPatterns,
  foreignRestrictingCategories,
  shadowedAsk,
  shadowedDeny,
  unenforcedDeny,
  intersectionBudgetExhausted,
  widenedPatterns,
  unmatchablePatterns,
  sentinelPatterns,
  willWrite,
  logger,
}: {
  allowAll: boolean;
  requestedAllowAll: boolean;
  askPatterns: string[];
  denyPatterns: string[];
  /** Categories other than `bash` and `*` that carry a `deny` or an `ask`. */
  foreignRestrictingCategories: string[];
  /** The `ask` rules whose executables were dropped from the allowlist. */
  shadowedAsk: string[];
  /** The `deny` rules whose executables were dropped from the allowlist. */
  shadowedDeny: string[];
  /**
   * Whether the run hit the limit on comparison work. Past it every restriction
   * is taken to cover the whole allowlist without being compared to it, so the
   * sentences below say what was withheld rather than what was covered.
   */
  intersectionBudgetExhausted: boolean;
  /** The `deny` rules with no allow entry to withhold, so nothing enforces them. */
  unenforcedDeny: string[];
  widenedPatterns: string[];
  unmatchablePatterns: string[];
  sentinelPatterns: string[];
  /**
   * Whether the caller is going to write the allowlist it asked for. When it is
   * not — a `[shell]` that is not a table cannot be merged into — the sentences
   * describing what the list auto-approves would describe a relaxation that did
   * not happen, while the ones saying a deny rule has no counterpart at all
   * stay true and are the only warning the user gets.
   */
  willWrite: boolean;
  logger?: Logger;
}): void {
  if (unenforcedDeny.length > 0) {
    warnWithFallback(
      logger,
      `deepagents-cli has no command denylist — a command it does not auto-approve is asked ` +
        `about, not blocked — so ${unenforcedDeny.length} command deny rule(s) from ` +
        `.rulesync/permissions.jsonc were skipped and those commands remain runnable on ` +
        `approval.`,
    );
  }
  if (shadowedDeny.length > 0) {
    warnWithFallback(
      logger,
      intersectionBudgetExhausted
        ? `deepagents-cli withheld the allow_list entries beside the deny rule(s) ` +
            `${shadowedDeny.join(", ")} without comparing them, the comparison limit above ` +
            `having been reached. Those executables are asked about instead.`
        : `deepagents-cli matches only the executable name, so the allow rule(s) covered by ` +
            `the deny rule(s) ${shadowedDeny.join(", ")} were withheld from allow_list — ` +
            `keeping them would auto-approve the very commands those rules deny. Those ` +
            `executables are asked about instead; narrow the deny rule if you meant them ` +
            `auto-approved.`,
    );
  }
  if (shadowedAsk.length > 0) {
    warnWithFallback(
      logger,
      intersectionBudgetExhausted
        ? `deepagents-cli withheld the allow_list entries beside the ask rule(s) ` +
            `${shadowedAsk.join(", ")} without comparing them, the comparison limit above ` +
            `having been reached. Those executables are asked about instead.`
        : `deepagents-cli matches only the executable name, so the allow rule(s) covered by ` +
            `the ask rule(s) ${shadowedAsk.join(", ")} were withheld from allow_list — keeping ` +
            `them would run those commands without the prompt the ask rule asks for. Narrow ` +
            `the ask rule if you meant them auto-approved.`,
    );
  }
  if (willWrite && widenedPatterns.length > 0) {
    warnWithFallback(
      logger,
      `deepagents-cli matches only the executable name of a command, so ` +
        `${widenedPatterns.join(", ")} were widened to their first token — every invocation of ` +
        `those executables is now auto-approved, not just the listed arguments.`,
    );
  }
  if (willWrite && unmatchablePatterns.length > 0) {
    warnWithFallback(
      logger,
      `deepagents-cli compares an allow_list entry to the executable name exactly, so a glob ` +
        `in that name matches nothing, a name longer than ${MAX_EXECUTABLE_NAME_LENGTH} ` +
        `characters is longer than a command's own name can be, and a name holding a shell ` +
        `metacharacter, a quote or an escape is ` +
        `one dcode splits on, refuses outright, or reads differently than it is written — the ` +
        `pattern(s) ${unmatchablePatterns.join(", ")} were therefore skipped rather than ` +
        `written as a rule that cannot be relied on to fire.`,
    );
  }
  if (willWrite && sentinelPatterns.length > 0) {
    warnWithFallback(
      logger,
      `deepagents-cli reads 'all' and 'recommended' in allow_list as sentinels rather than ` +
        `command names, so ${sentinelPatterns.join(", ")} were skipped. Use the '*' pattern to ` +
        `allow every command.`,
    );
  }
  if (willWrite && requestedAllowAll && !allowAll) {
    // A deny rule for another tool (`Read(...)`, `WebFetch(...)`) blocks the
    // sentinel just as a bash one does, and so does an `ask`: 'all' turns
    // dcode's dangerous-pattern check off wholesale and approves every command
    // unseen, so any restriction in the config makes it too broad.
    let restrictionReason = `your config restricts other tools`;
    if (denyPatterns.length > 0) {
      restrictionReason = `your config denies commands`;
    } else if (askPatterns.length > 0) {
      restrictionReason = `your config asks before running commands`;
    } else if (foreignRestrictingCategories.length > 0) {
      restrictionReason = `your config restricts '${foreignRestrictingCategories.join("', '")}'`;
    }
    warnWithFallback(
      logger,
      `The bash '*' allow rule was not written as allow_list = ["all"] for deepagents-cli, ` +
        `because 'all' also turns off its dangerous-pattern check (command substitution, ` +
        `redirects, process substitution) and ${restrictionReason} — the two together would be ` +
        `weaker than dcode's own default. List the executables you want auto-approved instead.`,
    );
  }
  if (willWrite && allowAll) {
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
 * Lift the `[startup]` keys rulesync models back into the `deepagents`
 * override, keeping only values dcode itself accepts.
 *
 * A `mode` outside the three approval modes, or a non-boolean where a switch
 * belongs, is `Invalid` upstream — dcode ignores it and falls back to its
 * default. Importing it anyway would record a setting the tool is not applying
 * and, because the canonical schema is stricter than TOML, would write a
 * `.rulesync/permissions.jsonc` the next `rulesync generate` cannot even read.
 */
function liftStartupOverride({
  startup,
  selfPath,
}: {
  startup: Record<string, unknown>;
  selfPath: string;
}): Record<string, unknown> {
  const startupOverride: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const key of DEEPAGENTS_STARTUP_KEYS) {
    const value = startup[key];
    if (value === undefined) continue;
    const acceptable =
      key === "mode"
        ? DEEPAGENTS_STARTUP_MODES.includes(value as (typeof DEEPAGENTS_STARTUP_MODES)[number])
        : typeof value === "boolean";
    if (acceptable) {
      startupOverride[key] = value;
    } else {
      rejected.push(`${key} = ${JSON.stringify(value)}`);
    }
  }

  if (rejected.length > 0) {
    warnWithFallback(
      undefined,
      `deepagents-cli falls back to its own default for a '[${STARTUP_TABLE_KEY}]' value it ` +
        `cannot read, so ${rejected.join(", ")} in ${selfPath} ${rejected.length === 1 ? "was" : "were"} ` +
        `not imported.`,
    );
  }

  return startupOverride;
}

/**
 * Merge the `deepagents.startup` override into `[startup]`, preserving every
 * other key of that table. A `startup` that is not a table at all is something
 * rulesync did not write and cannot merge into, so it is left exactly as the
 * user has it rather than replaced.
 */
function mergeStartupOverride({
  settings,
  startupOverride,
  filePath,
  logger,
}: {
  settings: Record<string, unknown>;
  startupOverride: Record<string, unknown>;
  filePath: string;
  logger?: Logger;
}): void {
  const existingStartup = settings[STARTUP_TABLE_KEY];
  if (existingStartup !== undefined && !isPlainObject(existingStartup)) {
    warnWithFallback(
      logger,
      `deepagents-cli: '${STARTUP_TABLE_KEY}' in ${filePath} is not a table, so the ` +
        `deepagents startup override was skipped rather than overwriting it.`,
    );
    return;
  }

  const startup = isPlainObject(existingStartup) ? { ...existingStartup } : {};
  const previousStartup = { ...startup };
  const writtenKeys: string[] = [];
  // Copied key by key rather than `Object.assign`ed, so a `__proto__` coming
  // from the JSON config cannot reach the object's prototype.
  for (const [key, value] of Object.entries(startupOverride)) {
    if (isPrototypePollutionKey(key)) continue;
    if (key === STARTUP_RECENT_KEY) continue;
    // TOML has no null, so smol-toml drops such a key on the way out. Writing
    // it would leave a warning naming a setting the file does not hold.
    if (value === null || value === undefined) continue;
    // Verbatim, so a key added upstream passes through the loose override.
    startup[key] = value;
    writtenKeys.push(key);
  }
  warnAboutStartupRelaxations({ startupOverride, previousStartup, writtenKeys, filePath, logger });
  // An override of nothing but dropped keys leaves no table to write; an empty
  // `[startup]` header would suggest rulesync set something there.
  if (Object.keys(startup).length > 0) {
    settings[STARTUP_TABLE_KEY] = startup;
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
  writtenKeys,
  filePath,
  logger,
}: {
  startupOverride: Record<string, unknown>;
  previousStartup: Record<string, unknown>;
  /** The keys the merge actually wrote, so no warning names one it dropped. */
  writtenKeys: readonly string[];
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
  for (const [key, upstreamDefault] of Object.entries(DEEPAGENTS_STARTUP_BOOLEAN_DEFAULTS)) {
    // Both default to `true` upstream, so writing `true` over a key the user
    // never set is a no-op. Reporting it would bury the case that grants
    // something — a value the user had turned off being turned back on.
    if (startupOverride[key] !== true) continue;
    if ((previousStartup[key] ?? upstreamDefault) === true) continue;
    relaxations.push(describe(key, true));
  }

  if (relaxations.length > 0) {
    warnWithFallback(
      logger,
      `The deepagents startup override wrote ${relaxations.join(", ")} into ${filePath}, which ` +
        `is your global deepagents-cli config: it relaxes how much dcode does without asking, ` +
        `for every project on this machine, not just this one.`,
    );
  }

  if (startupOverride[STARTUP_RECENT_KEY] !== undefined) {
    warnWithFallback(
      logger,
      `The deepagents startup override's '${STARTUP_RECENT_KEY}' was not written to ${filePath}: ` +
        `dcode manages that key itself, and with no explicit 'mode' beside it, it is what ` +
        `restores auto-approval at launch. Set 'mode' if switching approval modes is the intent.`,
    );
  }

  const known = new Set<string>(DEEPAGENTS_STARTUP_KEYS);
  const unknownKeys = writtenKeys.filter((key) => !known.has(key));
  if (unknownKeys.length > 0) {
    // The override is a loose object so a key added upstream still reaches the
    // config, but this one writes into the machine's global file: what rulesync
    // cannot judge, it at least names.
    warnWithFallback(
      logger,
      `The deepagents startup override wrote ${unknownKeys.join(", ")} into ${filePath} ` +
        `unchecked — rulesync does not know what those keys grant, and that file is your ` +
        `global deepagents-cli config.`,
    );
  }
}

/**
 * Read `[shell].allow_list` the way dcode does: a TOML array is taken element
 * by element, while a string is split on commas — the one spelling that cannot
 * carry a command name containing a comma.
 *
 * Returns `null` for anything dcode drops the option over — an array holding a
 * non-string element, or a value that is neither an array nor a string.
 * dcode's provider
 * requires `all(isinstance(item, str) for item in raw)` and otherwise reports
 * `Ignoring allow_list=...`, dropping the **whole** option — so keeping the
 * names beside the offending element would record permissions dcode is not
 * applying, and the next generate would hand them to every other tool.
 */
function readAllowListEntries(raw: unknown): string[] | null {
  if (Array.isArray(raw)) {
    if (raw.some((entry) => typeof entry !== "string")) {
      return null;
    }
    return raw.map((entry) => (entry as string).trim()).filter((entry) => entry.length > 0);
  }
  if (typeof raw === "string") {
    return parseCommaSeparatedList(raw);
  }
  // A scalar is neither of the two spellings dcode accepts, so it too drops the
  // whole option. Only an absent key is genuinely "no allowlist".
  return raw === undefined ? [] : null;
}

/**
 * The token dcode would compare, before it is checked for anything
 * that stops dcode comparing it at all. `git:*` and `git *` both lead with `git`.
 */
function leadingToken(pattern: string): string {
  const [first = ""] = pattern.trim().split(/\s+/);
  return first.replace(TRAILING_ARGUMENT_WILDCARD_PATTERN, "");
}

/**
 * Whether a canonical `bash` pattern leaves the arguments open — the spellings
 * that mean "this executable, however it is invoked": `git *`, `git:*`, and a
 * glob executable such as `npm*`, which matches the rest of the command line on
 * its own.
 *
 * Anything else names arguments, which dcode has nowhere to put, so reducing an
 * `allow` to its executable widens it — which is what the caller warns about.
 */
function meansAnyArguments(pattern: string): boolean {
  const [first = "", ...rest] = pattern.trim().split(/\s+/);
  const remainder = rest.join(" ");
  if (remainder === "*") {
    return true;
  }
  return remainder.length === 0 && first.endsWith("*");
}

/**
 * Reduce a canonical `bash` pattern to the executable token dcode matches on,
 * or `null` when nothing usable is left.
 */
function toExecutableToken(pattern: string): { token: string; widened: boolean } | null {
  const trimmed = pattern.trim();
  const token = leadingToken(trimmed);
  if (
    token.length === 0 ||
    token.length > MAX_EXECUTABLE_NAME_LENGTH ||
    GLOB_CHARACTERS_PATTERN.test(token) ||
    SHELL_METACHARACTERS_PATTERN.test(token)
  ) {
    // A metacharacter is as unmatchable as a glob: dcode splits the command on
    // it, or rejects it as a dangerous pattern, before comparing any name. A
    // name no filesystem can hold is unmatchable for the same reason. The
    // import direction already drops such an entry, and writing one would put
    // a rule in the user's global config that can never fire.
    return null;
  }
  // dcode holds an executable name and nothing else, so every canonical rule
  // here is widened to every invocation of that executable — the arguments in
  // `git commit:*` are dropped, and the bare `rm` that meant "with no
  // arguments at all" now covers `rm -rf /` too.
  return { token, widened: !meansAnyArguments(trimmed) };
}

/**
 * Convert rulesync permissions config to dcode's `[shell].allow_list`. Only
 * `allow` rules map — from the `bash` category, and never from the all-tools
 * `*` one, whose restricting rules still count against them (see
 * `collectShellCommandRules`). Everything else is skipped, with a warning
 * wherever the skip loses a restriction rather than a redundancy.
 */
function convertRulesyncToDeepagentsAllowList({
  config,
  willWrite,
  logger,
}: {
  config: PermissionsConfig;
  /** See `warnAboutUnwrittenBashRules`; the reporting depends on it. */
  willWrite: boolean;
  logger?: Logger;
}): string[] {
  const allowed: string[] = [];
  const widened: { pattern: string; token: string }[] = [];
  const unmatchablePatterns: string[] = [];
  const sentinelPatterns: string[] = [];
  const askPatterns: string[] = [];
  const denyPatterns: string[] = [];
  let requestedAllowAll = false;

  const { rules, foreignRestrictingCategories, ignoredAllToolsAllowPatterns } =
    collectShellCommandRules(config.permission);
  for (const { pattern, action } of rules) {
    if (action === "deny") {
      denyPatterns.push(pattern);
      continue;
    }
    if (action === "ask") {
      askPatterns.push(pattern);
      continue;
    }
    // `*`, `*:*` and `* *` are the same rule — "every command, any
    // arguments" — spelled the three ways the canonical format allows.
    if (leadingToken(pattern) === "*" && meansAnyArguments(pattern)) {
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
      widened.push({ pattern, token: reduced.token });
    }
    allowed.push(reduced.token);
  }

  // `all` does not merely allow everything: it also turns off dcode's
  // dangerous-pattern check, so writing it for a config that restricts
  // something would hand the user a weaker setup than dcode's own default in
  // the name of a rule meant to restrict it. The stricter rule wins that
  // conflict — an `ask` as much as a `deny`, since neither wants a command
  // approved unseen — and the `*` allow is dropped instead.
  const hasRestriction =
    foreignRestrictingCategories.length > 0 || denyPatterns.length > 0 || askPatterns.length > 0;
  const allowAll = requestedAllowAll && !hasRestriction;
  const candidates = uniq(allowed.toSorted());
  const { shadowedAsk, shadowedDeny, unenforcedDeny, withheldTokens, intersectionBudgetExhausted } =
    partitionRestrictingRules({
      allowList: candidates,
      askPatterns,
      denyPatterns,
      willWrite,
    });
  // Upstream rejects the whole option when `all` shares the list, and every
  // other entry is redundant beside it anyway.
  const allowList = allowAll
    ? [ALLOW_ALL_SENTINEL]
    : candidates.filter((token) => !withheldTokens.has(token));

  // Shared with the other command-only adapters so a rule dropped in one is
  // worded the same way in all. `shadowedAllowPatterns` is empty here because
  // dcode reduces every pattern to an executable name, so the allow entries a
  // restriction withholds are reported alongside the rule that withheld them —
  // see `warnAboutUnwrittenBashRules`.
  warnAboutUnwrittenCommandRules({
    toolLabel: "deepagents-cli",
    surfaceLabel: "[shell].allow_list",
    foreignRestrictingCategories,
    shadowedAllowPatterns: [],
    ignoredAllToolsAllowPatterns,
    intersectionBudgetExhausted,
    logger,
  });

  warnAboutUnwrittenBashRules({
    allowAll,
    requestedAllowAll,
    askPatterns,
    denyPatterns,
    foreignRestrictingCategories,
    shadowedAsk,
    shadowedDeny,
    unenforcedDeny,
    intersectionBudgetExhausted,
    // A widened pattern that was then withheld auto-approves nothing, so it is
    // reported by the rule that withheld it rather than as a widening.
    widenedPatterns: uniq(
      widened.filter(({ token }) => !withheldTokens.has(token)).map(({ pattern }) => pattern),
    ),
    unmatchablePatterns,
    sentinelPatterns,
    willWrite,
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
    warnWithFallback(
      undefined,
      `deepagents-cli refuses an allow_list that mixes 'all' with command names and ignores the ` +
        `whole option, so none of ${allowList.join(", ")} is auto-approved and none was ` +
        `imported. Drop 'all' to keep the names, or leave it alone to allow everything.`,
    );
    return { permission: {} };
  }

  const inertEntries: string[] = [];
  const droppedSentinels: string[] = [];
  for (const entry of allowList) {
    // `recommended` names a curated list dcode owns; expanding it here would
    // freeze a copy that drifts as upstream edits it, so it is left out and
    // the generate direction simply does not write it back.
    if (entry.toLowerCase() === RECOMMENDED_SENTINEL) {
      droppedSentinels.push(entry);
      continue;
    }
    if (
      /\s/.test(entry) ||
      entry.length > MAX_EXECUTABLE_NAME_LENGTH ||
      GLOB_CHARACTERS_PATTERN.test(entry) ||
      SHELL_METACHARACTERS_PATTERN.test(entry)
    ) {
      inertEntries.push(entry);
      continue;
    }
    bash[entry] = "allow";
  }

  if (droppedSentinels.length > 0) {
    warnWithFallback(
      undefined,
      `deepagents-cli expands '${droppedSentinels.join(", ")}' from a curated list it owns and ` +
        `edits, so it was not imported as command names. The next generate therefore drops those ` +
        `commands from allow_list — re-add by name the ones you want kept.`,
    );
  }
  if (inertEntries.length > 0) {
    warnWithFallback(
      undefined,
      `deepagents-cli matches an allow_list entry against the executable name exactly, after ` +
        `splitting the command and taking its quotes and escapes off, and a command's own name ` +
        `is at most ${MAX_EXECUTABLE_NAME_LENGTH} characters, so ${inertEntries.join(", ")} ` +
        `auto-approve nothing and were not imported as allow rules.`,
    );
  }

  return Object.keys(bash).length > 0 ? { permission: { bash } } : { permission: {} };
}

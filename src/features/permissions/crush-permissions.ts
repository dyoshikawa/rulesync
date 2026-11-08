import { join } from "node:path";

import {
  CRUSH_ALLOWED_TOOLS_KEY,
  CRUSH_BLOCKED_COMMANDS_KEY,
  CRUSH_DISABLED_TOOLS_KEY,
  CRUSH_OPTIONS_KEY,
  CRUSH_PERMISSIONS_KEY,
  CRUSH_SAFE_COMMANDS_KEY,
} from "../../constants/crush-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import type { Logger } from "../../utils/logger.js";
import { invertRecord, lookupOwn } from "../../utils/own-lookup.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isRecord, isStringArray, toRecord } from "../../utils/type-guards.js";
import {
  crushConfigImportContent,
  getCrushConfigSettablePaths,
  parseCrushConfig,
  resolveCrushConfigFile,
  warnCrushTwinLeftovers,
} from "../crush-config.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ALL_TOOLS_PERMISSION_CATEGORY,
  CATCH_ALL_PATTERN,
  collectShellCommandRules,
  createShadowingRestrictionsTest,
  honorAllToolsOnBash,
  MCP_CATEGORY_PREFIX,
  SHELL_PERMISSION_CATEGORY,
} from "./shell-command-categories.js";
import {
  ToolPermissions,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/**
 * A run of `*` (`**`, `***`) is the catch-all spelled another way: Crush has no
 * argument patterns at all, so it is the only pattern a rule can carry and
 * still be written.
 */
function normalizeCatchAllPattern(pattern: string): string {
  return /^\*+$/.test(pattern) ? CATCH_ALL_PATTERN : pattern;
}

// rulesync canonical categories -> Crush's built-in tool names. Any other
// category passes through verbatim, so a further built-in (`ls`, `multiedit`,
// `sourcegraph`, ...) can be named directly.
// https://github.com/charmbracelet/crush/blob/main/internal/config/config.go
const CANONICAL_TO_CRUSH_TOOL_NAMES: Record<string, string> = {
  bash: "bash",
  read: "view",
  edit: "edit",
  write: "write",
  grep: "grep",
  glob: "glob",
  webfetch: "fetch",
};

const CRUSH_TO_CANONICAL_TOOL_NAMES: Record<string, string> = invertRecord(
  CANONICAL_TO_CRUSH_TOOL_NAMES,
);

// The name Crush registers an MCP tool under (`mcp_<server>_<tool>`) for the
// canonical per-tool MCP category (`mcp__<server>__<tool>`).
const MCP_CRUSH_PREFIX = "mcp_";

// Own-property lookups only: a `constructor` category would otherwise resolve
// to the `Object` function through the prototype chain.
function toCrushToolName(canonical: string): string {
  const crushName = lookupOwn({ record: CANONICAL_TO_CRUSH_TOOL_NAMES, key: canonical });
  if (crushName !== undefined) {
    return crushName;
  }
  if (canonical.startsWith(MCP_CATEGORY_PREFIX) && canonical.length > MCP_CATEGORY_PREFIX.length) {
    // `mcp__server__tool` -> `mcp_server_tool`, the name Crush's permission
    // service sees for that MCP tool.
    return `${MCP_CRUSH_PREFIX}${canonical.slice(MCP_CATEGORY_PREFIX.length).replaceAll("__", "_")}`;
  }
  return canonical;
}

// A Crush tool name maps back to the canonical category of the same built-in;
// anything else (including `mcp_<server>_<tool>`, whose server/tool split is
// ambiguous once the double underscore is gone) is kept verbatim, which
// regenerates unchanged.
function toCanonicalToolName(crushName: string): string {
  return lookupOwn({ record: CRUSH_TO_CANONICAL_TOOL_NAMES, key: crushName }) ?? crushName;
}

function isMcpToolName(crushName: string): boolean {
  return crushName.startsWith(MCP_CRUSH_PREFIX) && crushName.length > MCP_CRUSH_PREFIX.length;
}

type CrushToolLists = {
  allowed: string[];
  disabled: string[];
};

type CrushCommandLists = {
  safe: string[];
  blocked: string[];
};

// Crush resolves these wrappers before matching a command line
// (`nice -n 5 go build` runs as `go build`), and judges the `time` keyword by
// what it wraps, so a `safe_commands` entry also approves the command behind
// any of them, and an entry naming one stands for the command it wraps.
// @see https://github.com/charmbracelet/crush/blob/v0.100.0/internal/shell/wrappers.go
const CRUSH_COMMAND_WRAPPERS: ReadonlySet<string> = new Set(["env", "nohup", "nice", "timeout"]);
const CRUSH_COMMAND_PREFIXES = [...CRUSH_COMMAND_WRAPPERS, "time"];

// A command name already in the form Crush normalizes to (lower case, no
// directory, no `.exe`/`.bat`/`.cmd` suffix), and an argument with no glob,
// quoting, expansion or other shell syntax, so a pattern made of them names
// exactly one argv both in rulesync's glob reading and in Crush's literal one.
const CRUSH_COMMAND_NAME = /^[a-z0-9_][a-z0-9_.+-]*$/;
const CRUSH_COMMAND_ARGUMENT = /^[A-Za-z0-9_@%+=:,./-]+$/;
const CRUSH_COMMAND_NAME_SUFFIXES = [".exe", ".bat", ".cmd"];

function isCrushCommandName(name: string): boolean {
  return (
    CRUSH_COMMAND_NAME.test(name) &&
    !CRUSH_COMMAND_NAME_SUFFIXES.some((suffix) => name.endsWith(suffix)) &&
    !isPrototypePollutionKey(name)
  );
}

/**
 * Reduce a command name the way Crush matches it (`shell.NormalizeCommandName`):
 * trimmed, without its directory, lower-cased, and without a Windows
 * executable suffix.
 */
function normalizeCrushCommandName(raw: string): string {
  const base = (raw.trim().split(/[\\/]/).at(-1) ?? "").toLowerCase();
  const suffix = CRUSH_COMMAND_NAME_SUFFIXES.find(
    (candidate) => base.length > candidate.length && base.endsWith(candidate),
  );
  return suffix === undefined ? base : base.slice(0, -suffix.length);
}

/**
 * Whether a canonical pattern is a literal command line that a Crush
 * `safe_commands` entry reproduces exactly: Crush matches an entry only when
 * the command is written with exactly those tokens, no extra arguments and no
 * flags, which is what a wildcard-free glob means. A leading wrapper is
 * refused, since Crush would resolve it away and approve the bare command.
 */
function isExactCrushCommandLine(pattern: string): boolean {
  const [name, ...args] = pattern.split(" ");
  return (
    name !== undefined &&
    isCrushCommandName(name) &&
    !CRUSH_COMMAND_WRAPPERS.has(name) &&
    args.every((arg) => CRUSH_COMMAND_ARGUMENT.test(arg))
  );
}

/**
 * The command name a canonical `<name>` / `<name> *` pattern names as a
 * whole, i.e. the `blocked_commands` entry for it, or undefined.
 */
function wholeCommandName(pattern: string): string | undefined {
  const name = pattern.endsWith(" *") ? pattern.slice(0, -2) : pattern;
  return isCrushCommandName(name) ? name : undefined;
}

/**
 * The line a Crush `safe_commands` entry effectively stands for, in canonical
 * form (whitespace collapsed, command name normalized), or undefined when the
 * entry has no exact canonical spelling (wildcards, quoting, a wrapper, ...).
 */
function effectiveSafeCommandLine(entry: string): string | undefined {
  const [name, ...args] = entry.trim().split(/\s+/);
  if (name === undefined || name === "") return undefined;
  const line = [normalizeCrushCommandName(name), ...args].join(" ");
  return isExactCrushCommandLine(line) ? line : undefined;
}

/**
 * A restriction pattern with its command word reduced the way Crush reduces a
 * wrapper's name before peeling it (`shell.NormalizeCommandName`): any
 * directory dropped (`./nice`, `bin\env.exe`, `/usr/bin/env`), lower-cased,
 * and without a Windows executable suffix. A `*` in the command word may
 * stand for a directory, so when what follows it names a wrapper, everything
 * before it collapses into `*` (`b*nice` -> `*nice`; `rm*` is left alone). The rest of the pattern is lower-cased as well, for a
 * nested wrapper spelled in another case. Used only to compare against the
 * wrapper spellings of a safe line, where it can only withhold more.
 */
function normalizeRestrictionCommandWord(pattern: string): string {
  const space = pattern.indexOf(" ");
  let head = space < 0 ? pattern : pattern.slice(0, space);
  const rest = space < 0 ? "" : pattern.slice(space);
  head = normalizeCrushCommandName(head);
  const star = head.lastIndexOf("*");
  if (star > 0 && CRUSH_COMMAND_PREFIXES.includes(head.slice(star + 1))) {
    head = `*${head.slice(star + 1)}`;
  }
  return `${head}${rest.toLowerCase()}`;
}

/**
 * Build the test for a `safe_commands` line: which canonical `deny`/`ask`
 * rules govern a command Crush would approve through it? Besides the line
 * itself, Crush approves it followed by `--` and behind a wrapper (or the
 * `time` keyword), whose name it normalizes (`./nice`, `/usr/bin/env`, `NICE`,
 * `nohup.exe`). The line and its wrapper spellings are compared against the
 * restrictions as written, and the wrapper spellings also against the
 * restrictions with their command word normalized the same way — which keeps
 * an unrelated `rm *` from withholding the line, as a leading wildcard on the
 * spelling would. Canonically the stricter rule wins whatever its width
 * (`deny > ask > allow`), so any overlap withholds the line.
 *
 * Crush also approves a line composed with other safe lines (`&&`, `||`, `|`,
 * `;`, a parenthesized group); those compositions are not compared, the way
 * other tools' per-subcommand matching treats an allowed command.
 */
function createSafeCommandShadowTest(
  permission: PermissionsConfig["permission"],
): (line: string) => string[] {
  const restrictions = collectShellCommandRules(permission).rules.filter(
    ({ action }) => action !== "allow",
  );
  const test = createShadowingRestrictionsTest(restrictions);
  const normalized = restrictions.map((rule) => ({
    ...rule,
    pattern: normalizeRestrictionCommandWord(rule.pattern),
  }));
  const testNormalized = createShadowingRestrictionsTest(normalized);
  const originalOf = new Map<string, string>();
  normalized.forEach((rule, index) => {
    const original = restrictions[index]?.pattern;
    if (original !== undefined && !originalOf.has(rule.pattern)) {
      originalOf.set(rule.pattern, original);
    }
  });
  const withSeparator = (spellings: string[]) =>
    spellings.flatMap((spelling) => [spelling, `${spelling} --*`]);
  const wrapped = (base: string) => CRUSH_COMMAND_PREFIXES.map((prefix) => `${prefix}*${base}`);
  return (line) =>
    uniq([
      ...withSeparator([line, ...wrapped(line)]).flatMap((spelling) => test(spelling)),
      ...withSeparator(wrapped(line.toLowerCase())).flatMap((spelling) =>
        testNormalized(spelling).map((pattern) => originalOf.get(pattern) ?? pattern),
      ),
    ]);
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function stringList(value: unknown): string[] {
  return isStringArray(value) ? value : [];
}

function listOrUndefined(values: string[]): string[] | undefined {
  return values.length > 0 ? values : undefined;
}

/**
 * Permissions adapter for Crush.
 *
 * Crush has no per-argument permission rules. Its JSON config carries two
 * tool-level lists instead:
 *   - `permissions.allowed_tools`: tools (or `tool:action` pairs) that run
 *     without a permission prompt; everything else prompts.
 *   - `options.disabled_tools`: built-in tools removed from the agent
 *     entirely.
 *
 * Mapping (rulesync canonical -> Crush), catch-all (`*`) rules only:
 *   - `allow` -> an `allowed_tools` entry.
 *   - `deny` -> a `disabled_tools` entry. Crush only filters its built-ins
 *     through that list, so a deny for an MCP tool is reported and skipped
 *     (disable the tool in the MCP server's `disabled_tools` instead).
 *   - `ask` -> nothing (prompting is Crush's default).
 *   - Tool name: `bash` -> `bash`, `read` -> `view`, `edit` -> `edit`,
 *     `write` -> `write`, `grep` -> `grep`, `glob` -> `glob`,
 *     `webfetch` -> `fetch`, `mcp__<server>__<tool>` -> `mcp_<server>_<tool>`;
 *     any other category passes through verbatim.
 *
 * Crush v0.100.0+ also carries two command lists, which the `bash` category's
 * pattern rules map onto (see `convertBashCommandRules`):
 *   - `permissions.safe_commands`: exact command lines that skip the prompt
 *     (no extra arguments, no flags) <- an `allow` on a literal command line
 *     that no canonical `deny`/`ask` overlaps.
 *   - `permissions.blocked_commands`: command names added to the dangerous
 *     list <- a `deny` on `<name>` or `<name> *`. Not a full deny: a direct
 *     invocation is still prompted for (and auto-approved in yolo mode or
 *     through `allowed_tools: ["bash"]`); only the forms Crush would not
 *     prompt for (its read-only commands, `safe_commands`) and indirect
 *     invocations are refused at exec time. An `ask` is not written there,
 *     since it would turn the read-only forms into a refusal.
 * `permissions.allowed_commands` only drops names from the dangerous list (the
 * commands keep prompting), so it has no canonical counterpart and is left
 * untouched.
 *
 * Any other pattern-specific rule cannot be expressed and is reported and
 * skipped. Because Crush cannot narrow an allowed tool, a category's catch-all `allow`
 * is not written while the same category carries a pattern-specific `deny` or
 * `ask`: the tool keeps prompting (fail closed) rather than being widened to
 * everything. The all-tools `*` category is mirrored onto `bash` by
 * `honorAllToolsOnBash` and otherwise skipped, since Crush has no allow-all
 * or disable-all list.
 *
 * `crush.json` is Crush's main config: entries naming a tool the canonical
 * config does not manage, and every `tool:action` entry (a form rulesync
 * never derives), are preserved verbatim; the managed tools' bare entries
 * are rebuilt, every other key of `permissions` / `options` and of the file is
 * kept, and the file is never deleted. Project scope writes `crush.json`, or
 * an existing `.crush.json`; Crush merges the pair (lists concatenated), so an
 * entry left in the other file stays in effect and is reported.
 *
 * @see https://github.com/charmbracelet/crush/blob/main/docs/config/README.md
 * @see https://github.com/charmbracelet/crush/blob/main/internal/config/config.go
 * @see https://github.com/charmbracelet/crush/blob/main/internal/permission/permission.go
 */
export class CrushPermissions extends ToolPermissions {
  private readonly json: Record<string, unknown>;

  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
    });
    this.json = parseCrushConfig(
      this.fileContent ?? "",
      join(this.relativeDirPath, this.relativeFilePath),
    );
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  /**
   * `crush.json` is Crush's file: rulesync merges into it when it exists but
   * does not create one that holds nothing of its own — an absent file and an
   * absent `allowed_tools` both mean "prompt for everything".
   */
  override shouldSkipCreationWhenPayloadEmpty(): boolean {
    return true;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return getCrushConfigSettablePaths({ global });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<CrushPermissions> {
    const location = await resolveCrushConfigFile({ outputRoot, global });
    return new CrushPermissions({
      outputRoot,
      relativeDirPath: location.relativeDirPath,
      relativeFilePath: location.relativeFilePath,
      fileContent: crushConfigImportContent(location),
      validate,
      global,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    logger,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<CrushPermissions> {
    const location = await resolveCrushConfigFile({ outputRoot, global });
    const existingContent = location.fileContent ?? "";
    warnCrushTwinLeftovers({
      location,
      ownedPaths: [
        [CRUSH_PERMISSIONS_KEY, CRUSH_ALLOWED_TOOLS_KEY],
        [CRUSH_PERMISSIONS_KEY, CRUSH_SAFE_COMMANDS_KEY],
        [CRUSH_PERMISSIONS_KEY, CRUSH_BLOCKED_COMMANDS_KEY],
        [CRUSH_OPTIONS_KEY, CRUSH_DISABLED_TOOLS_KEY],
      ],
      logger,
    });
    const existing = parseCrushConfig(existingContent, location.filePath);
    const existingPermissions = isRecord(existing[CRUSH_PERMISSIONS_KEY])
      ? existing[CRUSH_PERMISSIONS_KEY]
      : undefined;
    const existingOptions = isRecord(existing[CRUSH_OPTIONS_KEY])
      ? existing[CRUSH_OPTIONS_KEY]
      : undefined;

    const config = rulesyncPermissions.getJson();
    const generated = convertRulesyncToCrushLists({ config, logger });
    const managedToolNames = managedCrushToolNames(config);
    const commands = rebuildCrushCommandLists({ config, existingPermissions, logger });

    // Keep the entries rulesync could not have derived — a `tool:action`
    // pair (narrower than any canonical catch-all) or a bare name of an
    // unmanaged tool — and rebuild the managed tools' bare entries.
    const preservedAllowed = (
      isStringArray(existingPermissions?.[CRUSH_ALLOWED_TOOLS_KEY])
        ? existingPermissions[CRUSH_ALLOWED_TOOLS_KEY]
        : []
    ).filter((entry) => entry.includes(":") || !managedToolNames.has(entry));
    const preservedDisabled = (
      isStringArray(existingOptions?.[CRUSH_DISABLED_TOOLS_KEY])
        ? existingOptions[CRUSH_DISABLED_TOOLS_KEY]
        : []
    ).filter((entry) => !managedToolNames.has(entry));

    const allowedList = uniq([...preservedAllowed, ...generated.allowed]);
    const disabledList = uniq([...preservedDisabled, ...generated.disabled]);
    const permissionsHasContent =
      allowedList.length > 0 || commands.safe.length > 0 || commands.blocked.length > 0;

    // An empty list retracts its key (`undefined` deletes under deep-merge).
    // A group is only touched when there is something to write into it or it
    // already exists, so a config without tool rules does not grow an empty
    // `permissions: {}` / `options: {}`.
    const patch: Record<string, unknown> = {};
    if (permissionsHasContent || existingPermissions !== undefined) {
      patch[CRUSH_PERMISSIONS_KEY] = {
        [CRUSH_ALLOWED_TOOLS_KEY]: listOrUndefined(allowedList),
        [CRUSH_SAFE_COMMANDS_KEY]: listOrUndefined(commands.safe),
        [CRUSH_BLOCKED_COMMANDS_KEY]: listOrUndefined(commands.blocked),
      };
    }
    if (disabledList.length > 0 || existingOptions !== undefined) {
      patch[CRUSH_OPTIONS_KEY] = {
        [CRUSH_DISABLED_TOOLS_KEY]: disabledList.length > 0 ? disabledList : undefined,
      };
    }

    return new CrushPermissions({
      outputRoot,
      relativeDirPath: location.relativeDirPath,
      relativeFilePath: location.relativeFilePath,
      // Keyed by the base settable paths: a resolved `.crush.json` twin shares
      // the `crush.json` ownership declaration.
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(CrushPermissions.getSettablePaths({ global })),
        feature: "permissions",
        existingContent,
        patch,
        filePath: location.filePath,
        logger,
      }),
      validate: true,
      global,
    });
  }

  toRulesyncPermissions({ logger }: { logger?: Logger } = {}): RulesyncPermissions {
    const permissions = isRecord(this.json[CRUSH_PERMISSIONS_KEY])
      ? this.json[CRUSH_PERMISSIONS_KEY]
      : {};
    const options = toRecord(this.json[CRUSH_OPTIONS_KEY]);
    const rulesyncConfig = convertCrushListsToRulesync({
      allowed: stringList(permissions[CRUSH_ALLOWED_TOOLS_KEY]),
      disabled: stringList(options[CRUSH_DISABLED_TOOLS_KEY]),
      safe: stringList(permissions[CRUSH_SAFE_COMMANDS_KEY]),
      blocked: stringList(permissions[CRUSH_BLOCKED_COMMANDS_KEY]),
      logger,
    });

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(rulesyncConfig, null, 2),
    });
  }
}

/**
 * The `safe_commands` / `blocked_commands` lists a generate writes: the
 * existing entries rulesync keeps, followed by the ones derived from the
 * canonical `bash` rules. Existing `blocked_commands` entries are all kept:
 * rulesync cannot tell its own from hand-written ones, and dropping one only
 * ever loosens. A derived blocked name that is the command of a written safe
 * line is withheld, since Crush would refuse that line at exec time.
 */
function rebuildCrushCommandLists({
  config,
  existingPermissions,
  logger,
}: {
  config: PermissionsConfig;
  existingPermissions: Record<string, unknown> | undefined;
  logger?: Logger;
}): CrushCommandLists {
  const bashRules = honorAllToolsOnBash(config.permission)[SHELL_PERMISSION_CATEGORY] ?? {};
  const shadowTest = createSafeCommandShadowTest(config.permission);
  const generated = convertBashCommandRules({ bashRules, shadowTest, logger });
  const safe = uniq([
    ...preserveSafeCommands({
      existing: stringList(existingPermissions?.[CRUSH_SAFE_COMMANDS_KEY]),
      bashRules,
      shadowTest,
      logger,
    }),
    ...generated.safe,
  ]);
  const safeCommandNames = new Set(
    safe.flatMap((entry) => {
      const name = entry.trim().split(/\s+/)[0];
      return name === undefined || name === "" ? [] : [normalizeCrushCommandName(name)];
    }),
  );
  const blocked = generated.blocked.filter((name) => {
    if (!safeCommandNames.has(name)) return true;
    logger?.warn(
      `The "deny" rule for "bash" on ${quoteValueForWarning(name)} is not added to ` +
        `permissions.blocked_commands because Crush would then refuse the allowed ` +
        `permissions.safe_commands line(s) for that command; Crush keeps prompting for it.`,
    );
    return false;
  });
  const existingBlocked = stringList(existingPermissions?.[CRUSH_BLOCKED_COMMANDS_KEY]);
  for (const entry of existingBlocked) {
    if (!safeCommandNames.has(normalizeCrushCommandName(entry))) continue;
    logger?.warn(
      `The existing permissions.blocked_commands entry ${quoteValueForWarning(entry)} is kept, ` +
        `but Crush will refuse the permissions.safe_commands line(s) for that command at exec ` +
        `time; remove one of them by hand.`,
    );
  }
  return { safe, blocked: uniq([...existingBlocked, ...blocked]) };
}

/**
 * The existing `safe_commands` entries a generate keeps: those the canonical
 * `bash` rules do not spell out themselves (an entry they do spell is rebuilt
 * from them), minus any entry a canonical `deny`/`ask` governs, which would
 * otherwise auto-approve what the config restricts. An entry whose exact
 * meaning cannot be read is dropped whenever the config restricts anything.
 */
function preserveSafeCommands({
  existing,
  bashRules,
  shadowTest,
  logger,
}: {
  existing: string[];
  bashRules: Record<string, PermissionAction>;
  shadowTest: (line: string) => string[];
  logger?: Logger;
}): string[] {
  const managedLines = new Set(Object.keys(bashRules));
  // Any restriction at all overlaps the catch-all spelling.
  const restricts = shadowTest(CATCH_ALL_PATTERN).length > 0;
  return existing.filter((entry) => {
    if (managedLines.has(entry)) return false;
    const line = effectiveSafeCommandLine(entry);
    const shadowed = line === undefined ? restricts : shadowTest(line).length > 0;
    if (shadowed) {
      logger?.warn(
        `Crush permissions.safe_commands entry ${quoteValueForWarning(entry)} was removed because ` +
          `a canonical deny/ask rule may cover the commands it approves.`,
      );
    }
    return !shadowed;
  });
}

/**
 * The Crush tool names the canonical config manages, i.e. the names its
 * categories map to. Entries naming any other tool are the user's and survive
 * a generate. The all-tools `*` category names no Crush tool of its own.
 */
function managedCrushToolNames(config: PermissionsConfig): Set<string> {
  return new Set(
    Object.keys(config.permission)
      .filter(
        (category) =>
          category !== ALL_TOOLS_PERMISSION_CATEGORY && !isPrototypePollutionKey(category),
      )
      .map((category) => toCrushToolName(category)),
  );
}

/**
 * Reduce one category's rules to the single tool-wide action Crush can carry,
 * or undefined when nothing should be written for the tool: no catch-all rule,
 * a catch-all allow next to a narrower deny/ask (Crush cannot narrow an
 * allowed tool, so it keeps prompting instead), or a deny on an MCP tool
 * (`options.disabled_tools` only covers built-ins).
 */
function resolveCategoryAction({
  category,
  toolName,
  rules,
  logger,
}: {
  category: string;
  toolName: string;
  rules: Record<string, PermissionAction>;
  logger?: Logger;
}): PermissionAction | undefined {
  let catchAllAction: PermissionAction | undefined;
  let restricted = false;

  for (const [rawPattern, action] of Object.entries(rules)) {
    if (isPrototypePollutionKey(rawPattern)) continue;
    const pattern = normalizeCatchAllPattern(rawPattern);
    if (pattern === CATCH_ALL_PATTERN) {
      catchAllAction = action;
      continue;
    }
    // `bash` patterns are mapped (or reported) by `convertBashCommandRules`.
    if (category !== SHELL_PERMISSION_CATEGORY) {
      logger?.warn(
        `Crush permissions are tool-wide (no argument patterns), so the "${action}" rule for ` +
          `"${category}" (pattern ${quoteValueForWarning(pattern)}) was skipped.`,
      );
    }
    if (action !== "allow") {
      restricted = true;
    }
  }

  if (catchAllAction === "allow" && restricted) {
    logger?.warn(
      `Crush cannot narrow an allowed tool, so "${category}" is not added to ` +
        `permissions.allowed_tools while it carries a pattern-specific deny/ask rule; ` +
        `Crush keeps prompting for "${toolName}".`,
    );
    return undefined;
  }
  if (catchAllAction === "deny" && isMcpToolName(toolName)) {
    logger?.warn(
      `Crush's options.disabled_tools only covers built-in tools, so the "deny" rule for ` +
        `"${category}" was skipped; disable the tool through the MCP server's "disabled_tools" instead.`,
    );
    return undefined;
  }
  return catchAllAction;
}

/**
 * Convert a rulesync permissions config into Crush's two tool lists.
 */
function convertRulesyncToCrushLists({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: Logger;
}): CrushToolLists {
  const lists: CrushToolLists = { allowed: [], disabled: [] };
  // Two categories can resolve to the same Crush tool (`read` and a
  // pass-through `view`), so a disagreement between them is reported rather
  // than silently resolved.
  const actionByTool = new Map<string, PermissionAction>();

  for (const [category, rules] of Object.entries(honorAllToolsOnBash(config.permission))) {
    if (isPrototypePollutionKey(category)) continue;
    if (category === ALL_TOOLS_PERMISSION_CATEGORY) {
      // `honorAllToolsOnBash` has already mirrored the restrictions onto bash.
      for (const [rawPattern, action] of Object.entries(rules)) {
        if (isPrototypePollutionKey(rawPattern)) continue;
        logger?.warn(
          `Crush has no allow-all or disable-all tool list, so the "${action}" rule for "*" ` +
            `(pattern ${quoteValueForWarning(rawPattern)}) was skipped.`,
        );
      }
      continue;
    }

    const toolName = toCrushToolName(category);
    const catchAllAction = resolveCategoryAction({ category, toolName, rules, logger });
    if (catchAllAction === undefined) {
      continue;
    }

    const previous = actionByTool.get(toolName);
    if (previous !== undefined && previous !== catchAllAction) {
      logger?.warn(
        `Crush permissions: rules from different categories both resolve to ` +
          `${quoteValueForWarning(toolName)} with conflicting actions (${previous} and ${catchAllAction}). ` +
          `Both are written; a disabled tool is hidden from the agent regardless of allowed_tools.`,
      );
    }
    actionByTool.set(toolName, catchAllAction);
    if (catchAllAction === "allow") {
      lists.allowed.push(toolName);
    } else if (catchAllAction === "deny") {
      lists.disabled.push(toolName);
    }
    // `ask` is Crush's default: nothing to write.
  }

  return { allowed: uniq(lists.allowed), disabled: uniq(lists.disabled) };
}

/**
 * Map the `bash` category's pattern rules onto Crush's command lists:
 *   - `allow` on a literal command line -> `permissions.safe_commands`, which
 *     Crush matches exactly (no extra arguments, no flags). It is withheld
 *     when a canonical `deny`/`ask` governs any command Crush would approve
 *     through it.
 *   - `deny` on `<name>` / `<name> *` -> `permissions.blocked_commands`, the
 *     strictest Crush can say about a single command: a direct invocation is
 *     still prompted for, while the forms Crush would not prompt for and
 *     indirect invocations are refused at exec time. Reported, since it is
 *     not a full deny.
 *   - Anything else is reported and skipped. A pattern `ask` is never written
 *     to `blocked_commands`, which would refuse the command's read-only forms
 *     outright, and an `allow` with a wildcard has no list that auto-approves
 *     it.
 */
function convertBashCommandRules({
  bashRules,
  shadowTest,
  logger,
}: {
  bashRules: Record<string, PermissionAction>;
  shadowTest: (line: string) => string[];
  logger?: Logger;
}): CrushCommandLists {
  const lists: CrushCommandLists = { safe: [], blocked: [] };
  for (const [rawPattern, action] of Object.entries(bashRules)) {
    if (isPrototypePollutionKey(rawPattern)) continue;
    const pattern = normalizeCatchAllPattern(rawPattern);
    if (pattern === CATCH_ALL_PATTERN) continue;
    const quoted = quoteValueForWarning(pattern);

    if (action === "allow") {
      if (!isExactCrushCommandLine(pattern)) {
        logger?.warn(
          `Crush auto-approves a command only as an exact line in permissions.safe_commands ` +
            `(no wildcards or shell syntax), so the "allow" rule for "bash" (pattern ${quoted}) ` +
            `was skipped; Crush keeps prompting for it.`,
        );
        continue;
      }
      const shadows = shadowTest(pattern);
      if (shadows.length > 0) {
        logger?.warn(
          `The "allow" rule for "bash" (pattern ${quoted}) is not added to ` +
            `permissions.safe_commands because the deny/ask rule(s) ` +
            `${shadows.map(quoteValueForWarning).join(", ")} also cover commands Crush would ` +
            `approve through it; Crush keeps prompting for it.`,
        );
        continue;
      }
      lists.safe.push(pattern);
      continue;
    }

    if (action === "ask") {
      logger?.warn(
        `Crush has no per-command prompt list (permissions.blocked_commands would refuse the ` +
          `command's read-only forms outright), so the "ask" rule for "bash" (pattern ${quoted}) ` +
          `was skipped; Crush still prompts for it unless it is one of Crush's built-in ` +
          `read-only commands.`,
      );
      continue;
    }

    const name = wholeCommandName(pattern);
    if (name !== undefined && CRUSH_COMMAND_PREFIXES.includes(name)) {
      logger?.warn(
        `Crush resolves the command wrapper or keyword ${quoteValueForWarning(name)} before ` +
          `matching permissions.blocked_commands, so an entry for it would have no effect; the ` +
          `"deny" rule for "bash" (pattern ${quoted}) was skipped and Crush still prompts for it.`,
      );
      continue;
    }
    if (name === undefined) {
      logger?.warn(
        `Crush can only restrict a whole command (permissions.blocked_commands), so the "deny" ` +
          `rule for "bash" (pattern ${quoted}) was skipped; Crush still prompts for it unless it ` +
          `is one of Crush's built-in read-only commands.`,
      );
      continue;
    }
    logger?.warn(
      `The "deny" rule for "bash" (pattern ${quoted}) is written as permissions.blocked_commands ` +
        `entry ${quoteValueForWarning(name)}, which is not a full deny: Crush still prompts for a ` +
        `direct invocation (and runs it unprompted in yolo mode or with "bash" in allowed_tools).`,
    );
    lists.blocked.push(name);
  }
  return { safe: uniq(lists.safe), blocked: uniq(lists.blocked) };
}

/**
 * Convert Crush's two tool lists back into a rulesync config. A `tool:action`
 * entry scopes an allow to one action of a tool, which the canonical model
 * cannot express, so it is left out rather than widened to the whole tool.
 */
function convertCrushListsToRulesync({
  allowed,
  disabled,
  safe,
  blocked,
  logger,
}: CrushToolLists & CrushCommandLists & { logger?: Logger }): PermissionsConfig {
  const permission: PermissionsConfig["permission"] = {};

  // Buckets are looked up as own properties only: a `toString` entry must
  // create its own record rather than write into the inherited function.
  const bucketFor = (category: string): Record<string, PermissionAction> => {
    const own = lookupOwn({ record: permission, key: category });
    if (own !== undefined) return own;
    const created: Record<string, PermissionAction> = {};
    permission[category] = created;
    return created;
  };

  for (const entry of disabled) {
    if (entry === "" || isPrototypePollutionKey(entry)) continue;
    bucketFor(toCanonicalToolName(entry))[CATCH_ALL_PATTERN] = "deny";
  }
  // Pattern rules land in the `bash` bucket without overriding a rule already
  // there, so the order below keeps the stricter one: deny before allow.
  const setBashRule = (pattern: string, action: PermissionAction): void => {
    const bucket = bucketFor(SHELL_PERMISSION_CATEGORY);
    if (!Object.hasOwn(bucket, pattern)) bucket[pattern] = action;
  };
  for (const entry of blocked) {
    const name = normalizeCrushCommandName(entry);
    if (name === "") continue;
    if (!isCrushCommandName(name)) {
      logger?.warn(
        `Crush permissions.blocked_commands entry ${quoteValueForWarning(entry)} is not a plain ` +
          `command name, so it was not imported.`,
      );
      continue;
    }
    // A blocked command covers every invocation, bare or with arguments. It
    // comes back as the deny it is generated from: Crush refuses its
    // unprompted forms, so an `ask` would read looser than Crush behaves.
    setBashRule(name, "deny");
    setBashRule(`${name} *`, "deny");
  }
  for (const entry of safe) {
    if (entry.trim() === "") continue;
    const line = effectiveSafeCommandLine(entry);
    if (line === undefined) {
      logger?.warn(
        `Crush permissions.safe_commands entry ${quoteValueForWarning(entry)} has no exact ` +
          `rulesync pattern (wildcards, shell syntax or a command wrapper), so it was not imported.`,
      );
      continue;
    }
    setBashRule(line, "allow");
  }
  for (const entry of allowed) {
    if (entry === "" || entry.includes(":") || isPrototypePollutionKey(entry)) continue;
    // A disabled tool never runs, so its deny wins over a stale allow.
    bucketFor(toCanonicalToolName(entry))[CATCH_ALL_PATTERN] ??= "allow";
  }

  return { permission };
}

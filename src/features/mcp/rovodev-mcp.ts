import { join, posix } from "node:path";

import {
  ROVODEV_CONFIG_FILE_NAME,
  ROVODEV_DIR,
  ROVODEV_MCP_FILE_NAME,
} from "../../constants/rovodev-paths.js";
import type { SharedWritePath } from "../../lib/shared-file-derive.js";
import { ValidationResult } from "../../types/ai-file.js";
import { isMcpServers } from "../../types/mcp.js";
import { ToolFile } from "../../types/tool-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, toPosixPath } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isPlainObject, isRecord, isStringArray } from "../../utils/type-guards.js";
import {
  ROVODEV_CONFIG_SHARED_FILE_KEY,
  applySharedConfigPatch,
  parseSharedConfig,
} from "../shared/shared-config-gateway.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

function parseRovodevMcpJson(
  fileContent: string,
  relativeDirPath: string,
  relativeFilePath: string,
): Record<string, unknown> {
  const configPath = join(relativeDirPath, relativeFilePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(`Failed to parse Rovodev MCP config at ${configPath}: ${formatError(error)}`, {
      cause: error,
    });
  }
  // `isPlainObject` (not `isRecord`) rejects class instances for
  // prototype-pollution hardening; `JSON.parse` always yields a plain object.
  if (!isPlainObject(parsed)) {
    throw new Error(`Failed to parse Rovodev MCP config at ${configPath}: expected a JSON object`);
  }
  return parsed;
}

/**
 * Rovodev MCP: `~/.rovodev/mcp.json` (global) and the repo-committed project
 * `.rovodev/mcp.json` documented by the Bitbucket Cloud Agentic Pipelines
 * guide ("Register your MCP server in `.rovodev/mcp.json`", referenced via
 * `mcp.mcpConfigPath`). Same shape as Cursor: { mcpServers: { ... } }.
 * A server the canonical config marks `disabled: true` is still written here
 * and switched off through `mcp.disabledMcpServers` in the sibling
 * `config.yml` — the file Rovo Dev actually consults for disabling.
 */

/**
 * Rovo Dev documents the per-server transport key as `transport`, with the
 * values `stdio` | `http` | `sse`. Canonical rulesync configs spell it `type`,
 * so translate rather than passing the canonical key through — Rovo Dev has no
 * documented `type` alias.
 *
 * @see https://support.atlassian.com/rovo/docs/connect-to-an-mcp-server-in-rovo-dev-cli/
 */
const CANONICAL_TO_ROVODEV_TRANSPORT: Record<string, string> = {
  stdio: "stdio",
  local: "stdio",
  http: "http",
  "streamable-http": "http",
  sse: "sse",
};

const ROVODEV_TO_CANONICAL_TRANSPORT: Record<string, string> = {
  stdio: "stdio",
  http: "http",
  sse: "sse",
};

// Own properties only: a server declaring `__proto__` would otherwise resolve to
// `Object.prototype` and land in the config as a transport value.
function lookupTransport(map: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

/**
 * Read the "put this server's own instructions into the agent's prompt" flag
 * off an unfiltered canonical entry, under either spelling. Anything other
 * than a literal `true` reads as not enabled, matching Rovo Dev, where the key
 * is absent by default.
 *
 * The canonical key decides whenever it is present, the way codex resolves the
 * same two-spelling conflict for `experimental_environment`. OR-ing the two
 * would make an explicit `rovodevEnableInstructions: false` lose to a stale
 * `enable_instructions: true` copied out of Atlassian's docs — fail-open, on
 * the one key whose whole purpose is a trust decision.
 *
 * `isPlainObject` rather than `isRecord`: this walks a user-supplied key set,
 * so a `constructor` entry must not resolve up the prototype chain.
 */
function readEnableInstructions(rawServer: unknown): boolean {
  if (!isPlainObject(rawServer)) {
    return false;
  }
  if (rawServer.rovodevEnableInstructions !== undefined) {
    return rawServer.rovodevEnableInstructions === true;
  }
  return rawServer.enable_instructions === true;
}

/**
 * Names that were emitted with `enable_instructions: true` during one
 * `fromRulesyncMcp` call, so the run can say so once rather than per server.
 * Atlassian gates this key on trust, and it is the only thing generate writes
 * that widens what steers the model — the quietest possible write is the wrong
 * one for it.
 */
function warnEnabledInstructions(names: string[], logger?: Logger): void {
  if (names.length === 0) {
    return;
  }
  logger?.warn(
    `Rovo Dev MCP: writing enable_instructions: true for ${names.join(", ")}. Rovo Dev pastes ` +
      `${names.length === 1 ? "that server's" : "those servers'"} own instructions into the ` +
      `agent's system prompt, so enable it only for servers you trust.`,
  );
}

function toRovodevServer(
  name: string,
  server: Record<string, unknown>,
  logger?: Logger,
): Record<string, unknown> | null {
  // `disabled` is dropped from the entry: `mcp.json` has no such key. The
  // toggle itself is written to `mcp.disabledMcpServers` in `config.yml` by
  // `getAuxiliaryFiles`, so the server definition survives and can be
  // re-enabled without re-authoring it.
  const { type, transport, disabled: _disabled, rovodevEnableInstructions, ...rest } = server;
  // Authored as `rovodevEnableInstructions` (or as the raw spelling, which
  // `fromRulesyncMcp` normalizes onto it) and written under Rovo Dev's own
  // name. Only `true` is written: absent and `false` mean the same thing to
  // Rovo Dev, and the shorter of the two is the one that cannot be misread.
  if (rovodevEnableInstructions === true) {
    rest.enable_instructions = true;
  }
  const declared =
    typeof transport === "string" ? transport : typeof type === "string" ? type : undefined;
  if (declared === undefined) {
    return rest;
  }
  const mapped = lookupTransport(CANONICAL_TO_ROVODEV_TRANSPORT, declared);
  if (mapped === undefined) {
    // `ws` is the only canonical transport Rovo Dev has no equivalent for.
    // Skip the whole entry rather than emit one whose transport is anyone's
    // guess, matching the Kimi Code adapter over the same vocabulary.
    logger?.warn(
      `Rovo Dev MCP: skipping "${name}" because the "${declared}" transport is unsupported.`,
    );
    return null;
  }
  return { ...rest, transport: mapped };
}

function fromRovodevServer(server: Record<string, unknown>): Record<string, unknown> {
  const { transport, enable_instructions: enableInstructions, ...rest } = server;
  // Lifted onto the canonical key so the next generate writes it again rather
  // than losing it, and so `getMcpServers()` keeps it out of the other targets
  // — the raw spelling would be stripped there and vanish on the round trip.
  // Only a real `true` is carried: any other value means "not enabled" to Rovo
  // Dev, and the canonical field is a strict boolean.
  if (enableInstructions === true) {
    rest.rovodevEnableInstructions = true;
  }
  if (typeof transport !== "string") {
    return rest;
  }
  const mapped = lookupTransport(ROVODEV_TO_CANONICAL_TRANSPORT, transport);
  // A value outside Rovo Dev's vocabulary (a typo, or one Atlassian adds later)
  // is dropped rather than carried over: the canonical transport field is a
  // strict enum, so writing it through would make `.rulesync/mcp.json` fail to
  // parse on the next run — for every target, not just this one.
  return mapped === undefined ? rest : { ...rest, type: mapped };
}

/**
 * Read the sibling `config.yml` (same scope root as `mcp.json`) and return the
 * parsed document, `null` when the file does not exist. A malformed file
 * **throws**: the disable toggle lives here, so pretending a broken file says
 * nothing would silently re-enable servers on import and leave disabled ones
 * running on generate — both flip a security toggle the wrong way.
 */
async function readRovodevConfigYaml({
  outputRoot,
}: {
  outputRoot: string;
}): Promise<Record<string, unknown> | null> {
  const content = await readFileContentOrNull(
    join(outputRoot, ROVODEV_DIR, ROVODEV_CONFIG_FILE_NAME),
  );
  if (content === null) {
    return null;
  }
  return parseSharedConfig({
    format: "yaml",
    fileContent: content,
    filePath: join(ROVODEV_DIR, ROVODEV_CONFIG_FILE_NAME),
  });
}

function disabledNamesOf(config: Record<string, unknown> | null): string[] {
  const mcpBlock = config && isRecord(config.mcp) ? config.mcp : {};
  return isStringArray(mcpBlock.disabledMcpServers) ? mcpBlock.disabledMcpServers : [];
}

/**
 * The value `mcp.mcpConfigPath` needs so Rovo Dev reads the `mcp.json` rulesync
 * writes for the scope being generated. A config-file value, not a filesystem
 * path, so it is always POSIX-separated.
 *
 * Project scope names the repo-relative file. Global scope has to be
 * home-anchored instead: `~/.rovodev/config.yml` is read from whatever
 * directory Rovo Dev is started in, so a bare `.rovodev/mcp.json` there would
 * resolve against the current project. `~` is the spelling Atlassian's own
 * documented default uses.
 */
const ROVODEV_PROJECT_MCP_CONFIG_POINTER = posix.join(ROVODEV_DIR, ROVODEV_MCP_FILE_NAME);
const ROVODEV_GLOBAL_MCP_CONFIG_POINTER = posix.join("~", ROVODEV_DIR, ROVODEV_MCP_FILE_NAME);

/**
 * The other file name Atlassian documents as the `mcpConfigPath` default —
 * `~/.rovodev/mcp_config.json` in the settings reference, against
 * `~/.rovodev/mcp.json` in the MCP guide. Rulesync never writes it, but it has
 * to look before naming its own: if the settings reference is the spelling in
 * force, whatever lives here is what Rovo Dev reads today, and `mcpConfigPath`
 * replaces that file rather than merging with it.
 */
const ROVODEV_ALTERNATE_MCP_FILE_NAME = "mcp_config.json";

/**
 * Describe what the user would lose by pointing `mcpConfigPath` at the global
 * `mcp.json`, or `null` when there is nothing in the way.
 *
 * Only a file that can be shown to hold nothing answers `null`. One that
 * cannot be read, cannot be parsed, or carries a shape rulesync does not
 * recognize all count as in the way for the same reason: none of them can be
 * shown to be empty, and taking a user's whole global MCP config away is not a
 * decision to make on a guess. An unreadable file answers rather than throwing,
 * so a directory or a permission error at that path costs the run one decision
 * instead of every target's MCP output.
 */
async function describeDisplacedGlobalServers({
  outputRoot,
}: {
  outputRoot: string;
}): Promise<string | null> {
  const label = posix.join("~", ROVODEV_DIR, ROVODEV_ALTERNATE_MCP_FILE_NAME);
  const unrecognized =
    `${label} exists but does not have the expected shape, so the servers it holds cannot be ` +
    `ruled out`;
  let content: string | null;
  try {
    content = await readFileContentOrNull(
      join(outputRoot, ROVODEV_DIR, ROVODEV_ALTERNATE_MCP_FILE_NAME),
    );
  } catch {
    return `${label} exists but cannot be read, so the servers it holds cannot be ruled out`;
  }
  if (content === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return `${label} exists but cannot be parsed, so the servers it holds cannot be ruled out`;
  }
  if (!isPlainObject(parsed)) {
    return unrecognized;
  }
  if (!isPlainObject(parsed.mcpServers)) {
    // `{}` is affirmatively empty. Anything else — servers under a key
    // rulesync does not know, or an `mcpServers` that is not a mapping — is
    // the same epistemic position as a file that cannot be parsed.
    return Object.keys(parsed).length === 0 ? null : unrecognized;
  }
  const names = Object.keys(parsed.mcpServers);
  return names.length === 0 ? null : `${label} defines ${names.join(", ")}`;
}

/**
 * The keys that make an entry in `mcp.json` something Rovo Dev can start:
 * a local process, or a remote endpoint under either spelling the canonical
 * config accepts.
 */
const MCP_SERVER_ENDPOINT_KEYS = ["command", "url", "httpUrl"] as const;

function normalizeMcpConfigPathValue(value: string): string {
  return toPosixPath(value).replace(/^\.\//, "");
}

/**
 * Every way one of Rovo Dev's home-directory MCP files can be spelled and still
 * resolve to that file. In global scope `outputRoot` *is* the home directory,
 * so an already-expanded absolute path is recognized without asking the OS,
 * alongside the `~` form Atlassian's own documented default uses. Treating
 * either as "somewhere else" would report a file as unread while Rovo Dev is
 * reading it, and would miss the stale-pointer warning in the other direction.
 *
 * A home directory of `/` is why the absolute form falls back rather than
 * joining against an emptied string: `posix.join("", tail)` would yield the
 * bare repo-relative `.rovodev/<file>`, the one value global scope has to keep
 * reporting as wrong.
 */
function mcpFileSpellings({
  fileName,
  global,
  outputRoot,
}: {
  fileName: string;
  global: boolean;
  outputRoot: string;
}): string[] {
  const tail = posix.join(ROVODEV_DIR, fileName);
  if (!global) {
    return [tail];
  }
  const home = toPosixPath(outputRoot).replace(/\/+$/, "");
  return [posix.join("~", tail), posix.join(home || "/", tail)];
}

/**
 * The environment-variable spellings a shell or a hand edit can leave in
 * `mcpConfigPath`. They are kept apart from {@link mcpFileSpellings} because
 * nothing in Atlassian's documentation says Rovo Dev expands variables in this
 * setting — unlike `~`, which its own documented default relies on. Calling
 * them correct would silence the one user whose pointer resolves to a literal
 * `$HOME` directory and reads no servers at all, so they get a message of
 * their own instead.
 */
function envVarMcpFileSpellings({ fileName }: { fileName: string }): string[] {
  const tail = posix.join(ROVODEV_DIR, fileName);
  return [`$HOME/${tail}`, `\${HOME}/${tail}`];
}

/**
 * Point `mcp.mcpConfigPath` at the `mcp.json` rulesync writes for this scope,
 * and report whether the block gained a value it did not already carry.
 *
 * Rovo Dev's `mcpConfigPath` defaults to a file under the user's home
 * directory, so a repo-committed `.rovodev/mcp.json` is inert until the active
 * config points at it — the Bitbucket Agentic Pipelines guide documents
 * registering the server and setting the pointer as two required steps.
 *
 * Global scope needs the pointer too, because Atlassian's own two pages
 * disagree about what the default is: the settings reference documents
 * `~/.rovodev/mcp_config.json`, while the MCP guide has servers registered in
 * `~/.rovodev/mcp.json`. Under the first spelling the global file rulesync
 * writes is never read at all, so naming it explicitly is what makes the
 * outcome the same either way — the pointer states the file rulesync owns
 * rather than betting on which default is in force.
 *
 * That same disagreement is why global scope withholds the pointer when
 * `~/.rovodev/mcp_config.json` holds servers of its own. If the settings
 * reference is right, those are the servers Rovo Dev is running today, and
 * naming `mcp.json` instead would drop every one of them on every project on
 * the machine — rulesync does not write that file, so it could neither import
 * them first nor put them back. The pointer is left for the user to set once
 * they have moved what they want to keep, and the situation is reported.
 *
 * The pointer names one config rather than merging with the default, so it is
 * written only when this project actually has a Rovo Dev server to run — a
 * server that targets `rovodev` and is not disabled. Otherwise `mcp.json` is
 * generated empty, and pointing at it would take away the user's global
 * servers for this repository in exchange for nothing.
 *
 * That condition can also stop holding after the fact, once the last server is
 * removed from the canonical config or switched off. Rulesync does not take
 * the pointer back out — it cannot tell its own past value from a user who
 * typed the same string — but it says so, since the file is now a live setting
 * that resolves to nothing.
 *
 * A pointer the user aimed somewhere else is theirs, not ours: overwriting it
 * would silently redirect Rovo Dev away from a file they chose. It is named in
 * a warning instead, because the generated `mcp.json` is unread while it
 * stands. One value earns its own message: `~/.rovodev/mcp_config.json`, which
 * the settings reference documents as the default and which Rovo Dev may
 * therefore have written itself. That user is exactly the one this pointer
 * exists for, so the message tells them what to change and whether that file
 * holds anything they would lose by changing it.
 *
 * Whatever the outcome, it is logged: writing the pointer turns servers that
 * were generated-but-never-read into servers Rovo Dev actually spawns, and
 * points it away from the global MCP config, so it is not something to do
 * quietly.
 *
 * @see https://support.atlassian.com/bitbucket-cloud/docs/rovo-dev-advanced-agentic-configuration/
 * @see https://support.atlassian.com/rovo/docs/manage-rovo-dev-cli-settings/
 */
/**
 * The three names one scope's messages need: the value to write, and the two
 * files as the user sees them — so a global-scope message does not report a
 * home-directory file by its repo-relative path.
 */
function pointerLabels(global: boolean): {
  pointer: string;
  configLabel: string;
  mcpLabel: string;
} {
  if (global) {
    const pointer = ROVODEV_GLOBAL_MCP_CONFIG_POINTER;
    return {
      pointer,
      configLabel: posix.join("~", ROVODEV_DIR, ROVODEV_CONFIG_FILE_NAME),
      mcpLabel: pointer,
    };
  }
  return {
    pointer: ROVODEV_PROJECT_MCP_CONFIG_POINTER,
    configLabel: join(ROVODEV_DIR, ROVODEV_CONFIG_FILE_NAME),
    mcpLabel: join(ROVODEV_DIR, ROVODEV_MCP_FILE_NAME),
  };
}

/**
 * Report a `mcpConfigPath` sitting at the default Atlassian's settings
 * reference documents. It is not overwritten — it may well hold the user's
 * servers — but this is the user the pointer exists for, so the message says
 * what to change and what changing it would cost.
 *
 * Global-only by construction, not by the caller's discipline: the default it
 * reports and the file `describeDisplacedGlobalServers` opens are both under
 * the home directory, so taking a scope flag would let a future caller read a
 * repo-relative `.rovodev/mcp_config.json` and label it `~/...`.
 */
async function warnAtDocumentedDefault({
  existing,
  outputRoot,
  logger,
}: {
  existing: unknown;
  outputRoot: string;
  logger?: Logger;
}): Promise<void> {
  const { pointer, configLabel, mcpLabel } = pointerLabels(true);
  const displaced = await describeDisplacedGlobalServers({ outputRoot });
  logger?.warn(
    `Rovo Dev MCP: leaving mcp.mcpConfigPath as ${JSON.stringify(existing)} in ${configLabel}. ` +
      `That is the default Atlassian's settings reference documents, so it may be Rovo Dev's ` +
      `own value rather than one you chose — and while it stands, the generated ${mcpLabel} is ` +
      `never read. ` +
      (displaced === null
        ? `It defines no servers of its own, so setting mcp.mcpConfigPath to "${pointer}" costs ` +
          `nothing.`
        : `Move the servers you want to keep into .rulesync/mcp.jsonc first, then set ` +
          `mcp.mcpConfigPath to "${pointer}" — ${displaced}.`),
  );
}

/**
 * Announce a pointer that was just written. Warned rather than noted in global
 * scope: the project pointer changes one repository, this one changes Rovo Dev
 * everywhere on the machine.
 *
 * Writing it is the moment Rovo Dev starts running the generated servers:
 * until now it read whichever file its default names, and the generated
 * `mcp.json` was inert — in project scope always, and in global scope whenever
 * the default is the `mcp_config.json` spelling. It also *replaces* that file
 * rather than merging with it, since `mcpConfigPath` names a single config.
 * Both are consequences worth stating out loud rather than applying silently.
 */
function announcePointer({ global, logger }: { global: boolean; logger?: Logger }): void {
  const { pointer, configLabel, mcpLabel } = pointerLabels(global);
  const announcement =
    `Rovo Dev MCP: setting mcp.mcpConfigPath to "${pointer}" in ${configLabel}. Rovo Dev will ` +
    `now launch the servers in ${mcpLabel}${global ? " on every project" : " for this project"} ` +
    `instead of the ones in the config its default names.`;
  if (global) {
    logger?.warn(announcement);
  } else {
    logger?.info(announcement);
  }
}

async function applyMcpConfigPointer({
  existingMcp,
  global,
  hasLiveServers,
  outputRoot,
  logger,
}: {
  existingMcp: Record<string, unknown>;
  global: boolean;
  hasLiveServers: boolean;
  outputRoot: string;
  logger?: Logger;
}): Promise<boolean> {
  const { pointer, configLabel, mcpLabel } = pointerLabels(global);

  const existing = existingMcp.mcpConfigPath;
  const normalizedExisting =
    typeof existing === "string" ? normalizeMcpConfigPathValue(existing) : undefined;
  const namesFile = (fileName: string): boolean =>
    normalizedExisting !== undefined &&
    mcpFileSpellings({ fileName, global, outputRoot }).includes(normalizedExisting);
  const pointsAtGeneratedFile = namesFile(ROVODEV_MCP_FILE_NAME);

  if (!hasLiveServers) {
    if (pointsAtGeneratedFile) {
      logger?.warn(
        `Rovo Dev MCP: mcp.mcpConfigPath in ${configLabel} points at ${mcpLabel}, which now has ` +
          `no enabled server. Rovo Dev reads MCP servers from that file and nowhere else, so ` +
          `${global ? "Rovo Dev has" : "this project has"} no MCP servers at all until one ` +
          `targeting rovodev is added back — remove the mcp.mcpConfigPath line to fall back to ` +
          `${global ? "Rovo Dev's own default" : "the global config"}.`,
      );
    }
    return false;
  }

  if (existing === undefined) {
    const displaced = global ? await describeDisplacedGlobalServers({ outputRoot }) : null;
    if (displaced !== null) {
      logger?.warn(
        `Rovo Dev MCP: leaving mcp.mcpConfigPath unset in ${configLabel}, because ${displaced}. ` +
          `Atlassian documents that path and ${mcpLabel} as two different defaults for the ` +
          `setting, and mcpConfigPath names one config rather than merging, so pointing it at ` +
          `${mcpLabel} would stop those servers being read on every project. Move the ones you ` +
          `want to keep into .rulesync/mcp.jsonc, then set mcp.mcpConfigPath to "${pointer}".`,
      );
      return false;
    }

    existingMcp.mcpConfigPath = pointer;
    announcePointer({ global, logger });
    return true;
  }
  if (pointsAtGeneratedFile) {
    return false;
  }

  // Quite possibly Rovo Dev's own writing rather than a destination the user
  // chose, so it gets a message that says what to do rather than the generic
  // "you aimed this somewhere else".
  if (global && namesFile(ROVODEV_ALTERNATE_MCP_FILE_NAME)) {
    await warnAtDocumentedDefault({ existing, outputRoot, logger });
    return false;
  }

  // Aimed at the right file under a spelling that only works if Rovo Dev
  // expands environment variables, which nothing documents that it does.
  if (
    global &&
    normalizedExisting !== undefined &&
    envVarMcpFileSpellings({ fileName: ROVODEV_MCP_FILE_NAME }).includes(normalizedExisting)
  ) {
    logger?.warn(
      `Rovo Dev MCP: mcp.mcpConfigPath in ${configLabel} is ${JSON.stringify(existing)}. That ` +
        `names ${mcpLabel} only if Rovo Dev expands environment variables in this setting, ` +
        `which Atlassian does not document — if it does not, the path resolves literally and ` +
        `Rovo Dev reads no MCP servers at all. Write "${pointer}" instead, the form its own ` +
        `documented default uses.`,
    );
    return false;
  }

  logger?.warn(
    `Rovo Dev MCP: leaving mcp.mcpConfigPath as ${JSON.stringify(existing)} in ${configLabel}. ` +
      `Rovo Dev reads MCP servers from that path, so the generated ${mcpLabel} is unused until ` +
      `it is set to "${pointer}".`,
  );
  return false;
}

/**
 * Auxiliary writer for the `mcp:` block of `.rovodev/config.yml` (project) /
 * `~/.rovodev/config.yml` (global). Carries `disabledMcpServers` — the key
 * Rovo Dev actually consults to switch a server off — plus `mcpConfigPath`,
 * which rulesync authors in either scope when the key is absent and there is
 * a server to run (see `applyMcpConfigPointer`). The block
 * is recomputed from the existing one, so user keys (`allowedMcpServers`,
 * ...), a `mcpConfigPath` the user aimed elsewhere, and disabled names for
 * servers rulesync does not manage all survive.
 */
export class RovodevMcpConfigYaml extends ToolFile {
  override isDeletable(): boolean {
    // Shared with the permissions feature and the user's own settings; only
    // the `mcp` key is rulesync-managed here.
    return false;
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}

export class RovodevMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    if (this.fileContent !== undefined) {
      this.json = parseRovodevMcpJson(
        this.fileContent,
        this.relativeDirPath,
        this.relativeFilePath,
      );
    } else {
      this.json = {};
    }
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolMcpSettablePaths {
    return {
      relativeDirPath: ROVODEV_DIR,
      relativeFilePath: ROVODEV_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<RovodevMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}';
    const json = parseRovodevMcpJson(fileContent, paths.relativeDirPath, paths.relativeFilePath);
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    // Rovo Dev disables servers through `mcp.disabledMcpServers` in the
    // sibling `config.yml`. Overlay `disabled: true` on the named entries so
    // import round-trips the toggle into the canonical config. A malformed
    // config.yml throws here (fail-closed): importing past it would re-enable
    // every disabled server in the canonical config.
    const disabledNames = disabledNamesOf(await readRovodevConfigYaml({ outputRoot }));
    if (disabledNames.length > 0 && isMcpServers(newJson.mcpServers)) {
      const servers = newJson.mcpServers as Record<string, unknown>;
      for (const name of disabledNames) {
        // Own-property guard: a committed `__proto__` entry in
        // `disabledMcpServers` must not mutate the object's prototype.
        if (!Object.hasOwn(servers, name)) {
          continue;
        }
        const server = servers[name];
        if (isPlainObject(server)) {
          servers[name] = { ...server, disabled: true };
        }
      }
    }

    return new RovodevMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
      global,
    });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
    logger,
  }: ToolMcpFromRulesyncMcpParams): Promise<RovodevMcp> {
    const paths = this.getSettablePaths({ global });

    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? JSON.stringify({ mcpServers: {} }, null, 2);
    const json = parseRovodevMcpJson(fileContent, paths.relativeDirPath, paths.relativeFilePath);

    // The off-switch for disabled servers lives in the sibling `config.yml`
    // (written by `getAuxiliaryFiles`). When that file exists but cannot be
    // parsed, the toggle cannot be written — so a disabled server's runnable
    // definition must NOT be written either, or it would simply run
    // (fail-closed: restore the old skip for exactly those entries).
    let canWriteDisableToggle = true;
    try {
      await readRovodevConfigYaml({ outputRoot });
    } catch {
      canWriteDisableToggle = false;
    }

    // Use getMcpServers() (not getJson()) so rulesync-only fields and
    // codex-only fields (`envVars`) are stripped before writing the
    // rovodev config. `rovodevEnableInstructions` is stripped by that same
    // pass — it must not reach the other targets — so the unfiltered source is
    // read back here to recover it for the target that owns it, the way codex
    // recovers `envVars` and musecode recovers `musecodeMode`.
    const rawMcpServers = rulesyncMcp.getJson().mcpServers;
    const mcpServers = Object.fromEntries(
      Object.entries(rulesyncMcp.getMcpServers())
        .map(([name, server]) => {
          // `Object.hasOwn` before the lookup, matching `lookupTransport` and
          // the `fromFile` disabled overlay: a name must never resolve up the
          // prototype chain, however hard that is to reach from here.
          const rawServer =
            isRecord(rawMcpServers) && Object.hasOwn(rawMcpServers, name)
              ? rawMcpServers[name]
              : undefined;
          const record: Record<string, unknown> = {
            ...(server as Record<string, unknown>),
            // Both spellings are accepted in `.rulesync/mcp.json`: the
            // canonical camelCase key, and Rovo Dev's own `enable_instructions`
            // for anyone copying an entry straight out of Atlassian's docs.
            ...(readEnableInstructions(rawServer) && { rovodevEnableInstructions: true }),
          };
          if (record.disabled === true && !canWriteDisableToggle) {
            logger?.warn(
              `Rovo Dev MCP: skipping disabled server "${name}" because config.yml cannot be ` +
                `parsed, so mcp.disabledMcpServers cannot be written to switch it off.`,
            );
            return null;
          }
          const converted = toRovodevServer(name, record, logger);
          return converted === null ? null : ([name, converted] as const);
        })
        .filter((entry) => entry !== null),
    );

    warnEnabledInstructions(
      Object.entries(mcpServers)
        .filter(([, server]) => (server as Record<string, unknown>).enable_instructions === true)
        .map(([name]) => name),
      logger,
    );

    const rovodevConfig = { ...json, mcpServers };

    return new RovodevMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(rovodevConfig, null, 2),
      validate,
      global,
    });
  }

  /**
   * `mcp.disabledMcpServers` lives in the shared `config.yml` the permissions
   * feature also writes. Declared here so the write-order derivation sees this
   * feature as one of that file's writers — it is not a settable path, since
   * the servers themselves live in `mcp.json`.
   */
  static getExtraSharedWritePaths(): SharedWritePath[] {
    return [{ relativeDirPath: ROVODEV_DIR, relativeFilePath: ROVODEV_CONFIG_FILE_NAME }];
  }

  static override async getAuxiliaryFiles({
    outputRoot = process.cwd(),
    global = false,
    rulesyncMcp,
    logger,
  }: {
    outputRoot?: string;
    global?: boolean;
    rulesyncMcp: RulesyncMcp;
    logger?: Logger;
  }): Promise<ToolFile[]> {
    const targeted = rulesyncMcp.forTarget({ toolTarget: "rovodev", logger });
    const servers = targeted.getMcpServers();
    // Only servers whose entry is actually emitted to `mcp.json` count as
    // managed here: one with an unsupported transport (`ws`) is skipped by
    // `toRovodevServer`, so its name must neither gain a stale toggle nor
    // strip a same-named user-authored entry from the existing disabled list.
    const managedNames = Object.keys(servers).filter(
      (name) => toRovodevServer(name, servers[name] as Record<string, unknown>) !== null,
    );
    const disabledNames = managedNames.filter((name) => {
      const server = servers[name];
      return isRecord(server) && server.disabled === true;
    });

    const configPath = join(outputRoot, ROVODEV_DIR, ROVODEV_CONFIG_FILE_NAME);
    const existingContent = (await readFileContentOrNull(configPath)) ?? "";
    let existingParsed: Record<string, unknown>;
    try {
      existingParsed = parseSharedConfig({
        format: "yaml",
        fileContent: existingContent,
        filePath: join(ROVODEV_DIR, ROVODEV_CONFIG_FILE_NAME),
      });
    } catch (error) {
      // Skip only this file: the servers in `mcp.json` must still be written
      // even when a hand-edited `config.yml` cannot be parsed.
      logger?.warn(`Skipping the Rovo Dev mcp.disabledMcpServers update: ${formatError(error)}`);
      return [];
    }

    const existingMcp = isRecord(existingParsed.mcp) ? { ...existingParsed.mcp } : {};
    const existingDisabled = isStringArray(existingMcp.disabledMcpServers)
      ? existingMcp.disabledMcpServers
      : [];
    // rulesync owns the toggle for the servers it manages; names it does not
    // manage keep their existing state. Because removal flips an off-switch,
    // a managed name that was disabled on disk but is enabled canonically is
    // called out rather than silently re-enabled.
    const managedNameSet = new Set(managedNames);
    const reEnabled = existingDisabled.filter(
      (name) => managedNameSet.has(name) && !disabledNames.includes(name),
    );
    if (reEnabled.length > 0) {
      logger?.warn(
        `Rovo Dev MCP: re-enabling ${reEnabled.join(", ")} — the canonical config does not mark ` +
          `${reEnabled.length === 1 ? "it" : "them"} disabled. Set "disabled": true in ` +
          `.rulesync/mcp.jsonc to keep a managed server off.`,
      );
    }
    const mergedDisabled = [
      ...existingDisabled.filter((name) => !managedNameSet.has(name)),
      ...disabledNames,
    ].toSorted();

    if (mergedDisabled.length > 0) {
      existingMcp.disabledMcpServers = mergedDisabled;
    } else {
      delete existingMcp.disabledMcpServers;
    }

    // What the pointer has to be worth: a server Rovo Dev can actually start.
    // A name rulesync just switched off through `disabledMcpServers` does not
    // count, and neither does an entry with no endpoint at all — the canonical
    // schema does not require `command`/`url`, so an entry naming only its
    // targets reaches this far and would otherwise be enough to take the
    // project off the global MCP config in exchange for nothing.
    const liveNames = managedNames.filter((name) => {
      if (disabledNames.includes(name)) {
        return false;
      }
      const server = servers[name];
      return (
        isRecord(server) &&
        MCP_SERVER_ENDPOINT_KEYS.some((endpointKey) => server[endpointKey] !== undefined)
      );
    });

    const wrotePointer = await applyMcpConfigPointer({
      existingMcp,
      global,
      hasLiveServers: liveNames.length > 0,
      outputRoot,
      logger,
    });

    // Nothing to write and nothing to clean up: do not create or touch the
    // shared config just to hold an empty block.
    if (mergedDisabled.length === 0 && !wrotePointer && existingContent.trim() === "") {
      return [];
    }

    const fileContent = applySharedConfigPatch({
      fileKey: ROVODEV_CONFIG_SHARED_FILE_KEY,
      feature: "mcp",
      existingContent,
      patch: { mcp: Object.keys(existingMcp).length > 0 ? existingMcp : undefined },
      filePath: join(ROVODEV_DIR, ROVODEV_CONFIG_FILE_NAME),
    });

    return [
      new RovodevMcpConfigYaml({
        outputRoot,
        relativeDirPath: ROVODEV_DIR,
        relativeFilePath: ROVODEV_CONFIG_FILE_NAME,
        fileContent,
        global,
      }),
    ];
  }

  toRulesyncMcp(): RulesyncMcp {
    const rawServers = isMcpServers(this.json.mcpServers) ? this.json.mcpServers : {};
    const mcpServers = Object.fromEntries(
      Object.entries(rawServers)
        // `isMcpServers` only checks the container, so a hand-written `null` or
        // scalar entry reaches here; skip it rather than destructure it.
        .filter(([, server]) => isPlainObject(server))
        .map(([name, server]) => [name, fromRovodevServer(server as Record<string, unknown>)]),
    );
    // Do not spread the full Rovodev JSON: future tool-specific top-level keys must not leak
    // into rulesync mcp.json (unlike Cursor, which intentionally preserves extra keys today).
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): RovodevMcp {
    return new RovodevMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}

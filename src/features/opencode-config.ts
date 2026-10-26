import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { OPENCODE_LAYOUT, type OpencodeLayout } from "../constants/opencode-paths.js";
import {
  fileExists,
  posixRelativePathEscapesRoot,
  readFileContentOrNull,
  resolvedRelativePath,
  toPosixPath,
} from "../utils/file.js";
import type { Logger } from "../utils/logger.js";
import { quoteValueForWarning } from "../utils/quote-value.js";
import { isRecord, isStringArray } from "../utils/type-guards.js";
import { parseSharedConfig } from "./shared/shared-config-gateway.js";

/**
 * Reads and parses the OpenCode config (`opencode.jsonc` preferred, then
 * `opencode.json`) from the project root (or `~/.config/opencode/` in global
 * mode), returning an empty object when no readable config object exists.
 *
 * OpenCode lets users define commands and agents inline in this config (under
 * the top-level `command` / `agent` keys) in addition to the Markdown files
 * under `.opencode/command/` and `.opencode/agent/`. This shared reader is the
 * entry point used to import those inline definitions.
 *
 * @see https://opencode.ai/docs/commands/#json
 * @see https://opencode.ai/docs/agents/#json
 */
export function getOpencodeConfigDir({
  outputRoot,
  global = false,
  layout = OPENCODE_LAYOUT,
}: {
  outputRoot: string;
  global?: boolean;
  layout?: OpencodeLayout;
}): string {
  return join(outputRoot, global ? layout.globalDir : layout.configDir);
}

export async function readOpencodeConfig({
  outputRoot,
  global = false,
  layout = OPENCODE_LAYOUT,
}: {
  outputRoot: string;
  global?: boolean;
  layout?: OpencodeLayout;
}): Promise<Record<string, unknown>> {
  const configDir = getOpencodeConfigDir({ outputRoot, global, layout });

  const fileContent =
    (await readFileContentOrNull(join(configDir, layout.jsoncFileName))) ??
    (await readFileContentOrNull(join(configDir, layout.jsonFileName)));

  if (!fileContent) {
    return {};
  }

  return parseSharedConfig({ format: "jsonc", fileContent });
}

/** One parsed OpenCode config file and the directory its relative paths resolve against. */
export type OpencodeConfigLayer = {
  /** Absolute directory holding the file. */
  configDir: string;
  config: Record<string, unknown>;
};

/** A `.opencode/` config file, with its path relative to `outputRoot` for messages. */
export type OpencodeDotDirConfigLayer = OpencodeConfigLayer & { relativeFilePath: string };

/**
 * Reads the project-scope config files OpenCode merges over the root
 * `opencode.json(c)`: `.opencode/opencode.json`, then `.opencode/opencode.jsonc`,
 * in the order OpenCode loads them (a later file wins). Returns an empty list
 * in global mode and for layouts without this location (MiMo Code).
 *
 * @see https://opencode.ai/docs/config/#precedence-order
 * @see https://github.com/anomalyco/opencode/blob/v1.19.3/packages/opencode/src/config/config.ts
 */
export async function readOpencodeDotDirConfigLayers({
  outputRoot,
  global = false,
  layout = OPENCODE_LAYOUT,
}: {
  outputRoot: string;
  global?: boolean;
  layout?: OpencodeLayout;
}): Promise<OpencodeDotDirConfigLayer[]> {
  if (global || !layout.readsDotDirConfig) {
    return [];
  }
  const configDir = join(outputRoot, layout.dir);
  const layers: OpencodeDotDirConfigLayer[] = [];
  for (const fileName of [layout.jsonFileName, layout.jsoncFileName]) {
    const fileContent = await readFileContentOrNull(join(configDir, fileName));
    if (fileContent === null) {
      continue;
    }
    layers.push({
      relativeFilePath: join(layout.dir, fileName),
      configDir,
      config: parseSharedConfig({ format: "jsonc", fileContent }),
    });
  }
  return layers;
}

/**
 * Reads every OpenCode config file that applies at this scope, lowest
 * precedence first: the root config (see {@link readOpencodeConfig}), then the
 * `.opencode/` files (see {@link readOpencodeDotDirConfigLayers}).
 */
export async function readOpencodeConfigLayers({
  outputRoot,
  global = false,
  layout = OPENCODE_LAYOUT,
}: {
  outputRoot: string;
  global?: boolean;
  layout?: OpencodeLayout;
}): Promise<OpencodeConfigLayer[]> {
  return [
    {
      configDir: getOpencodeConfigDir({ outputRoot, global, layout }),
      config: await readOpencodeConfig({ outputRoot, global, layout }),
    },
    ...(await readOpencodeDotDirConfigLayers({ outputRoot, global, layout })),
  ];
}

/**
 * Deep-merges `source` over `target` the way OpenCode merges its config files
 * (remeda's `mergeDeep`): plain objects merge key by key, and any other value —
 * arrays included — replaces the target's.
 */
export function mergeOpencodeConfigValues(target: unknown, source: unknown): unknown {
  if (!isRecord(target) || !isRecord(source)) {
    return source;
  }
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(target)) {
    setOwnEntry(merged, key, value);
  }
  for (const [key, value] of Object.entries(source)) {
    setOwnEntry(
      merged,
      key,
      Object.hasOwn(target, key) ? mergeOpencodeConfigValues(target[key], value) : value,
    );
  }
  return merged;
}

/**
 * Merges per-file entry maps (the `command` or `agent` entries of each config
 * layer, lowest precedence first) into one, as OpenCode does. Returns `null`
 * when no layer has entries.
 */
export function mergeOpencodeEntryLayers(
  layers: Array<Record<string, unknown> | null>,
): Record<string, unknown> | null {
  let merged: Record<string, unknown> | null = null;
  for (const entries of layers) {
    if (entries === null) {
      continue;
    }
    const next = mergeOpencodeConfigValues(merged ?? {}, entries);
    merged = isRecord(next) ? next : merged;
  }
  return merged;
}

/**
 * Warns when a `.opencode/opencode.json(c)` file sets entries that the
 * generated root config also sets. OpenCode merges those files over the root
 * config, so their entries win and the generated ones never take effect.
 *
 * `generated` maps each top-level key rulesync writes (`mcp`, `permission`) to
 * its generated value. `overlays` are the `.opencode/` layers, already lowered
 * by the caller where needed.
 */
export function warnOpencodeDotDirOverrides({
  generated,
  overlays,
  rootFileName,
  logger,
}: {
  generated: Record<string, unknown>;
  overlays: OpencodeDotDirConfigLayer[];
  rootFileName: string;
  logger?: Logger;
}): void {
  if (!logger) {
    return;
  }
  for (const overlay of overlays) {
    const overridden: string[] = [];
    for (const [key, value] of Object.entries(generated)) {
      if (value === undefined || !Object.hasOwn(overlay.config, key)) {
        continue;
      }
      const overlayValue = overlay.config[key];
      if (!isRecord(value) || !isRecord(overlayValue)) {
        overridden.push(`"${key}"`);
        continue;
      }
      for (const name of Object.keys(value)) {
        if (Object.hasOwn(overlayValue, name)) {
          overridden.push(`"${key}" > ${quoteValueForWarning(name)}`);
        }
      }
    }
    if (overridden.length > 0) {
      logger.warn(
        `OpenCode merges "${toPosixPath(overlay.relativeFilePath)}" over the generated ` +
          `"${rootFileName}", so its values for these generated entries take precedence: ` +
          `${overridden.join(", ")}.`,
      );
    }
  }
}

/**
 * Narrows an unknown value to a plain record of entries keyed by name, as used
 * for OpenCode's `command` / `agent` config sections. Returns `null` when the
 * value is not a usable object.
 */
export function asOpencodeEntries(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * Lowers an OpenCode V2 model selection — `"provider/model"`, optionally with a
 * `#variant` suffix, or `{ providerID, model, variant }` — into V1's separate
 * `model` / `variant` fields. Returns an empty object for anything else.
 */
function lowerOpencodeV2ModelSelection(value: unknown): { model?: string; variant?: string } {
  if (typeof value === "string") {
    const index = value.indexOf("#");
    if (index === -1) {
      return { model: value };
    }
    const variant = value.slice(index + 1);
    return { model: value.slice(0, index), ...(variant !== "" && { variant }) };
  }
  const selection = asOpencodeEntries(value);
  if (
    selection === null ||
    typeof selection.providerID !== "string" ||
    typeof selection.model !== "string"
  ) {
    return {};
  }
  return {
    model: `${selection.providerID}/${selection.model}`,
    ...(typeof selection.variant === "string" && { variant: selection.variant }),
  };
}

/**
 * Lowers one OpenCode V2 `agents` entry into the V1 `agent` entry shape, the
 * way OpenCode V1 itself does: `system` becomes `prompt`, `disabled` becomes
 * `disable`, `request.body` becomes `options`, and the model selection is split
 * into `model` / `variant`. Fields V1 cannot represent are dropped, as V1 does.
 * Unlike V1, fields are checked one by one rather than the whole entry being
 * validated, so a malformed field is skipped instead of dropping the entry.
 */
function lowerOpencodeV2Agent(entry: Record<string, unknown>): Record<string, unknown> {
  const request = asOpencodeEntries(entry.request);
  const body = request === null ? null : asOpencodeEntries(request.body);
  return {
    ...(typeof entry.description === "string" && { description: entry.description }),
    ...(typeof entry.mode === "string" && { mode: entry.mode }),
    ...(typeof entry.hidden === "boolean" && { hidden: entry.hidden }),
    ...(typeof entry.color === "string" && { color: entry.color }),
    ...(typeof entry.steps === "number" && { steps: entry.steps }),
    ...(typeof entry.system === "string" && { prompt: entry.system }),
    ...(typeof entry.disabled === "boolean" && { disable: entry.disabled }),
    ...lowerOpencodeV2ModelSelection(entry.model),
    ...(body !== null && { options: body }),
  };
}

/**
 * Merges the entries of a V1 config section (`agent` / `command`) with those
 * of its V2 plural spelling (`agents` / `commands`), lowering each V2 entry.
 * The V1 entry wins a name both define, and a V1 key that is present but not
 * an object disables the merge — both as OpenCode V1 resolves them.
 */
function mergeOpencodeV2Entries({
  config,
  legacyKey,
  pluralKey,
  lower,
}: {
  config: Record<string, unknown>;
  legacyKey: string;
  pluralKey: string;
  lower: (entry: Record<string, unknown>) => Record<string, unknown> | null;
}): Record<string, unknown> | null {
  const legacy = asOpencodeEntries(config[legacyKey]);
  const plural = asOpencodeEntries(config[pluralKey]);
  if (plural === null || (Object.hasOwn(config, legacyKey) && legacy === null)) {
    return legacy;
  }
  const merged: Record<string, unknown> = { ...legacy };
  for (const [name, value] of Object.entries(plural)) {
    const entry = asOpencodeEntries(value);
    const lowered = entry === null ? null : lower(entry);
    if (Object.hasOwn(merged, name) || lowered === null) {
      continue;
    }
    setOwnEntry(merged, name, lowered);
  }
  return Object.keys(merged).length > 0 ? merged : legacy;
}

/**
 * Sets `target[key]` as an own, enumerable property. A plain assignment to a
 * key named `__proto__` would set the prototype instead.
 */
export function setOwnEntry(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/**
 * Returns the inline agent entries of an OpenCode config in the V1 `agent`
 * shape. Since v1.18.24 OpenCode V1 also reads the V2 `agents` spelling and
 * lowers it, so a layout that does so (`readsV2ConfigSpellings`) gets those
 * entries too.
 *
 * @see https://github.com/anomalyco/opencode/blob/v1.18.35/packages/opencode/src/config/v2-compat.ts
 */
export function getOpencodeAgentEntries({
  config,
  layout = OPENCODE_LAYOUT,
}: {
  config: Record<string, unknown>;
  layout?: OpencodeLayout;
}): Record<string, unknown> | null {
  if (!layout.readsV2ConfigSpellings) {
    return asOpencodeEntries(config.agent);
  }
  return mergeOpencodeV2Entries({
    config,
    legacyKey: "agent",
    pluralKey: "agents",
    // OpenCode V2 itself reads an entry's `permissions`, so the V2 layout keeps
    // them next to the lowered fields (its importer raises the rest back).
    lower:
      layout.configVersion === "v2"
        ? (entry) => ({
            ...lowerOpencodeV2Agent(entry),
            ...(Array.isArray(entry.permissions) && { permissions: entry.permissions }),
          })
        : lowerOpencodeV2Agent,
  });
}

/**
 * Returns the inline command entries of an OpenCode config in the V1 `command`
 * shape, including V2 `commands` entries for a layout that reads them (see
 * `getOpencodeAgentEntries`). A V2 entry without a `template` is skipped, as
 * OpenCode V1 skips it; its model selection is split into `model` / `variant`.
 * Other fields are kept: V1 drops a V2 `subagent`, but rulesync reads it as
 * `subtask` everywhere (as V2 does), so it is left for the command importer.
 *
 * @see https://github.com/anomalyco/opencode/blob/v1.18.35/packages/opencode/src/config/v2-compat.ts
 */
export function getOpencodeCommandEntries({
  config,
  layout = OPENCODE_LAYOUT,
}: {
  config: Record<string, unknown>;
  layout?: OpencodeLayout;
}): Record<string, unknown> | null {
  if (!layout.readsV2ConfigSpellings) {
    return asOpencodeEntries(config.command);
  }
  return mergeOpencodeV2Entries({
    config,
    legacyKey: "command",
    pluralKey: "commands",
    lower: (entry) => {
      if (typeof entry.template !== "string") {
        return null;
      }
      const { model, ...rest } = entry;
      return { ...rest, ...lowerOpencodeV2ModelSelection(model) };
    },
  });
}

/**
 * Returns the `skills.paths` entries of an OpenCode config. For a layout that
 * reads V2 spellings, a flat V2 `skills` array is accepted too: its entries
 * that are not `http(s)://` URLs are the paths, as OpenCode V1 lowers them.
 *
 * @see https://github.com/anomalyco/opencode/blob/v1.18.35/packages/opencode/src/config/v2-compat.ts
 */
export function getOpencodeSkillPaths({
  config,
  layout = OPENCODE_LAYOUT,
}: {
  config: Record<string, unknown>;
  layout?: OpencodeLayout;
}): unknown[] {
  if (Array.isArray(config.skills)) {
    if (!layout.readsV2ConfigSpellings || !isStringArray(config.skills)) {
      return [];
    }
    return config.skills.filter((value) => !/^https?:\/\//i.test(value));
  }
  const skills = asOpencodeEntries(config.skills);
  return skills !== null && Array.isArray(skills.paths) ? skills.paths : [];
}

/**
 * Whether a record is itself an MCP server entry rather than a V2 container
 * (`mcp.servers`, `mcp.timeout`): a server — or a server literally named
 * `type` / `enabled` — carries a scalar `type` or `enabled`. Mirrors OpenCode
 * V1's `isDirectServer`.
 */
function isDirectOpencodeMcpServer(value: Record<string, unknown>): boolean {
  return ["type", "enabled"].some(
    (key) =>
      Object.hasOwn(value, key) &&
      (value[key] === null || typeof value[key] !== "object" || Array.isArray(value[key])),
  );
}

const OPENCODE_V2_TIMEOUT_KEYS = ["startup", "catalog", "execution"] as const;

/**
 * Whether an MCP server entry uses a V2-only per-server spelling, so that
 * OpenCode V1 lowers it: `disabled`, `codemode`, an object `timeout`, or a
 * snake_case `oauth` key.
 */
function isOpencodeV2NativeServer(value: Record<string, unknown>): boolean {
  const oauth = value.oauth;
  return (
    Object.hasOwn(value, "disabled") ||
    Object.hasOwn(value, "codemode") ||
    isRecord(value.timeout) ||
    (isRecord(oauth) &&
      ["client_id", "client_secret", "callback_port", "redirect_uri"].some((key) =>
        Object.hasOwn(oauth, key),
      ))
  );
}

/**
 * Lowers a V2 timeout object (`{ startup, catalog, execution }`) to V1's single
 * number, the way OpenCode V1 does: only a `catalog` equal to `execution`, with
 * no `startup`, has a V1 equivalent. Anything else — including a value that is
 * not a positive integer — is `undefined` (dropped).
 */
function lowerOpencodeV2Timeout(value: Record<string, unknown>): number | undefined {
  if (
    !hasPositiveIntegerTimeouts(value) ||
    value.startup !== undefined ||
    typeof value.catalog !== "number"
  ) {
    return undefined;
  }
  return value.catalog === value.execution ? value.catalog : undefined;
}

const OPENCODE_V2_OAUTH_KEYS: ReadonlyMap<string, string> = new Map([
  ["client_id", "clientId"],
  ["client_secret", "clientSecret"],
  ["callback_port", "callbackPort"],
  ["redirect_uri", "redirectUri"],
]);

/**
 * V2 `oauth` keys that have no V1 spelling. OpenCode V1 drops them when it
 * lowers a server, so they are dropped (and reported) here too rather than
 * being written back as a snake_case key among camelCase ones.
 */
const OPENCODE_V2_UNSUPPORTED_OAUTH_KEYS: ReadonlySet<string> = new Set([
  "auth_server_metadata_url",
]);

/**
 * Why a V2 value is not carried over: it has no V1 (and so no Rulesync)
 * equivalent, or it conflicts with a V1 value that wins — an `mcp.servers`
 * entry shadowed by a different flat entry of the same name, or a `disabled`
 * contradicting the server's own `enabled`.
 */
type OpencodeV2DropReason = "unsupported" | "conflict";

/**
 * Called with the dotted path (e.g. `mcp.servers.fs.timeout`) of a V2 value
 * that the lowering drops, so the caller can say so instead of the value
 * vanishing without a word.
 */
export type OpencodeV2DropReporter = (path: string, reason: OpencodeV2DropReason) => void;

function lowerOpencodeV2OAuth(
  oauth: Record<string, unknown>,
  path: string,
  onDropped?: OpencodeV2DropReporter,
): Record<string, unknown> {
  const lowered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(oauth)) {
    if (OPENCODE_V2_UNSUPPORTED_OAUTH_KEYS.has(key)) {
      onDropped?.(`${path}.${key}`, "unsupported");
      continue;
    }
    setOwnEntry(lowered, OPENCODE_V2_OAUTH_KEYS.get(key) ?? key, value);
  }
  return lowered;
}

/**
 * Lowers one V2-spelled MCP server entry to V1's shape, as OpenCode V1 does:
 * `disabled` becomes `enabled` (an explicit `enabled` wins), an object
 * `timeout` becomes a number or is dropped, and snake_case `oauth` keys become
 * camelCase. `codemode` is kept: Rulesync passes it through where V1 drops it.
 *
 * Like V1, only an entry that is a local or remote server is lowered, and one
 * whose `enabled` or `disabled` is not a boolean is left as it is. Unlike V1,
 * such an entry is not dropped but passed on, so the schema rejects it loudly.
 */
function lowerOpencodeV2Server(
  value: unknown,
  path: string,
  onDropped?: OpencodeV2DropReporter,
): unknown {
  if (
    !isRecord(value) ||
    (value.type !== "local" && value.type !== "remote") ||
    (Object.hasOwn(value, "enabled") && typeof value.enabled !== "boolean") ||
    (Object.hasOwn(value, "disabled") && typeof value.disabled !== "boolean")
  ) {
    return value;
  }
  const { disabled, timeout, ...rest } = value;
  const lowered: Record<string, unknown> = { ...rest };
  if (!Object.hasOwn(value, "enabled")) {
    lowered.enabled = disabled !== true;
  } else if (value.enabled === disabled) {
    // `enabled: true, disabled: true` contradict each other; like OpenCode V1,
    // keep the V1 `enabled` and report the V2 `disabled` it overrides.
    onDropped?.(`${path}.disabled`, "conflict");
  }
  const lowTimeout = isRecord(timeout) ? lowerOpencodeV2Timeout(timeout) : timeout;
  if (lowTimeout !== undefined) {
    lowered.timeout = lowTimeout;
  } else if (isRecord(timeout) && Object.keys(timeout).length > 0) {
    // OpenCode V1 reports such a timeout as unsupported too.
    onDropped?.(`${path}.timeout`, "unsupported");
  }
  if (isRecord(value.oauth)) {
    lowered.oauth = lowerOpencodeV2OAuth(value.oauth, `${path}.oauth`, onDropped);
  }
  return lowered;
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Whether each V2 timeout value a record carries is a positive integer. */
function hasPositiveIntegerTimeouts(value: Record<string, unknown>): boolean {
  return OPENCODE_V2_TIMEOUT_KEYS.every(
    (key) => value[key] === undefined || isPositiveInteger(value[key]),
  );
}

/**
 * Whether `mcp.timeout` is V2's global timeout object rather than a server
 * named `timeout`. As in OpenCode V1, each of its values must be a positive
 * integer; anything else is read as a server, which the schema then rejects.
 */
function isOpencodeV2GlobalTimeout(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    !isDirectOpencodeMcpServer(value) &&
    (Object.keys(value).length === 0 ||
      OPENCODE_V2_TIMEOUT_KEYS.some((key) => Object.hasOwn(value, key))) &&
    hasPositiveIntegerTimeouts(value)
  );
}

function getOpencodeV2McpEnvelope(mcp: Record<string, unknown>): Record<string, unknown> | null {
  const nested = mcp.servers;
  return isRecord(nested) && !isDirectOpencodeMcpServer(nested) ? nested : null;
}

/**
 * Returns the paths of the V2-only containers in an OpenCode `mcp` value that
 * a write in V1's flat shape does not keep: a non-empty `mcp.servers`
 * envelope, and a non-empty global `mcp.timeout`.
 */
export function findOpencodeV2McpContainers(mcp: unknown): string[] {
  if (!isRecord(mcp)) {
    return [];
  }
  const envelope = getOpencodeV2McpEnvelope(mcp);
  return [
    ...(envelope !== null && Object.keys(envelope).length > 0 ? ["mcp.servers"] : []),
    ...(isOpencodeV2GlobalTimeout(mcp.timeout) && Object.keys(mcp.timeout).length > 0
      ? ["mcp.timeout"]
      : []),
  ];
}

/**
 * Returns the non-empty V2 global `mcp.timeout` object of an OpenCode `mcp`
 * value, or `undefined` when there is none.
 */
export function getOpencodeV2GlobalMcpTimeout(mcp: unknown): Record<string, unknown> | undefined {
  return isRecord(mcp) && findOpencodeV2McpContainers(mcp).includes("mcp.timeout")
    ? (mcp.timeout as Record<string, unknown>)
    : undefined;
}

/**
 * Returns the raw entry an OpenCode `mcp` value holds for a server: the one
 * under the V2 `mcp.servers` envelope, or else the flat V1 entry.
 */
export function getOpencodeMcpServerEntry(mcp: unknown, name: string): unknown {
  if (!isRecord(mcp)) {
    return undefined;
  }
  const envelope = getOpencodeV2McpEnvelope(mcp);
  if (envelope !== null && Object.hasOwn(envelope, name)) {
    return envelope[name];
  }
  return Object.hasOwn(mcp, name) ? mcp[name] : undefined;
}

const OPENCODE_V1_TO_V2_OAUTH_KEYS: ReadonlyMap<string, string> = new Map(
  [...OPENCODE_V2_OAUTH_KEYS].map(([v2, v1]) => [v1, v2]),
);

/**
 * Raises one V1-shaped OpenCode MCP server (`local` or `remote`) to the V2
 * spelling — the inverse of {@link lowerOpencodeV2Server}:
 *
 * - `enabled` is dropped and `disabled: true` written only for a disabled server;
 * - a number `timeout` becomes `{ catalog, execution }`, and camelCase `oauth`
 *   keys become snake_case.
 *
 * Values Rulesync's canonical form cannot hold are taken from the entry the
 * file already has for the server (`existing`): its `timeout` object and its
 * `oauth` object are kept verbatim whenever lowering them gives back exactly
 * what the canonical server carries, so a V2 file survives import and
 * generate unchanged. When the canonical `timeout` differs, the existing
 * `startup` value is still kept.
 */
export function raiseOpencodeServerToV2(
  server: Record<string, unknown>,
  existing: unknown,
): Record<string, unknown> {
  const { enabled, timeout, oauth, ...rest } = server;
  const raised: Record<string, unknown> = { ...rest };
  if (enabled === false) {
    raised.disabled = true;
  }

  const existingTimeout =
    isRecord(existing) && isRecord(existing.timeout) ? existing.timeout : null;
  if (existingTimeout !== null && lowerOpencodeV2Timeout(existingTimeout) === timeout) {
    raised.timeout = existingTimeout;
  } else if (typeof timeout === "number") {
    // A changed canonical timeout replaces `catalog` and `execution`, the two
    // values it stands for; the existing `startup`, which it never carries, is
    // kept.
    const startup = existingTimeout?.startup;
    raised.timeout = {
      ...(startup !== undefined && { startup }),
      catalog: timeout,
      execution: timeout,
    };
  } else if (timeout !== undefined) {
    raised.timeout = timeout;
  }

  const existingOauth = isRecord(existing) && isRecord(existing.oauth) ? existing.oauth : null;
  if (
    existingOauth !== null &&
    isRecord(oauth) &&
    isDeepStrictEqual(lowerOpencodeV2OAuth(existingOauth, ""), oauth)
  ) {
    raised.oauth = existingOauth;
  } else if (isRecord(oauth)) {
    const snakeOauth: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(oauth)) {
      setOwnEntry(snakeOauth, OPENCODE_V1_TO_V2_OAUTH_KEYS.get(key) ?? key, value);
    }
    raised.oauth = snakeOauth;
  } else if (oauth !== undefined) {
    raised.oauth = oauth;
  }
  return raised;
}

/**
 * Lowers OpenCode V2 `mcp` spellings found in a V1 config to the flat V1 map,
 * the way OpenCode V1 itself does since v1.18.24 (`normalizeMcp`):
 *
 * - entries of the `mcp.servers` envelope are merged into the map, a flat entry
 *   of the same name winning;
 * - V2-spelled server entries (`disabled`, an object `timeout`, snake_case
 *   `oauth` keys) are lowered by {@link lowerOpencodeV2Server};
 * - the global `mcp.timeout` object is skipped. V1 moves it to
 *   `experimental.mcp_timeout`, a default request timeout that has no
 *   canonical counterpart, so it is not read as a server either.
 *
 * Unlike V1, an envelope entry that is not a valid server is not dropped: it
 * is passed on, so the schema rejects it loudly rather than it vanishing
 * without a word. Each value that is dropped — a non-empty global timeout, a
 * per-server timeout object or `oauth` key with no V1 equivalent, or an
 * envelope entry shadowed by a different flat entry — is reported through
 * `onDropped`.
 *
 * @see https://github.com/anomalyco/opencode/blob/v1.18.35/packages/opencode/src/config/v2-compat.ts
 * @see https://opencode.ai/v2/docs/mcp-servers/
 */
export function lowerOpencodeV2Mcp(mcp: unknown, onDropped?: OpencodeV2DropReporter): unknown {
  if (!isRecord(mcp)) {
    return mcp;
  }
  const envelope = getOpencodeV2McpEnvelope(mcp);
  const globalTimeout = isOpencodeV2GlobalTimeout(mcp.timeout);
  if (findOpencodeV2McpContainers(mcp).includes("mcp.timeout")) {
    onDropped?.("mcp.timeout", "unsupported");
  }

  const servers: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(mcp)) {
    if ((name === "servers" && envelope !== null) || (name === "timeout" && globalTimeout)) {
      continue;
    }
    const native = isRecord(value) && isOpencodeV2NativeServer(value);
    setOwnEntry(
      servers,
      name,
      native ? lowerOpencodeV2Server(value, `mcp.${name}`, onDropped) : value,
    );
  }
  for (const [name, value] of Object.entries(envelope ?? {})) {
    const path = `mcp.servers.${name}`;
    if (Object.hasOwn(servers, name)) {
      if (!isDeepStrictEqual(servers[name], value)) {
        onDropped?.(path, "conflict");
      }
      continue;
    }
    setOwnEntry(servers, name, lowerOpencodeV2Server(value, path, onDropped));
  }
  return servers;
}

/** Matches a string whose entire value is an OpenCode `{file:...}` reference. */
/** One entry of OpenCode V2's ordered `permissions` array. */
export type OpencodeV2PermissionRule = { action: string; resource: string; effect: string };

/**
 * OpenCode V1 permission keys that V2 renamed, as OpenCode V2's own V1 config
 * compatibility pass translates them (`write`/`patch` fold into `edit`).
 *
 * @see https://opencode.ai/v2/docs/migrate-v1/
 */
const OPENCODE_V1_TO_V2_PERMISSION_ACTIONS: Record<string, string> = {
  bash: "shell",
  task: "subagent",
  write: "edit",
  patch: "edit",
};

function toOpencodeV2PermissionAction(v1Key: string): string {
  return Object.hasOwn(OPENCODE_V1_TO_V2_PERMISSION_ACTIONS, v1Key)
    ? OPENCODE_V1_TO_V2_PERMISSION_ACTIONS[v1Key]!
    : v1Key;
}

/**
 * Flattens an OpenCode V1 `permission` map into OpenCode V2's ordered
 * `permissions` array the way OpenCode V2 reads a V1 map itself: keys in
 * object order, each key's patterns in order, a bare action applying to `*`.
 * The generated rules therefore keep the V1 map's last-match-wins semantics.
 */
export function toOpencodeV2PermissionRules(
  permission: Record<string, string | Record<string, string>>,
): OpencodeV2PermissionRule[] {
  return Object.entries(permission).flatMap(([key, value]) => {
    const action = toOpencodeV2PermissionAction(key);
    if (typeof value === "string") {
      return [{ action, resource: "*", effect: value }];
    }
    return Object.entries(value).map(([resource, effect]) => ({ action, resource, effect }));
  });
}

/**
 * Agent fields only OpenCode V1 knows. OpenCode V2 reads an agent entry or
 * Markdown frontmatter carrying any of them (`name` included) as a V1 entry
 * and translates it, ignoring the V2 fields next to them, so an entry written
 * for V2 must carry none of them.
 */
const OPENCODE_V1_ONLY_AGENT_KEYS = [
  "name",
  "prompt",
  "disable",
  "maxSteps",
  "variant",
  "temperature",
  "top_p",
  "options",
  "tools",
  "permission",
] as const;

const OPENCODE_V2_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * The V1 `tools` toggles and `permission` of an agent as V2 permission rules:
 * one rule per tool toggle (`write` / `patch` fold into `edit`), followed by
 * the flattened `permission` map (a bare string applies to every action).
 * Unlike a per-key merge, which would leave a `permission` value at its tool
 * toggle's earlier position where a later broad rule could override it, this
 * keeps every `permission` rule after the toggles, so the result is never
 * looser than the `permission` map read on its own.
 */
function toOpencodeV2AgentPermissionRules({
  tools,
  permission,
}: {
  tools: unknown;
  permission: unknown;
}): OpencodeV2PermissionRule[] {
  const toggleRules: OpencodeV2PermissionRule[] = isRecord(tools)
    ? Object.entries(tools).flatMap(([tool, enabled]) =>
        typeof enabled === "boolean"
          ? [
              {
                action: toOpencodeV2PermissionAction(tool),
                resource: "*",
                effect: enabled ? "allow" : "deny",
              },
            ]
          : [],
      )
    : [];
  const permissionMap = typeof permission === "string" ? { "*": permission } : permission;
  const flatPermission: Record<string, string | Record<string, string>> = {};
  if (isRecord(permissionMap)) {
    for (const [key, value] of Object.entries(permissionMap)) {
      if (typeof value === "string") {
        setOwnEntry(flatPermission, key, value);
      } else if (isRecord(value)) {
        const patterns: Record<string, string> = {};
        for (const [pattern, effect] of Object.entries(value)) {
          if (typeof effect === "string") setOwnEntry(patterns, pattern, effect);
        }
        setOwnEntry(flatPermission, key, patterns);
      }
    }
  }
  const permissionRules = toOpencodeV2PermissionRules(flatPermission);
  return [...toggleRules, ...permissionRules];
}

/**
 * Moves the scalar V1 agent fields of `legacy` into their V2 spelling on
 * `raised` (see {@link raiseOpencodeAgentToV2}). A V2 field already present
 * wins over its V1 spelling.
 */
function raiseOpencodeAgentScalarsToV2({
  legacy,
  raised,
}: {
  legacy: Record<string, unknown>;
  raised: Record<string, unknown>;
}): void {
  if (typeof legacy.variant === "string" && legacy.variant !== "") {
    if (typeof raised.model === "string" && !raised.model.includes("#")) {
      raised.model = `${raised.model}#${legacy.variant}`;
    }
  }
  if (typeof legacy.prompt === "string" && raised.system === undefined) {
    raised.system = legacy.prompt;
  }
  if (typeof legacy.disable === "boolean" && raised.disabled === undefined) {
    raised.disabled = legacy.disable;
  }
  if (legacy.maxSteps !== undefined && raised.steps === undefined) {
    raised.steps = legacy.maxSteps;
  }
  if (typeof raised.color === "string" && !OPENCODE_V2_COLOR_PATTERN.test(raised.color)) {
    delete raised.color;
  }
}

/**
 * Raises OpenCode V1 agent fields (an `opencode.json` agent entry or Markdown
 * agent frontmatter) to the V2 spelling, mirroring OpenCode V2's own V1 agent
 * translation: `prompt` → `system`, `disable` → `disabled`, `maxSteps` →
 * `steps`, `variant` joined onto `model` as `provider/model#variant`,
 * `temperature` / `top_p` / `options` under `request.body`, and `tools` /
 * `permission` → a `permissions` array placed before any existing V2 rules.
 * `name` is dropped (V2 takes the ID from the file name or the entry key), as
 * is a `color` that is not a six-digit hex value (V2 accepts only those).
 * Fields that are already V2, and fields V2 shares with V1, pass through.
 *
 * @see https://opencode.ai/v2/docs/agents/
 * @see https://opencode.ai/v2/docs/migrate-v1/
 */
export function raiseOpencodeAgentToV2(fields: Record<string, unknown>): Record<string, unknown> {
  const legacy: Record<string, unknown> = {};
  const raised: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    const target = (OPENCODE_V1_ONLY_AGENT_KEYS as readonly string[]).includes(key)
      ? legacy
      : raised;
    setOwnEntry(target, key, value);
  }

  raiseOpencodeAgentScalarsToV2({ legacy, raised });

  const body: Record<string, unknown> = {
    ...(isRecord(legacy.options) ? legacy.options : {}),
    ...(legacy.temperature !== undefined && { temperature: legacy.temperature }),
    ...(legacy.top_p !== undefined && { top_p: legacy.top_p }),
  };
  if (Object.keys(body).length > 0) {
    const request = isRecord(raised.request) ? raised.request : {};
    raised.request = {
      ...request,
      body: { ...body, ...(isRecord(request.body) ? request.body : {}) },
    };
  }

  const rules = toOpencodeV2AgentPermissionRules({
    tools: legacy.tools,
    permission: legacy.permission,
  });
  if (rules.length > 0) {
    raised.permissions = [
      ...rules,
      ...(Array.isArray(raised.permissions) ? raised.permissions : []),
    ];
  }
  return raised;
}

const OPENCODE_FILE_TEMPLATE_PATTERN = /^\s*\{file:(.+?)\}\s*$/;

/**
 * Resolves an OpenCode `{file:./path}` string reference into the referenced
 * file's contents. OpenCode resolves these paths relative to the config file's
 * location, so `configDir` must be the directory holding `opencode.json`. When
 * the value is not a whole-value file reference it is returned unchanged; when
 * the referenced file cannot be read the literal value is preserved (so the
 * reference is not silently lost).
 *
 * When `containmentRoot` is given (project scope), a reference whose real
 * location — every `..` segment and symbolic link resolved — lies outside it is
 * not read and its literal value is preserved too, so importing an untrusted
 * checkout cannot copy an arbitrary file (credentials, say) into the project.
 * A `../` that stays inside the root (from `.opencode/opencode.json` up to the
 * project, say) is still followed. Global scope passes no root: a user config
 * may point anywhere the user chose. A refused reference to a file that exists
 * is reported through `logger`, naming `referrer` (the agent it belongs to).
 *
 * @see https://opencode.ai/docs/agents/
 */
export async function resolveOpencodeFileTemplate({
  value,
  configDir,
  containmentRoot,
  logger,
  referrer,
}: {
  value: string;
  configDir: string;
  containmentRoot?: string;
  logger?: Logger;
  referrer?: string;
}): Promise<string> {
  const match = OPENCODE_FILE_TEMPLATE_PATTERN.exec(value);
  if (!match) {
    return value;
  }

  const referencedPath = match[1]?.trim().replace(/^\.\//, "");
  if (!referencedPath) {
    return value;
  }

  const targetPath = join(configDir, referencedPath);
  if (containmentRoot === undefined) {
    return (await readFileContentOrNull(targetPath)) ?? value;
  }

  // The path that is read is the one that was checked: the real location,
  // taken relative to the real root once, rather than the spelled path, which
  // could be resolved differently between the check and the read.
  const relativePath = await resolvedRelativePath({ rootPath: containmentRoot, targetPath });
  if (posixRelativePathEscapesRoot(relativePath)) {
    // A missing file needs no warning: it would be kept literally anyway.
    if (await fileExists(targetPath)) {
      logger?.warn(
        `Kept the {file:...} prompt of ${referrer ?? "an OpenCode agent"} as literal text: ` +
          `${quoteValueForWarning(referencedPath)} resolves outside the project, so it was not read.`,
      );
    }
    return value;
  }
  const realRoot = await realpath(containmentRoot).catch(() => containmentRoot);
  return (await readFileContentOrNull(join(realRoot, relativePath))) ?? value;
}

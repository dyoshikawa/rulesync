import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { OPENCODE_LAYOUT, type OpencodeLayout } from "../constants/opencode-paths.js";
import { readFileContentOrNull } from "../utils/file.js";
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
function setOwnEntry(target: Record<string, unknown>, key: string, value: unknown): void {
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
    lower: lowerOpencodeV2Agent,
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
 * no `startup`, has a V1 equivalent. Anything else is `undefined` (dropped).
 */
function lowerOpencodeV2Timeout(value: Record<string, unknown>): number | undefined {
  if (value.startup !== undefined || typeof value.catalog !== "number") {
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
 * equivalent, or it is an `mcp.servers` entry shadowed by a different flat
 * entry of the same name.
 */
export type OpencodeV2DropReason = "unsupported" | "conflict";

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
    OPENCODE_V2_TIMEOUT_KEYS.every(
      (key) => value[key] === undefined || isPositiveInteger(value[key]),
    )
  );
}

function getOpencodeV2McpEnvelope(mcp: Record<string, unknown>): Record<string, unknown> | null {
  const nested = mcp.servers;
  return isRecord(nested) && !isDirectOpencodeMcpServer(nested) ? nested : null;
}

/**
 * Returns the paths of the V2-only containers in an OpenCode `mcp` value that
 * a write in V1's flat shape does not keep: the `mcp.servers` envelope, and a
 * non-empty global `mcp.timeout`.
 */
export function findOpencodeV2McpContainers(mcp: unknown): string[] {
  if (!isRecord(mcp)) {
    return [];
  }
  return [
    ...(getOpencodeV2McpEnvelope(mcp) !== null ? ["mcp.servers"] : []),
    ...(isOpencodeV2GlobalTimeout(mcp.timeout) && Object.keys(mcp.timeout).length > 0
      ? ["mcp.timeout"]
      : []),
  ];
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
const OPENCODE_FILE_TEMPLATE_PATTERN = /^\s*\{file:(.+?)\}\s*$/;

/**
 * Resolves an OpenCode `{file:./path}` string reference into the referenced
 * file's contents. OpenCode resolves these paths relative to the config file's
 * location, so `configDir` must be the directory holding `opencode.json`. When
 * the value is not a whole-value file reference it is returned unchanged; when
 * the referenced file cannot be read the literal value is preserved (so the
 * reference is not silently lost).
 *
 * @see https://opencode.ai/docs/agents/
 */
export async function resolveOpencodeFileTemplate({
  value,
  configDir,
}: {
  value: string;
  configDir: string;
}): Promise<string> {
  const match = OPENCODE_FILE_TEMPLATE_PATTERN.exec(value);
  if (!match) {
    return value;
  }

  const referencedPath = match[1]?.trim().replace(/^\.\//, "");
  if (!referencedPath) {
    return value;
  }

  return (await readFileContentOrNull(join(configDir, referencedPath))) ?? value;
}

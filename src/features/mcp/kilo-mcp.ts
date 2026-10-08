import { join } from "node:path";

import { uniq } from "es-toolkit";
import { parse as parseJsonc } from "jsonc-parser";
import { refine, z } from "zod/mini";

import {
  KILO_DIR,
  KILO_GLOBAL_DIR,
  KILO_RULES_DIR_NAME,
  KILO_JSON_FILE_NAME,
  KILO_JSONC_FILE_NAME,
} from "../../constants/kilo-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull, toPosixPath } from "../../utils/file.js";
import { parseJsonc as parseJsoncStrict } from "../../utils/jsonc.js";
import type { Logger } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";
import {
  findKiloMcpToolKeyOwner,
  isKiloPermissionPattern,
  kiloMcpToolPermissionKey,
} from "../shared/kilo-mcp-tool-keys.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import {
  convertEnvVarRefsFromToolFormat,
  convertEnvVarRefsToToolFormat,
  findServersWithEnvVarRefs,
  BRACE_ENV_VAR_PATTERN,
} from "./mcp-env-var-format.js";
import {
  declaresNoTransport,
  isRemoteMcpServer,
  type McpServerConfig,
  orphanMcpToolFiltersToRulesync,
  resolveLocalMcpCommand,
  resolveRemoteMcpUrl,
  splitMcpServersByTransport,
  warnAndSkipMcpServer,
} from "./mcp-transport.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

// Kilo MCP server schemas
// Kilo uses "local"/"remote" instead of "stdio"/"sse"/"http",
// "environment" instead of "env", and "enabled" instead of "disabled"

// Kilo OAuth config for remote servers.
// Per https://app.kilo.ai/config.json the `oauth` field is either an
// `McpOAuthConfig` object (clientId/clientSecret/scope/callbackPort/redirectUri)
// or the literal `false` to disable auto-detection. Modeled permissively with a
// looseObject so future fields round-trip unchanged.
const KiloMcpOAuthSchema = z.union([z.looseObject({}), z.literal(false)]);

// Kilo native format for local servers. `z.object`, not `looseObject`: an
// unmodeled key would be stripped on import and, since `mcp` is a key Rulesync
// owns and rewrites whole, deleted from kilo.jsonc on the next generate either
// way. Carrying such keys through both directions needs a namespaced
// passthrough like the OpenCode adapter's, which is its own change.
const KiloMcpLocalServerSchema = z.object({
  type: z.literal("local"),
  command: z.array(z.string()),
  environment: z.optional(z.record(z.string(), z.string())),
  enabled: z._default(z.boolean(), true),
  cwd: z.optional(z.string()),
  // Kilo documents `timeout` as a positive integer (milliseconds), but rulesync
  // preserves whatever value is already present so existing kilo.jsonc files
  // round-trip losslessly without the constructor's mandatory parse throwing.
  timeout: z.optional(z.number()),
});

// Kilo native format for remote servers. `z.object` for the same reason as the
// local schema above.
const KiloMcpRemoteServerSchema = z.object({
  type: z.literal("remote"),
  url: z.string(),
  headers: z.optional(z.record(z.string(), z.string())),
  enabled: z._default(z.boolean(), true),
  // See the local schema: documented as a positive integer (milliseconds), but
  // preserved as-is for lossless round-trip.
  timeout: z.optional(z.number()),
  oauth: z.optional(KiloMcpOAuthSchema),
});

// Every field of the two transport schemas except `enabled`, which is what a
// toggle is made of. Derived rather than listed: a field added to either schema
// and forgotten here would let a malformed entry carrying it be read as a
// toggle and written back stripped of that field.
const KILO_MCP_TRANSPORT_KEYS = [
  ...new Set([
    ...Object.keys(KiloMcpLocalServerSchema.def.shape),
    ...Object.keys(KiloMcpRemoteServerSchema.def.shape),
  ]),
].filter((key) => key !== "enabled");

/**
 * A bare toggle entry: `{"enabled": <bool>}` with no transport of its own,
 * disabling a server another config layer defines — the global config, a
 * marketplace, or a VS Code import. Kilo's own type is
 * `Record<string, Info | { enabled: boolean }>`; without this arm the union
 * rejects the entry and, because `kilo.jsonc` is the file the rules feature
 * writes too, the whole `--targets kilo` run aborts rather than just MCP.
 *
 * Loose, unlike the two transport arms, so a key Kilo adds to a toggle later
 * does not bring that abort back — but refined to reject anything carrying a
 * key only a transport entry has. A plain loose arm would sit under a malformed `local` or
 * `remote` entry that happens to carry `enabled` and swallow it, dropping its
 * command, URL, headers, or OAuth secrets without a word instead of failing the
 * way it does today.
 * @see https://github.com/Kilo-Org/kilocode/blob/main/packages/core/src/v1/config/config.ts
 */
const KiloMcpToggleSchema = z
  .looseObject({
    enabled: z.boolean(),
  })
  .check(
    refine(
      (entry) => KILO_MCP_TRANSPORT_KEYS.every((key) => !(key in entry)),
      'not a valid Kilo MCP server: expected a local server ({type: "local", command: [...]}), ' +
        'a remote server ({type: "remote", url: "..."}), or a bare toggle ({enabled: <bool>}) ' +
        "carrying no field of either",
    ),
  );

// Kilo MCP server schema (local, remote, or a toggle for a server defined elsewhere)
const KiloMcpServerSchema = z.union([
  KiloMcpLocalServerSchema,
  KiloMcpRemoteServerSchema,
  KiloMcpToggleSchema,
]);

// Use looseObject to allow additional properties like model, provider, agent,
// etc.
const KiloConfigSchema = z.looseObject({
  $schema: z.optional(z.string()),
  mcp: z.optional(z.record(z.string(), KiloMcpServerSchema)),
  // Legacy top-level tool map. Kilo folds it into `permission` through a v1
  // shim; rulesync now writes MCP tool filters as `permission` keys instead
  // and only reads this map on import.
  tools: z.optional(z.record(z.string(), z.boolean())),
  // Shared with the permissions feature (see kilo-permissions.ts), which
  // validates it. Left unconstrained here — Kilo also accepts a bare action
  // string — so a value this adapter does not model cannot abort the whole
  // Kilo generate; read sites narrow it.
  permission: z.optional(z.unknown()),
  // Project rule files/globs that Kilo auto-loads. Shared with the rules
  // feature (see kilo-rule.ts); preserved here so writing MCP never drops it.
  instructions: z.optional(z.array(z.string())),
  // Extra skill locations and remote skill manifest URLs configurable in
  // `kilo.jsonc`. Preserved here so writing MCP never drops them.
  // https://kilo.ai/docs/customize/skills
  skills: z.optional(
    z.looseObject({
      paths: z.optional(z.array(z.string())),
      urls: z.optional(z.array(z.string())),
    }),
  ),
});

type KiloConfig = z.infer<typeof KiloConfigSchema>;
type KiloMcpServer = z.infer<typeof KiloMcpServerSchema>;
type KiloMcpTransportServer =
  | z.infer<typeof KiloMcpLocalServerSchema>
  | z.infer<typeof KiloMcpRemoteServerSchema>;

/**
 * Tell the two transport arms from a toggle entry. Both carry a `type` literal
 * and a toggle never does — the schema refuses one that tries — but the toggle
 * arm is loose, so its index signature hides that from `in` narrowing.
 */
function isKiloTransportServer(server: KiloMcpServer): server is KiloMcpTransportServer {
  return server.type === "local" || server.type === "remote";
}

/**
 * Read a `permission` entry as an MCP tool filter. A scalar `allow`/`deny`, or
 * a pattern map stating only `"*"` (the shape Kilo itself saves), is a filter;
 * `ask` and narrower pattern maps have no `enabledTools`/`disabledTools`
 * equivalent and are left to the permissions feature.
 */
function kiloPermissionToToolFilter(value: unknown): boolean | undefined {
  const action =
    isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "*")
      ? value["*"]
      : value;
  if (action === "allow") return true;
  if (action === "deny") return false;
  return undefined;
}

/**
 * Fold the legacy `tools` map and the `permission` block into one tool-name to
 * enabled map. `permission` wins a key both state, which is the order Kilo's
 * own `tools` shim merges them in (`mergeDeep(tools, permission)`).
 * @see https://github.com/Kilo-Org/kilocode/blob/main/packages/opencode/src/config/config.ts
 */
function collectKiloToolFilters(
  tools: Record<string, boolean> | undefined,
  permission: Record<string, unknown> | undefined,
): Record<string, boolean> {
  const filters: Record<string, boolean> = { ...tools };
  for (const [key, value] of Object.entries(permission ?? {})) {
    if (isKiloPermissionPattern(key)) continue;
    const enabled = kiloPermissionToToolFilter(value);
    if (enabled !== undefined) {
      filters[key] = enabled;
    }
  }
  return filters;
}

/** Split the collected tool filters into this server's own two lists. */
function splitKiloServerTools(
  serverName: string,
  serverNames: readonly string[],
  tools: Record<string, boolean>,
): { enabledTools: string[]; disabledTools: string[] } {
  const enabledTools: string[] = [];
  const disabledTools: string[] = [];

  for (const [key, enabled] of Object.entries(tools)) {
    const owner = findKiloMcpToolKeyOwner(key, serverNames);
    if (owner?.serverName !== serverName) {
      continue;
    }
    (enabled ? enabledTools : disabledTools).push(owner.toolName);
  }
  return { enabledTools, disabledTools };
}

function kiloServerToRulesync(
  serverName: string,
  server: KiloMcpServer,
  { enabledTools, disabledTools }: { enabledTools: string[]; disabledTools: string[] },
): McpServers[string] {
  // Everything but `timeout`, which only the two transport arms carry — reading
  // it here would defeat the narrowing below and force a cast.
  const shared = {
    ...(server.enabled === false && { disabled: true }),
    ...(enabledTools.length > 0 && { enabledTools }),
    ...(disabledTools.length > 0 && { disabledTools }),
  };

  if (!isKiloTransportServer(server)) {
    // A toggle entry names a server another config layer defines, so there is
    // no transport to import — only its enabled state crosses over, and it
    // crosses over explicitly in both directions: the write side refuses to
    // switch a server on unless the canonical config says so in as many words.
    return { ...shared, disabled: server.enabled === false };
  }

  const withTimeout = {
    ...shared,
    ...(server.timeout !== undefined && { timeout: server.timeout }),
  };

  if (server.type === "remote") {
    return {
      // Kilo's `remote` transport is transport-agnostic; SSE is deprecated by
      // the MCP spec (2025-03-26) in favor of Streamable HTTP, so import as
      // `http` rather than the legacy `sse`.
      type: "http" as const,
      url: server.url,
      ...(server.headers && { headers: server.headers }),
      ...(server.oauth !== undefined && { oauth: server.oauth }),
      ...withTimeout,
    };
  }

  const [command, ...args] = server.command;
  if (!command) {
    // `{type: "local", command: []}` is what Rulesync used to write for a
    // server that named no transport, so it is on disk in real projects.
    // Throwing here took the whole `import` run down — every later feature of
    // it — over an entry with nothing to import. Read it as the transport-less
    // server it is; the write side turns that back into a toggle.
    return withTimeout;
  }
  return {
    type: "stdio" as const,
    command,
    ...(args.length > 0 && { args }),
    ...(server.environment && { env: server.environment }),
    ...(server.cwd && { cwd: server.cwd }),
    ...withTimeout,
  };
}

/**
 * Convert Kilo native format back to standard MCP format
 * - type: "local" -> "stdio", "remote" -> "http"
 * - command (array) -> command (first element) + args (rest)
 * - environment -> env
 * - enabled -> disabled (inverted)
 * - `permission` `{server}_{tool}` keys and the legacy top-level tools map ->
 *   per-server enabledTools/disabledTools (strip server prefix)
 */
function convertFromKiloFormat(
  kiloMcp: Record<string, KiloMcpServer>,
  tools?: Record<string, boolean>,
  permission?: Record<string, unknown>,
): McpServers {
  const filters = collectKiloToolFilters(tools, permission);
  const serverNames = Object.keys(kiloMcp);
  return {
    ...Object.fromEntries(
      Object.entries(kiloMcp).map(([serverName, serverConfig]) => [
        serverName,
        kiloServerToRulesync(
          serverName,
          serverConfig,
          splitKiloServerTools(serverName, serverNames, filters),
        ),
      ]),
    ),
    // Only the legacy map: it holds nothing but tool toggles, whereas a
    // `permission` key naming no listed server (`external_directory`, ...) is
    // far more likely a built-in permission than a filter for an unlisted server.
    ...orphanMcpToolFiltersToRulesync(kiloMcp, tools),
  };
}

/**
 * Convert standard MCP format to Kilo native format
 * - type: "stdio" -> "local", "sse"/"http" -> "remote"
 * - command + args -> command (merged array)
 * - env -> environment
 * - disabled -> enabled (inverted)
 * - enabledTools/disabledTools -> `permission` keys `{server}_{tool}` ("allow"/"deny")
 */
/**
 * Collect a server's enabledTools/disabledTools into `permission` entries keyed
 * by Kilo's namespaced tool name. Mutates `permission` in place; a tool listed
 * in both lists ends up denied.
 * @see https://kilo.ai/docs/automate/mcp/using-in-kilo-code#auto-approve-tools
 */
function collectKiloServerToolPermissions(
  permission: Record<string, "allow" | "deny">,
  serverName: string,
  serverConfig: McpServerConfig,
): void {
  for (const tool of serverConfig.enabledTools ?? []) {
    const key = kiloMcpToolPermissionKey(serverName, tool);
    // Two servers can sanitize to the same key (`a.b` and `a_b`); a deny
    // another server already wrote must not be lifted by this allow.
    if (permission[key] !== "deny") {
      permission[key] = "allow";
    }
  }
  for (const tool of serverConfig.disabledTools ?? []) {
    permission[kiloMcpToolPermissionKey(serverName, tool)] = "deny";
  }
}

/** The only fields a bare toggle carries over; everything else needs a transport. */
const KILO_TOGGLE_KEPT_KEYS = new Set(["disabled", "enabledTools", "disabledTools"]);

/**
 * A toggle keeps nothing but its enabled state, so a transport-less server that
 * still carries `args`, `env`, or `headers` loses them here. Such an entry is
 * impossible to start — no command, no URL — so it is written as the toggle it
 * resembles rather than dropped, but the loss is said out loud.
 */
function warnAboutToggleDroppedKeys(
  serverName: string,
  serverConfig: McpServerConfig,
  logger?: Logger,
): void {
  const dropped = Object.keys(serverConfig).filter((key) => !KILO_TOGGLE_KEPT_KEYS.has(key));
  if (dropped.length === 0) {
    return;
  }
  logger?.warn(
    `Kilo MCP: "${serverName}" declares no transport, so it is written as a toggle entry and ` +
      `${dropped.toSorted().join(", ")} ${dropped.length === 1 ? "is" : "are"} dropped.`,
  );
}

/**
 * Convert a single rulesync MCP server into its Kilo native form (local, remote,
 * or a bare toggle for a server another config layer defines).
 */
function convertServerToKiloFormat(
  serverName: string,
  serverConfig: McpServerConfig,
  existingEntry: KiloMcpServer | undefined,
  logger?: Logger,
): KiloMcpServer | null {
  if (declaresNoTransport(serverConfig)) {
    if (serverConfig.disabled === undefined) {
      // A toggle overrides whatever the global config, a marketplace, or a VS
      // Code import says about a server of this name, so writing `enabled:
      // true` for a server that never asked to be enabled would switch back on
      // what the user turned off in that other layer. Only an explicit
      // `disabled` — which is what importing a toggle produces — is carried.
      if (existingEntry !== undefined && !isKiloTransportServer(existingEntry)) {
        // Dropping the entry would switch the server back on just as surely,
        // since Rulesync rewrites the whole `mcp` key. Leave the toggle the
        // file already carries exactly as it is.
        warnAboutToggleDroppedKeys(serverName, serverConfig, logger);
        return existingEntry;
      }
      return warnAndSkipMcpServer({
        toolName: "Kilo",
        serverName,
        reason: "no transport and no enabled state, so there is nothing to toggle",
        logger,
      });
    }
    warnAboutToggleDroppedKeys(serverName, serverConfig, logger);
    return { enabled: !serverConfig.disabled };
  }

  if (isRemoteMcpServer(serverConfig)) {
    const url = resolveRemoteMcpUrl(serverConfig);
    if (url === undefined) {
      return warnAndSkipMcpServer({
        toolName: "Kilo",
        serverName,
        reason: "a remote transport but no url",
        logger,
      });
    }
    // `oauth` is Kilo-specific (object | false) and carried through via the
    // rulesync MCP server's looseObject passthrough; it is not a declared field
    // on McpServerSchema. Parse rather than cast: a value of another shape
    // would be written out and then rejected by this adapter's own constructor
    // as it re-reads the file, failing the generate it is part of.
    const rawOauth = (serverConfig as { oauth?: unknown }).oauth;
    const oauth = KiloMcpOAuthSchema.safeParse(rawOauth);
    if (!oauth.success && rawOauth !== undefined) {
      logger?.warn(
        `Kilo MCP: dropping the oauth field of "${serverName}" because Kilo takes an object or false there.`,
      );
    }
    return {
      type: "remote",
      url,
      enabled: !serverConfig.disabled,
      ...(serverConfig.headers && { headers: serverConfig.headers }),
      ...(serverConfig.timeout !== undefined && { timeout: serverConfig.timeout }),
      ...(oauth.success && { oauth: oauth.data }),
    };
  }

  const commandArray = resolveLocalMcpCommand(serverConfig);
  if (commandArray.length === 0) {
    return warnAndSkipMcpServer({
      toolName: "Kilo",
      serverName,
      reason: "a local transport but no command",
      logger,
    });
  }

  return {
    type: "local",
    command: commandArray,
    enabled: !serverConfig.disabled,
    ...(serverConfig.env && { environment: serverConfig.env }),
    ...(serverConfig.cwd && { cwd: serverConfig.cwd }),
    ...(serverConfig.timeout !== undefined && { timeout: serverConfig.timeout }),
  };
}

/**
 * The `mcp` entries of an on-disk `kilo.jsonc` that this adapter can read. Each
 * is parsed on its own so a malformed sibling costs only itself, and a file
 * that is not an object at all costs nothing.
 */
function readExistingKiloMcpEntries(fileContent: string | null): Record<string, KiloMcpServer> {
  const parsed = parseJsonc(fileContent || "{}");
  const mcp = (parsed as { mcp?: unknown } | null)?.mcp;
  if (!isRecord(mcp)) {
    return {};
  }

  const entries: Record<string, KiloMcpServer> = {};
  for (const [serverName, entry] of Object.entries(mcp)) {
    const result = KiloMcpServerSchema.safeParse(entry);
    if (result.success) {
      entries[serverName] = result.data;
    }
  }
  return entries;
}

/**
 * A dropped deny loosens the config, so say so. The key is matched by name
 * prefix only, so it may also be a tool of a server defined in another Kilo
 * config layer, or no MCP tool at all.
 */
function warnAboutDroppedKiloToolDenies(
  keys: string[],
  block: "permission" | "tools",
  logger: Logger | undefined,
): void {
  if (keys.length === 0) return;
  logger?.warn(
    `Kilo MCP: removing '${block}' entries that denied tools of the MCP servers this config ` +
      `lists, because no disabledTools lists them anymore: ${keys.join(", ")}. To keep one ` +
      `denied, add it to its server's disabledTools, or to the 'kilo' permissions override ` +
      `when it is not one of these servers' tools.`,
  );
}

/**
 * Rebuild the managed tool keys of an existing `permission` value. Returns the
 * deep-merge patch for the block (`undefined` retracts it, `null` leaves it
 * untouched).
 */
function buildKiloToolPermissionPatch({
  existingPermission,
  isManagedToolKey,
  toolPermissions,
  logger,
}: {
  existingPermission: unknown;
  isManagedToolKey: (key: string) => boolean;
  toolPermissions: Record<string, "allow" | "deny">;
  logger?: Logger;
}): Record<string, unknown> | undefined | null {
  const hasToolPermissions = Object.keys(toolPermissions).length > 0;
  if (typeof existingPermission === "string") {
    // Kilo reads a bare action as `{"*": <action>}`; spell it out so adding
    // the tool keys does not replace the catch-all the user wrote.
    return hasToolPermissions ? { "*": existingPermission, ...toolPermissions } : null;
  }

  const existingEntries = Object.entries(isRecord(existingPermission) ? existingPermission : {});
  const retractedKeys = existingEntries
    .filter(
      ([key, value]) =>
        (value === "allow" || value === "deny") &&
        isManagedToolKey(key) &&
        !Object.hasOwn(toolPermissions, key),
    )
    .map(([key]) => key);
  const droppedDenies = existingEntries
    .filter(([key, value]) => value === "deny" && retractedKeys.includes(key))
    .map(([key]) => key);
  warnAboutDroppedKiloToolDenies(droppedDenies, "permission", logger);

  if (
    !hasToolPermissions &&
    existingEntries.length > 0 &&
    retractedKeys.length === existingEntries.length
  ) {
    // Every key was ours: retract the block rather than leave `{}` behind.
    return undefined;
  }
  const patch: Record<string, unknown> = {
    ...Object.fromEntries(retractedKeys.map((key) => [key, undefined])),
    ...toolPermissions,
  };
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Build the `permission` and `tools` parts of the MCP patch for `kilo.json`.
 *
 * MCP owns, per server it manages (the canonical servers plus every server the
 * file's `mcp` block lists, so the filters of a removed server go with it),
 * the scalar `allow`/`deny` permission keys naming one of that server's tools.
 * Those are rebuilt from the canonical filters; everything else in the block —
 * wildcard keys, `ask`, the `{"*": ...}` maps Kilo's "Approve Always" saves,
 * keys of other servers — is the user's or the permissions feature's and is
 * left in place. The same servers' entries are retracted from the legacy
 * `tools` map, which Kilo would otherwise fold in ahead of `permission`.
 */
function buildKiloMcpPermissionPatch({
  existing,
  managedServerNames,
  toolPermissions,
  logger,
}: {
  existing: Record<string, unknown>;
  managedServerNames: string[];
  toolPermissions: Record<string, "allow" | "deny">;
  logger?: Logger;
}): { permission?: unknown; tools?: Record<string, boolean> | undefined } {
  const isManagedToolKey = (key: string): boolean =>
    findKiloMcpToolKeyOwner(key, managedServerNames) !== undefined;

  const patch: { permission?: unknown; tools?: Record<string, boolean> | undefined } = {};

  const permission = buildKiloToolPermissionPatch({
    existingPermission: existing.permission,
    isManagedToolKey,
    toolPermissions,
    logger,
  });
  if (permission !== null) {
    patch.permission = permission;
  }

  const existingTools = Object.entries(isRecord(existing.tools) ? existing.tools : {});
  const keptTools: Record<string, boolean> = {};
  for (const [key, enabled] of existingTools) {
    if (!isManagedToolKey(key) && typeof enabled === "boolean") {
      keptTools[key] = enabled;
    }
  }
  // A `false` moved to a `permission` deny is migrated, not dropped.
  warnAboutDroppedKiloToolDenies(
    existingTools
      .filter(([key, enabled]) => {
        const owner = findKiloMcpToolKeyOwner(key, managedServerNames);
        return (
          enabled === false &&
          owner !== undefined &&
          toolPermissions[kiloMcpToolPermissionKey(owner.serverName, owner.toolName)] !== "deny"
        );
      })
      .map(([key]) => key),
    "tools",
    logger,
  );
  if (Object.keys(keptTools).length !== existingTools.length) {
    patch.tools = Object.keys(keptTools).length > 0 ? keptTools : undefined;
  }

  return patch;
}

// Kilo rejects any `{env:` in an untrusted (project) JSON config — Cursor's
// `${env:VAR}` included — so this is broader than `BRACE_ENV_VAR_PATTERN`.
const KILO_UNTRUSTED_ENV_REF_PATTERN = /\{env:[^}]+\}/;

/**
 * Judged on the entry as written, not the canonical server: fields the entry
 * drops (a toggle keeps only `enabled`) cannot make Kilo reject the file.
 */
function rejectUntrustedEnvRef(
  serverName: string,
  converted: KiloMcpServer | null,
  rejectEnvRefs: boolean,
  logger?: Logger,
): KiloMcpServer | null {
  if (!rejectEnvRefs || converted === null) {
    return converted;
  }
  if (!KILO_UNTRUSTED_ENV_REF_PATTERN.test(JSON.stringify(converted))) {
    return converted;
  }
  return warnAndSkipMcpServer({
    toolName: "Kilo",
    serverName,
    reason: "an {env:...} reference, which makes Kilo reject the whole project config",
    logger,
  });
}

function convertToKiloFormat(
  mcpServers: McpServers,
  existingMcp: Record<string, KiloMcpServer>,
  logger?: Logger,
  rejectEnvRefs = false,
): {
  mcp: Record<string, KiloMcpServer>;
  toolPermissions: Record<string, "allow" | "deny">;
} {
  const toolPermissions: Record<string, "allow" | "deny"> = {};

  const mcp = Object.fromEntries(
    Object.entries(mcpServers)
      .map(([serverName, serverConfig]) => {
        const converted = rejectUntrustedEnvRef(
          serverName,
          convertServerToKiloFormat(
            serverName,
            serverConfig,
            // Own properties only: a server named `constructor` would otherwise
            // resolve to something off `Object.prototype` and be mistaken for a
            // toggle already in the file.
            Object.hasOwn(existingMcp, serverName) ? existingMcp[serverName] : undefined,
            logger,
          ),
          rejectEnvRefs,
          logger,
        );
        // Collected whether or not an entry is written: a permission key is
        // keyed by server name and reaches servers `mcp` does not list at all,
        // so a filter turning off a dangerous tool of a server another config
        // layer defines must not be dropped along with the entry Kilo could
        // not have used anyway.
        collectKiloServerToolPermissions(toolPermissions, serverName, serverConfig);
        return converted === null ? null : ([serverName, converted] as const);
      })
      .filter((entry) => entry !== null),
  );

  return { mcp, toolPermissions };
}

/**
 * Kilo expands only `{env:VAR}`, never the canonical `${VAR}`, and only in a
 * trusted config: the global `~/.config/kilo/kilo.jsonc`. A project config is
 * untrusted, so any `{env:` in it makes Kilo drop the whole file (or, in MCP
 * headers, the server). In project scope canonical references are therefore
 * left as written — Kilo passes them through literally — with a warning (a
 * written entry already carrying `{env:` is skipped by `convertToKiloFormat`).
 * @see https://github.com/Kilo-Org/kilocode/blob/main/packages/opencode/src/config/variable.ts
 */
function resolveKiloEnvVarRefs({
  mcpServers,
  global,
  logger,
}: {
  mcpServers: McpServers;
  global: boolean;
  logger?: Logger;
}): McpServers {
  if (global) {
    return convertEnvVarRefsToToolFormat({ mcpServers, replacement: "{env:$1}" });
  }

  const serverNames = findServersWithEnvVarRefs(mcpServers);
  if (serverNames.length > 0) {
    logger?.warn(
      `Kilo MCP servers ${serverNames.map((name) => `"${name}"`).join(", ")} use environment ` +
        "variable references (${VAR}), which Kilo does not resolve in a project config; " +
        "they are written literally. Use global mode (~/.config/kilo/kilo.jsonc) to have " +
        "them expanded.",
    );
  }
  return mcpServers;
}

export class KiloMcp extends ToolMcp {
  private readonly json: KiloConfig;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = KiloConfigSchema.parse(parseJsonc(this.fileContent || "{}"));
  }

  getJson(): KiloConfig {
    return this.json;
  }

  /**
   * kilo.json may contain other settings, so it should not be deleted.
   */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      return {
        relativeDirPath: KILO_GLOBAL_DIR,
        relativeFilePath: KILO_JSON_FILE_NAME,
      };
    }
    return {
      relativeDirPath: ".",
      relativeFilePath: KILO_JSON_FILE_NAME,
    };
  }

  /**
   * Resolve the config file to import from, probing in priority order:
   *   1. project root `kilo.jsonc` / `kilo.json` (or the global `.config/kilo`
   *      directory in global mode), then
   *   2. the alternative project location `.kilo/kilo.jsonc` / `.kilo/kilo.json`.
   *
   * Kilo accepts project config at the root OR under `.kilo/` ("for a cleaner
   * setup"), so the import side probes both. The write side intentionally stays
   * at the root location returned by `getSettablePaths`.
   * https://kilo.ai/docs/automate/mcp/using-in-kilo-code
   */
  private static async resolveImportConfig({
    outputRoot,
    global,
  }: {
    outputRoot: string;
    global: boolean;
  }): Promise<{ fileContent: string | null; relativeDirPath: string; relativeFilePath: string }> {
    const rootDirPath = this.getSettablePaths({ global }).relativeDirPath;
    // The alternative `.kilo/` project location only applies to project scope.
    const candidateDirPaths = global ? [rootDirPath] : [rootDirPath, KILO_DIR];

    // Track the first existing-but-empty file so the empty-content path is
    // preserved (an existing empty `kilo.json` should be parsed as-is, matching
    // the previous root-only behavior, rather than silently defaulting to an
    // empty `mcp` object).
    let emptyFallback: { relativeDirPath: string; relativeFilePath: string } | null = null;

    for (const relativeDirPath of candidateDirPaths) {
      const jsonDir = join(outputRoot, relativeDirPath);

      // Always try JSONC first (preferred format), then fall back to JSON.
      for (const relativeFilePath of [KILO_JSONC_FILE_NAME, KILO_JSON_FILE_NAME]) {
        const content = await readFileContentOrNull(join(jsonDir, relativeFilePath));
        if (content === null) {
          continue;
        }
        if (content) {
          return { fileContent: content, relativeDirPath, relativeFilePath };
        }
        // Existing but empty file: remember the first one as a fallback.
        emptyFallback ??= { relativeDirPath, relativeFilePath };
      }
    }

    if (emptyFallback) {
      return {
        fileContent: "",
        relativeDirPath: emptyFallback.relativeDirPath,
        relativeFilePath: emptyFallback.relativeFilePath,
      };
    }

    return {
      fileContent: null,
      relativeDirPath: rootDirPath,
      relativeFilePath: KILO_JSONC_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<KiloMcp> {
    const { fileContent, relativeDirPath, relativeFilePath } = await this.resolveImportConfig({
      outputRoot,
      global,
    });

    const fileContentToUse = fileContent ?? '{"mcp":{}}';
    const json = parseJsonc(fileContentToUse);
    const newJson = { ...json, mcp: json.mcp ?? {} };

    return new KiloMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
    });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
    logger,
  }: ToolMcpFromRulesyncMcpParams): Promise<KiloMcp> {
    const basePaths = this.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);

    let fileContent: string | null = null;
    let relativeFilePath = KILO_JSONC_FILE_NAME;

    const jsoncPath = join(jsonDir, KILO_JSONC_FILE_NAME);
    const jsonPath = join(jsonDir, KILO_JSON_FILE_NAME);

    // Try JSONC first (preferred format), then fall back to JSON
    fileContent = await readFileContentOrNull(jsoncPath);
    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = KILO_JSON_FILE_NAME;
      }
    }

    // The `mcp` key is rewritten whole, so a toggle the canonical config states
    // nothing about is read from here to be written back unchanged. Entry by
    // entry, not file at once: one sibling this adapter cannot parse must not
    // decide that every other server stays switched on.
    const existingMcp = readExistingKiloMcpEntries(fileContent);
    const parsedExisting: unknown = parseJsonc(fileContent || "{}");
    const existingDocument = isRecord(parsedExisting) ? parsedExisting : {};

    const mcpServers = rulesyncMcp.getMcpServers();
    const { mcp: convertedMcp, toolPermissions } = convertToKiloFormat(
      resolveKiloEnvVarRefs({ mcpServers, global, logger }),
      existingMcp,
      logger,
      // Kilo only expands `{env:` in the trusted global config.
      !global,
    );

    return new KiloMcp({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      // Keyed by the base settable paths: a resolved `.jsonc` twin shares the
      // `.json` ownership declaration. Tool filters go into `permission`, which
      // the permissions feature writes too, so that block is deep-merged.
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(basePaths),
        feature: "mcp",
        existingContent: fileContent ?? "",
        patch: {
          mcp: convertedMcp,
          ...buildKiloMcpPermissionPatch({
            existing: existingDocument,
            managedServerNames: uniq([
              ...Object.keys(mcpServers),
              ...Object.keys(isRecord(existingDocument.mcp) ? existingDocument.mcp : {}),
            ]),
            toolPermissions,
            logger,
          }),
        },
        filePath: join(jsonDir, relativeFilePath),
        logger,
      }),
      validate,
    });
  }

  /**
   * Merge a list of project rule file globs into the `instructions` array of the
   * shared `kilo.jsonc` (or `kilo.json`) config, preserving every existing key
   * (notably `mcp`/`permission` written by the MCP feature). In Kilo v7, files under
   * a *project* `.kilo/rules/` are NOT auto-loaded; they are only picked up
   * when listed in the `instructions` key. (The home-scope `~/.kilo/rules/` is
   * different — the rules migrator's `globalRulesDirs()` walks it on every
   * config load — which is why `KiloRule` registers instructions in project
   * scope only.) The resulting `instructions` list is deduped and sorted for a
   * stable output.
   *
   * @see https://kilo.ai/docs/automate/mcp/using-in-kilo-code
   */
  static async fromInstructions({
    outputRoot = process.cwd(),
    instructions,
    validate = true,
    global = false,
    logger,
  }: {
    outputRoot?: string;
    instructions: string[];
    validate?: boolean;
    global?: boolean;
    logger?: Logger;
  }): Promise<KiloMcp | null> {
    const basePaths = this.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);

    let fileContent: string | null = null;
    let relativeFilePath = KILO_JSONC_FILE_NAME;

    const jsoncPath = join(jsonDir, KILO_JSONC_FILE_NAME);
    const jsonPath = join(jsonDir, KILO_JSON_FILE_NAME);

    // Prefer kilo.jsonc, fall back to kilo.json, mirroring fromRulesyncMcp.
    fileContent = await readFileContentOrNull(jsoncPath);
    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = KILO_JSON_FILE_NAME;
      }
    }

    // Nothing to register and nothing to clean up: do not create the shared
    // config just to hold an empty payload.
    if (instructions.length === 0 && fileContent === null) {
      return null;
    }

    const json = fileContent ? parseJsonc(fileContent) : {};
    const existingInstructions: string[] = Array.isArray(json.instructions)
      ? json.instructions.filter((entry: unknown): entry is string => typeof entry === "string")
      : [];

    // rulesync owns the entries under its managed rules directory — rebuilt
    // from the current generate so deleted rules do not leave stale entries;
    // entries outside it are the user's and pass through verbatim. Project
    // scope only today (Kilo auto-discovers its global rules dir, so the
    // registrar never runs globally); a future global opt-in must not reuse
    // this project prefix.
    const managedPrefix = `${toPosixPath(join(KILO_DIR, KILO_RULES_DIR_NAME))}/`;
    const preservedInstructions = existingInstructions.filter(
      (entry) => !toPosixPath(entry).replace(/^\.\//, "").startsWith(managedPrefix),
    );

    const mergedInstructions = Array.from(
      new Set([...preservedInstructions, ...instructions]),
    ).toSorted();

    return new KiloMcp({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(basePaths),
        feature: "rules",
        existingContent: fileContent ?? "",
        // An emptied list retracts the key rather than writing `[]`.
        patch: { instructions: mergedInstructions.length > 0 ? mergedInstructions : undefined },
        filePath: join(jsonDir, relativeFilePath),
        logger,
      }),
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    // Kilo's `{env:VAR}` maps back to the canonical `${VAR}` so the Kilo-only
    // syntax does not leak into every other target's config.
    const convertedMcpServers = convertEnvVarRefsFromToolFormat({
      mcpServers: convertFromKiloFormat(
        this.json.mcp ?? {},
        this.json.tools,
        isRecord(this.json.permission) ? this.json.permission : undefined,
      ),
      pattern: BRACE_ENV_VAR_PATTERN,
    });
    // A transport-less server is a Kilo idea — a toggle for a server another
    // config layer defines, or a filter for one — so it goes in the block only
    // Kilo reads rather than into the shared map every other tool writes out.
    const { shared, toolOnly } = splitMcpServersByTransport(convertedMcpServers);
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify(
        {
          mcpServers: shared,
          ...(Object.keys(toolOnly).length > 0 && { kilo: { mcpServers: toolOnly } }),
        },
        null,
        2,
      ),
    });
  }

  validate(): ValidationResult {
    // Parse fileContent directly since this.json may not be initialized yet
    // when validate() is called from parent constructor
    // Strict JSONC rather than JSON: `kilo.json`/`kilo.jsonc` may carry the
    // user's comments, which the gateway preserves on write-back.
    const json = parseJsoncStrict(this.fileContent || "{}");
    const result = KiloConfigSchema.safeParse(json);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): KiloMcp {
    return new KiloMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}

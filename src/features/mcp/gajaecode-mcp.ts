import { GAJAECODE_LAYOUT } from "../../constants/gajaecode-paths.js";
import type { McpServers } from "../../types/mcp.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { isRecord } from "../../utils/type-guards.js";
import { OmpMcp } from "./omp-mcp.js";

/**
 * Keys `gjc mcp add` (and Gajae-Code's credential flow) stores on a server and
 * rulesync never writes unless the source states them: the credential binding
 * (`auth`: `credentialId`, `tokenUrl`, `clientId`, `clientSecret`) and the
 * OAuth client settings (`oauth`). They are carried over to a regenerated
 * server only while it still points at the same endpoint, and are never
 * imported, so a secret never lands in `.rulesync/mcp.json`.
 */
const CARRIED_OVER_SERVER_KEYS = ["auth", "oauth"] as const;

/**
 * Gajae-Code-only server keys that are not canonical rulesync keys. They are
 * rulesync-managed (written when the source states them, removed when it does
 * not), and import puts them in the `gajaecode.mcpServers` block rather than
 * the shared `mcpServers`, so other targets never receive them.
 */
const GAJAECODE_ONLY_SERVER_KEYS = ["autoload", "publicNetwork", "noInheritEnv"] as const;

/** The transport Gajae-Code uses for a server: `type`, else inferred from `url`. */
function resolveTransport(server: Record<string, unknown>): unknown {
  return server.type ?? (server.url !== undefined ? "http" : "stdio");
}

/**
 * Whether a regenerated server still reaches the same endpoint as the entry
 * already in the file, so the credential bound to that entry can stay.
 */
function isSameEndpoint(
  generated: Record<string, unknown>,
  existing: Record<string, unknown>,
): boolean {
  return (
    resolveTransport(generated) === resolveTransport(existing) &&
    generated.url === existing.url &&
    generated.command === existing.command &&
    JSON.stringify(generated.args ?? []) === JSON.stringify(existing.args ?? [])
  );
}

/**
 * MCP generator for **Gajae-Code** (`gjc`), a descendant of oh-my-pi with the
 * same `mcp.json` format (`mcpServers` keyed by name, `type` of `stdio` /
 * `http` / `sse`, `enabled: false` to switch a server off), so this target
 * reuses {@link OmpMcp} with the `.gjc` layout: `.gjc/mcp.json` (project) and
 * `~/.gjc/agent/mcp.json` (global).
 *
 * `gjc mcp add` writes into the same files in both scopes, so unlike oh-my-pi
 * the `mcpServers` map is merged rather than replaced:
 *
 * - A server rulesync generates replaces the entry of the same name. Only
 *   `auth` / `oauth` of that entry are kept, when the source does not state
 *   them and the server keeps its transport, `url`, `command` and `args`;
 *   pointing the server somewhere else drops them, so a stored credential is
 *   never sent to a different endpoint. Every other key follows the source.
 * - A server rulesync does not generate (added by `gjc mcp add` or by hand) is
 *   kept verbatim. Import reads every server back, so an import → generate
 *   round trip rewrites each entry in place instead of duplicating it. The flip
 *   side: removing a server from `.rulesync/mcp.json` does not remove it from
 *   `mcp.json`; remove it there too (`gjc mcp remove`).
 * - The file is never deleted, since it may hold such servers.
 *
 * `enabled: false` is derived from canonical `disabled`; `autoload: false`
 * (stored but not started at session start) is a separate Gajae-Code key set
 * under `gajaecode.mcpServers`.
 *
 * A project stdio server is started only when the user config sets
 * `mcp.enableProjectConfig: true`, and Gajae-Code does not expand
 * secret-named `${VAR}` references in project scope; both are Gajae-Code
 * settings rulesync leaves alone.
 *
 * @see https://github.com/Yeachan-Heo/gajae-code/blob/main/docs/standalone-mcp.md
 * @see https://github.com/Yeachan-Heo/gajae-code/blob/main/docs/customization.md
 */
export class GajaecodeMcp extends OmpMcp {
  protected static override readonly layout = GAJAECODE_LAYOUT;

  override isDeletable(): boolean {
    return false;
  }

  protected static override mergeMcpServers({
    generated,
    existing,
  }: {
    generated: Record<string, Record<string, unknown>>;
    existing: unknown;
  }): Record<string, unknown> {
    const existingServers = isRecord(existing) ? existing : {};
    const result: Record<string, unknown> = {};

    for (const [serverName, server] of Object.entries(generated)) {
      const prior = existingServers[serverName];
      const merged: Record<string, unknown> = { ...server };
      if (isRecord(prior) && isSameEndpoint(server, prior)) {
        for (const key of CARRIED_OVER_SERVER_KEYS) {
          if (!Object.hasOwn(server, key) && prior[key] !== undefined) {
            merged[key] = prior[key];
          }
        }
      }
      result[serverName] = merged;
    }

    for (const [serverName, server] of Object.entries(existingServers)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || Object.hasOwn(result, serverName)) continue;
      result[serverName] = server;
    }

    return result;
  }

  /**
   * Shared servers lose `auth` / `oauth` (they stay in `mcp.json`, carried over
   * on generate) and the Gajae-Code-only keys; a server that has any of the
   * latter is also written whole to `gajaecode.mcpServers`, which replaces the
   * shared entry for this target only.
   */
  protected override toRulesyncMcpJson(mcpServers: McpServers): Record<string, unknown> {
    const shared: McpServers = {};
    const scoped: McpServers = {};

    for (const [serverName, server] of Object.entries(mcpServers)) {
      const withoutSecrets = Object.fromEntries(
        Object.entries(server).filter(
          ([key]) => !(CARRIED_OVER_SERVER_KEYS as readonly string[]).includes(key),
        ),
      );
      const sharedServer = Object.fromEntries(
        Object.entries(withoutSecrets).filter(
          ([key]) => !(GAJAECODE_ONLY_SERVER_KEYS as readonly string[]).includes(key),
        ),
      );
      shared[serverName] = sharedServer;
      if (Object.keys(sharedServer).length !== Object.keys(withoutSecrets).length) {
        scoped[serverName] = withoutSecrets;
      }
    }

    return {
      mcpServers: shared,
      ...(Object.keys(scoped).length > 0 && { gajaecode: { mcpServers: scoped } }),
    };
  }
}

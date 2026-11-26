import { GAJAECODE_LAYOUT } from "../../constants/gajaecode-paths.js";
import { McpServerSchema } from "../../types/mcp.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { isRecord } from "../../utils/type-guards.js";
import { OmpMcp } from "./omp-mcp.js";

/**
 * Server keys whose value rulesync decides: the canonical keys plus `enabled`,
 * which the conversion derives from canonical `disabled`. Any other key of an
 * existing server (`autoload`, `auth`, `oauth`, `publicNetwork`,
 * `noInheritEnv`, ...) is Gajae-Code's own and is kept when rulesync does not
 * state it.
 */
const RULESYNC_OWNED_SERVER_KEYS = new Set([...Object.keys(McpServerSchema.def.shape), "enabled"]);

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
 * - A server rulesync generates replaces the entry of the same name, but keeps
 *   the existing entry's keys that rulesync neither models nor states
 *   (`autoload`, `auth`, ...).
 * - A server rulesync does not generate (added by `gjc mcp add` or by hand) is
 *   kept verbatim. Import reads every server back, so an import → generate
 *   round trip rewrites each entry in place instead of duplicating it. The flip
 *   side: removing a server from `.rulesync/mcp.json` does not remove it from
 *   `mcp.json`; remove it there too (`gjc mcp remove`).
 * - The file is never deleted, since it may hold such servers.
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
      const kept = isRecord(prior)
        ? Object.fromEntries(
            Object.entries(prior).filter(
              ([key]) =>
                !RULESYNC_OWNED_SERVER_KEYS.has(key) &&
                !PROTOTYPE_POLLUTION_KEYS.has(key) &&
                !Object.hasOwn(server, key),
            ),
          )
        : {};
      result[serverName] = { ...server, ...kept };
    }

    for (const [serverName, server] of Object.entries(existingServers)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || Object.hasOwn(result, serverName)) continue;
      result[serverName] = server;
    }

    return result;
  }
}

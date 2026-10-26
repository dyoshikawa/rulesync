import { uniq } from "es-toolkit";

/**
 * MCP tool naming shared by OpenCode and its forks (Kilo, MiMo Code):
 * `McpCatalog.toolName` joins the server and tool names with `_`, replacing
 * every character other than ASCII letters, digits, `_` and `-` with `_`, and
 * the joined name is the tool's permission key (V1) or action (OpenCode V2).
 *
 * @see https://github.com/anomalyco/opencode/blob/v1.19.4/packages/opencode/src/mcp/catalog.ts
 * @see https://github.com/Kilo-Org/kilocode/blob/main/packages/opencode/src/mcp/catalog.ts
 * @see https://opencode.ai/v2/docs/mcp-servers/
 */
export function sanitizeOpencodeMcpNamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * The permission key of one MCP tool. A `*` or `?` in the tool name is kept, so
 * a filter such as `disabledTools: ["*"]` stays the wildcard key `github_*`
 * the tool matches against every tool of the server, instead of turning into a
 * key that matches nothing.
 */
export function opencodeMcpToolPermissionKey(serverName: string, toolName: string): string {
  return `${sanitizeOpencodeMcpNamePart(serverName)}_${toolName.replace(/[^a-zA-Z0-9_\-*?]/g, "_")}`;
}

/**
 * The server among `serverNames` whose tool a permission key names, with the
 * tool part (which may be a wildcard such as `*`), or `undefined` when the key
 * is one of `builtinKeys` or names no listed server. The longest matching
 * prefix wins, so `github_enterprise_delete` belongs to `github_enterprise`
 * rather than to `github` when both are listed. With `acceptRawPrefix`, the raw
 * (unsanitized) `<server>_` prefix is recognized too.
 */
export function findOpencodeMcpToolKeyOwner({
  key,
  serverNames,
  builtinKeys,
  acceptRawPrefix = false,
}: {
  key: string;
  serverNames: readonly string[];
  builtinKeys: ReadonlySet<string>;
  acceptRawPrefix?: boolean;
}): { serverName: string; toolName: string } | undefined {
  if (builtinKeys.has(key)) {
    return undefined;
  }
  let owner: { serverName: string; prefix: string } | undefined;
  for (const serverName of serverNames) {
    const sanitized = `${sanitizeOpencodeMcpNamePart(serverName)}_`;
    const prefixes = acceptRawPrefix ? uniq([sanitized, `${serverName}_`]) : [sanitized];
    for (const prefix of prefixes) {
      if (
        key.length > prefix.length &&
        key.startsWith(prefix) &&
        (owner === undefined || prefix.length > owner.prefix.length)
      ) {
        owner = { serverName, prefix };
      }
    }
  }
  return owner && { serverName: owner.serverName, toolName: key.slice(owner.prefix.length) };
}

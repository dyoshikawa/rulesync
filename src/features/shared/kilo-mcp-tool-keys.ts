import { uniq } from "es-toolkit";

/**
 * Kilo's own permission names. A server whose name is a prefix of one of these
 * (`external` vs. `external_directory`) must not claim it as an MCP tool key.
 * @see https://github.com/Kilo-Org/kilocode/blob/main/packages/core/src/v1/config/permission.ts
 */
const KILO_BUILTIN_PERMISSION_KEYS: ReadonlySet<string> = new Set([
  "read",
  "edit",
  "glob",
  "grep",
  "list",
  "bash",
  "task",
  "external_directory",
  "markdown_source",
  "todowrite",
  "question",
  "webfetch",
  "websearch",
  "lsp",
  "doom_loop",
  "skill",
  "agent_manager",
  "notebook_read",
  "notebook_edit",
  "notebook_execute",
]);

/**
 * Kilo's own MCP tool naming: `McpCatalog.toolName` sanitizes both the server
 * and the tool name, so a permission key written with the raw names of a
 * server such as `my.server` would never match.
 * @see https://github.com/Kilo-Org/kilocode/blob/main/packages/opencode/src/mcp/catalog.ts
 */
function sanitizeKiloToolNamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function kiloMcpToolPermissionKey(serverName: string, toolName: string): string {
  return `${sanitizeKiloToolNamePart(serverName)}_${sanitizeKiloToolNamePart(toolName)}`;
}

/** Whether a Kilo permission key is a wildcard pattern rather than one tool. */
export function isKiloPermissionPattern(key: string): boolean {
  return key.includes("*") || key.includes("?");
}

/**
 * The server among `serverNames` whose tool a Kilo permission (or legacy
 * `tools`) key names, with the tool part, or `undefined` when the key is a
 * wildcard, one of Kilo's built-in permissions, or names no listed server.
 * Both the sanitized prefix Kilo matches and the raw one earlier rulesync
 * versions wrote into the `tools` map are recognized; the longest matching
 * prefix wins, so `github_enterprise_delete` belongs to `github_enterprise`
 * rather than to `github` when both are listed.
 */
export function findKiloMcpToolKeyOwner(
  key: string,
  serverNames: readonly string[],
): { serverName: string; toolName: string } | undefined {
  if (isKiloPermissionPattern(key) || KILO_BUILTIN_PERMISSION_KEYS.has(key)) {
    return undefined;
  }
  let owner: { serverName: string; prefix: string } | undefined;
  for (const serverName of serverNames) {
    for (const prefix of uniq([`${sanitizeKiloToolNamePart(serverName)}_`, `${serverName}_`])) {
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

import { isPlainObject } from "../../utils/type-guards.js";
import {
  findOpencodeMcpToolKeyOwner,
  opencodeMcpToolPermissionKey,
} from "./opencode-family-mcp-tool-keys.js";

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
  "repo_clone",
  "repo_overview",
]);

/**
 * The permission key of one MCP tool, sanitized the way Kilo (an OpenCode
 * fork) names MCP tools; see {@link opencodeMcpToolPermissionKey}.
 */
export function kiloMcpToolPermissionKey(serverName: string, toolName: string): string {
  return opencodeMcpToolPermissionKey(serverName, toolName);
}

/** Whether a Kilo permission key is a wildcard pattern rather than one tool. */
export function isKiloPermissionPattern(key: string): boolean {
  return key.includes("*") || key.includes("?");
}

/**
 * Read a `permission` entry as an MCP tool filter. A scalar `allow`/`deny`, or
 * a pattern map stating only `"*"` (the shape Kilo itself saves), is a filter;
 * `ask` and narrower pattern maps have no `enabledTools`/`disabledTools`
 * equivalent and are left to the permissions feature.
 */
export function kiloPermissionToToolFilter(value: unknown): boolean | undefined {
  const action =
    isPlainObject(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "*")
      ? value["*"]
      : value;
  if (action === "allow") return true;
  if (action === "deny") return false;
  return undefined;
}

/**
 * The server among `serverNames` whose tool a Kilo permission (or legacy
 * `tools`) key names, with the tool part, or `undefined` when the key is one of
 * Kilo's built-in permissions or names no listed server. Both the sanitized
 * prefix Kilo matches and the raw one earlier rulesync versions wrote into the
 * `tools` map are recognized (see {@link findOpencodeMcpToolKeyOwner}).
 */
export function findKiloMcpToolKeyOwner(
  key: string,
  serverNames: readonly string[],
): { serverName: string; toolName: string } | undefined {
  return findOpencodeMcpToolKeyOwner({
    key,
    serverNames,
    builtinKeys: KILO_BUILTIN_PERMISSION_KEYS,
    acceptRawPrefix: true,
  });
}

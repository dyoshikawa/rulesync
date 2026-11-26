/**
 * The frontmatter fields a command or subagent fetched from a declared source
 * keeps. Only the canonical, tool-neutral fields of the rulesync schema are
 * listed: none of them grants tools, permissions, hooks or MCP servers.
 *
 * Every tool section (`claudecode`, `codexcli`, `kiro`, `opencode`, ...) is
 * dropped as a whole. The tool adapters copy those sections into the
 * generated files, and each tool has its own keys that run code or act
 * without asking (`permissionMode`, `hooks`, `mcpServers`, `allowed-tools`,
 * Kiro `toolsSettings`, Codex `notify` or `sandbox_mode`, OpenCode
 * `permission` / `tools`, ...), so no list of forbidden keys can keep up.
 */
export const CURATED_COMMAND_FRONTMATTER_KEYS = ["targets", "description"] as const;
export const CURATED_SUBAGENT_FRONTMATTER_KEYS = ["targets", "name", "description"] as const;

/**
 * Keep only `allowedKeys` of a frontmatter object. Returns a new frontmatter
 * and the names of the dropped top-level keys, in input order.
 */
export function keepCuratedFrontmatterKeys<T extends Record<string, unknown>>(params: {
  frontmatter: T;
  allowedKeys: readonly string[];
}): { frontmatter: T; droppedKeys: string[] } {
  const { frontmatter, allowedKeys } = params;
  const kept: Record<string, unknown> = {};
  const droppedKeys: string[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (allowedKeys.includes(key)) {
      kept[key] = value;
    } else {
      droppedKeys.push(key);
    }
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only keys were removed; the required fields are allowed
  return { frontmatter: kept as T, droppedKeys };
}

import { isPlainObject } from "./type-guards.js";

/**
 * Frontmatter keys that let a command or subagent run code, reach new MCP
 * servers, or act without asking, in the spellings the supported tools use
 * (Claude Code `permissionMode` / `hooks` / `mcpServers` and a command's
 * `allowed-tools`, Copilot `mcp-servers`, OpenCode and Kilo `permission`,
 * Codewhale and Devin `permissions`, Codex CLI `sandbox_mode`, Qwen Code
 * `approvalMode`, Kiro `allowedTools`, Vibe `approval_policy`, ...).
 *
 * Keys that only narrow what an agent may do (`tools`, `disallowedTools`) are
 * deliberately absent: dropping them would widen access instead.
 */
const PRIVILEGED_FRONTMATTER_KEYS: ReadonlySet<string> = new Set([
  "hooks",
  "mcp",
  "mcpServers",
  "mcp-servers",
  "mcp_servers",
  "permission",
  "permissions",
  "permissionMode",
  "permission-mode",
  "permission_mode",
  "allowed-tools",
  "allowedTools",
  "allowed_tools",
  "autoApprove",
  "auto-approve",
  "auto_approve",
  "approvalMode",
  "approval-mode",
  "approval_mode",
  "approvalPolicy",
  "approval_policy",
  "default_approval_policy",
  "sandboxMode",
  "sandbox-mode",
  "sandbox_mode",
  "trust",
  "yolo",
]);

/**
 * Remove the privileged keys from a frontmatter object: at its root, and in
 * every tool section (a plain-object value at the root, such as `claudecode`),
 * since each tool adapter copies its section into the generated file.
 *
 * Returns a new frontmatter and the dotted paths of what was dropped
 * (`claudecode.permissionMode`), in input order.
 */
export function stripPrivilegedFrontmatter<T extends Record<string, unknown>>(
  frontmatter: T,
): { frontmatter: T; droppedKeys: string[] } {
  const droppedKeys: string[] = [];
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (PRIVILEGED_FRONTMATTER_KEYS.has(key)) {
      droppedKeys.push(key);
      continue;
    }
    if (!isPlainObject(value)) {
      stripped[key] = value;
      continue;
    }
    const section: Record<string, unknown> = {};
    for (const [sectionKey, sectionValue] of Object.entries(value)) {
      if (PRIVILEGED_FRONTMATTER_KEYS.has(sectionKey)) {
        droppedKeys.push(`${key}.${sectionKey}`);
        continue;
      }
      section[sectionKey] = sectionValue;
    }
    stripped[key] = section;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only keys were removed
  return { frontmatter: stripped as T, droppedKeys };
}

import { join } from "node:path";

export const CODEXCLI_DIR = ".codex";
export const CODEXCLI_PROMPTS_DIR_PATH = join(CODEXCLI_DIR, "prompts");
export const CODEXCLI_RULES_DIR_PATH = join(CODEXCLI_DIR, "rules");
export const CODEXCLI_AGENTS_DIR_PATH = join(CODEXCLI_DIR, "agents");
export const CODEXCLI_SKILLS_DIR_PATH = join(".agents", "skills");
export const CODEXCLI_HOOKS_FILE_NAME = "hooks.json";
export const CODEXCLI_MCP_FILE_NAME = "config.toml";
export const CODEXCLI_RULE_FILE_NAME = "AGENTS.md";
export const CODEXCLI_BASH_RULES_FILE_NAME = "rulesync.rules";
export const CODEXCLI_OPENAI_YAML_RELATIVE_PATH = join("agents", "openai.yaml");

// Top-level `.codex/config.toml` keys the `codexcli` permission override may
// author and round-trip (see codexcli-permissions.ts). Everything else is
// refused (see applyCodexcliOverride) so the override can never clobber a
// feature-owned surface: `permissions` / `default_permissions` are owned by
// the canonical permissions model (codexcli-permissions.ts), and
// `mcp_servers.*` per-MCP gating is owned by the MCP feature (codexcli-mcp.ts).
// https://developers.openai.com/codex/config-reference
// Named here (rather than inline in codexcli-permissions.ts) so
// shared-config-gateway.ts can reference the same list in its
// `SHARED_CONFIG_OWNERSHIP` declaration without an import cycle.
export const CODEXCLI_OVERRIDE_KEYS = [
  "approval_policy",
  "sandbox_mode",
  "sandbox_workspace_write",
  "apps",
  "approvals_reviewer",
] as const;

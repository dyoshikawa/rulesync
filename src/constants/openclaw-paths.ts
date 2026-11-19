import { join } from "node:path";

// OpenClaw (the always-on assistant gateway) keeps every agent's prompt files
// in a per-agent workspace. The default workspace is `~/.openclaw/workspace`;
// `OPENCLAW_WORKSPACE_DIR`, `OPENCLAW_PROFILE`, `OPENCLAW_STATE_DIR` and the
// `agents.defaults.workspace` / `agents.entries.*.workspace` config keys can
// move it, but rulesync writes the default location only.
// @see https://docs.openclaw.ai/concepts/agent-workspace
export const OPENCLAW_WORKSPACE_DIR_PATH = join(".openclaw", "workspace");

// Operating instructions. The workspace `AGENTS.md` is injected into every
// session (and is the only bootstrap file sub-agent sessions receive); when a
// session runs from another folder or a managed worktree, that folder's
// `AGENTS.md` is appended after the workspace files as project context. There
// is no nested per-directory discovery.
// @see https://docs.openclaw.ai/concepts/system-prompt
export const OPENCLAW_RULE_FILE_NAME = "AGENTS.md";

// Gateway config. OpenClaw reads its JSON5 config from
// `~/.openclaw/openclaw.json`; `OPENCLAW_CONFIG_PATH`, `OPENCLAW_STATE_DIR` and
// `OPENCLAW_PROFILE` can move it, but rulesync writes the default location
// only. MCP servers live under `mcp.servers`; the file has no project scope.
// @see https://docs.openclaw.ai/gateway/configuration
// @see https://docs.openclaw.ai/gateway/config-extensions
export const OPENCLAW_CONFIG_DIR_PATH = ".openclaw";
export const OPENCLAW_CONFIG_FILE_NAME = "openclaw.json";
export const OPENCLAW_MCP_CONFIG_KEY = "mcp";
export const OPENCLAW_MCP_SERVERS_KEY = "servers";

// Skills. OpenClaw loads `<name>/SKILL.md` bundles from several roots. Rulesync
// writes the execution folder's `.agents/skills/` (project; OpenClaw also loads
// an execution folder's `skills/`, which rulesync leaves alone because that
// directory name routinely holds unrelated content) and the managed/local
// `<state-dir>/skills` root (global, `~/.openclaw/skills` by default), which
// every agent sharing that state sees. The personal `~/.agents/skills` root
// OpenClaw also reads belongs to the `agentsskills` target.
// @see https://docs.openclaw.ai/tools/skills
export const OPENCLAW_PROJECT_SKILLS_DIR_PATH = join(".agents", "skills");
export const OPENCLAW_GLOBAL_SKILLS_DIR_PATH = join(OPENCLAW_CONFIG_DIR_PATH, "skills");

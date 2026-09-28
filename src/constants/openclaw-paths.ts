import { join } from "node:path";

// OpenClaw (the always-on assistant gateway) keeps every agent's prompt files
// in a per-agent workspace. The default workspace is `~/.openclaw/workspace`;
// `OPENCLAW_WORKSPACE_DIR`, `OPENCLAW_PROFILE`, `OPENCLAW_STATE_DIR` and the
// `agents.defaults.workspace` config key can move it, but rulesync writes the
// default location only.
// @see https://docs.openclaw.ai/concepts/agent-workspace
export const OPENCLAW_WORKSPACE_DIR_PATH = join(".openclaw", "workspace");

// Operating instructions. The workspace `AGENTS.md` is injected into every
// session (and is the only bootstrap file sub-agent sessions receive); when a
// session runs from another folder or a managed worktree, that folder's
// `AGENTS.md` is appended after the workspace files as project context. There
// is no nested per-directory discovery.
// @see https://docs.openclaw.ai/concepts/system-prompt
export const OPENCLAW_RULE_FILE_NAME = "AGENTS.md";

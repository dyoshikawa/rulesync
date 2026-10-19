import { join } from "node:path";

/**
 * Xum configuration-layout conventions.
 *
 * Xum (Coder's desktop app and `xum run` CLI for running coding agents in
 * parallel workspaces, formerly Mux) keeps its project assets under a `.xum/`
 * directory at the project root and the matching user assets under `~/.xum/`.
 * Legacy `.mux/` files are still read when the matching `.xum/` file is
 * missing; rulesync writes only the `.xum/` paths.
 *
 * @see https://xum.cdr.dev/reference/mux-compatibility
 */
export const XUM_DIR = ".xum";

// Rules. `.xum/AGENTS.md` (project) and `~/.xum/AGENTS.md` (user) are the
// Xum-dedicated instruction files, read on top of the shared root `AGENTS.md`
// (which the `agentsmd` target writes). Only the exact name `AGENTS.md` is
// accepted there, plus an optional personal `.xum/AGENTS.local.md` overlay.
// There is no rules directory, so topic rules fold into the single file.
// @see https://xum.cdr.dev/agents/instruction-files
export const XUM_RULE_FILE_NAME = "AGENTS.md";
export const XUM_LOCAL_RULE_FILE_NAME = "AGENTS.local.md";

// MCP servers. `~/.xum/mcp.jsonc` (user) with optional repo overrides in
// `.xum/mcp.jsonc` (project), both a JSONC document with a `servers` map.
// @see https://xum.cdr.dev/config/mcp-servers
export const XUM_MCP_FILE_NAME = "mcp.jsonc";

// Custom agents: Markdown files with YAML frontmatter directly under
// `.xum/agents/` (project) and `~/.xum/agents/` (user). The file name (without
// `.md`) is the agent id.
// @see https://xum.cdr.dev/agents
export const XUM_AGENTS_DIR_PATH = join(XUM_DIR, "agents");

// Skills: `<name>/SKILL.md` directories under `.xum/skills/` (project) and
// `~/.xum/skills/` (user).
// @see https://xum.cdr.dev/agents/agent-skills
export const XUM_SKILLS_DIR_PATH = join(XUM_DIR, "skills");

import { join } from "node:path";

export const DEEPAGENTS_DIR = ".deepagents";
/**
 * dcode keeps user-level context under a directory named after the agent, and
 * that name defaults to `agent` (`DEFAULT_AGENT_NAME` in deepagents-code), not
 * to the product name — so a global install lands in `~/.deepagents/agent/`.
 *
 * @see https://docs.langchain.com/oss/deepagents/code/memory-and-skills
 */
export const DEEPAGENTS_GLOBAL_DIR = join(DEEPAGENTS_DIR, "agent");
export const DEEPAGENTS_SKILLS_DIR_PATH = join(DEEPAGENTS_DIR, "skills");
export const DEEPAGENTS_GLOBAL_SKILLS_DIR_PATH = join(DEEPAGENTS_GLOBAL_DIR, "skills");
export const DEEPAGENTS_AGENTS_DIR_PATH = join(DEEPAGENTS_DIR, "agents");
export const DEEPAGENTS_GLOBAL_AGENTS_DIR_PATH = join(DEEPAGENTS_GLOBAL_DIR, "agents");
export const DEEPAGENTS_RULE_FILE_NAME = "AGENTS.md";
export const DEEPAGENTS_MCP_FILE_NAME = ".mcp.json";
/** dcode's user config, read only from `~/.deepagents/config.toml`. */
export const DEEPAGENTS_CONFIG_FILE_NAME = "config.toml";
export const DEEPAGENTS_HOOKS_FILE_NAME = "hooks.json";

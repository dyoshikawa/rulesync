export const CLAUDECODE_PLUGIN_COMMANDS_DIR = "commands";
export const CLAUDECODE_PLUGIN_AGENTS_DIR = "agents";
export const CLAUDECODE_PLUGIN_SKILLS_DIR = "skills";
export const CLAUDECODE_PLUGIN_HOOKS_DIR = "hooks";
export const CLAUDECODE_PLUGIN_HOOKS_FILE_NAME = "hooks.json";

export const ANTIGRAVITY_PLUGIN_RULES_DIR = "rules";
export const ANTIGRAVITY_PLUGIN_SKILLS_DIR = "skills";
// Plugin bundles may ship custom agents in `<plugin>/agents/`.
// @see https://antigravity.google/docs/cli/plugins
export const ANTIGRAVITY_PLUGIN_AGENTS_DIR = "agents";
export const ANTIGRAVITY_PLUGIN_MCP_FILE_NAME = "mcp_config.json";
export const ANTIGRAVITY_PLUGIN_HOOKS_FILE_NAME = "hooks.json";
// The manifest that marks a directory as an Antigravity plugin.
// @see https://antigravity.google/docs/plugins
export const ANTIGRAVITY_PLUGIN_MANIFEST_FILE_NAME = "plugin.json";

// Auggie plugin components live directly under the plugin root, in the same
// layout as a Claude Code plugin plus a `rules/` directory.
// @see https://docs.augmentcode.com/cli/plugins
export const AUGMENTCODE_PLUGIN_RULES_DIR = "rules";
export const AUGMENTCODE_PLUGIN_COMMANDS_DIR = "commands";
export const AUGMENTCODE_PLUGIN_AGENTS_DIR = "agents";
export const AUGMENTCODE_PLUGIN_SKILLS_DIR = "skills";
export const AUGMENTCODE_PLUGIN_HOOKS_DIR = "hooks";
export const AUGMENTCODE_PLUGIN_HOOKS_FILE_NAME = "hooks.json";

// ZCode plugin components live directly under the plugin root, in the Claude
// Code plugin layout; the manifest is `.zcode-plugin/plugin.json`.
// @see https://zcode.z.ai/en/docs/plugin
export const ZCODE_PLUGIN_COMMANDS_DIR = "commands";
export const ZCODE_PLUGIN_AGENTS_DIR = "agents";
export const ZCODE_PLUGIN_SKILLS_DIR = "skills";
export const ZCODE_PLUGIN_HOOKS_DIR = "hooks";
export const ZCODE_PLUGIN_HOOKS_FILE_NAME = "hooks.json";
export const ZCODE_PLUGIN_MCP_FILE_NAME = ".mcp.json";

// Vibe plugins follow Agent Plugins 1.0: `plugin.json`, `mcp.json` and
// `skills/` at the plugin root, and Vibe-specific components under the
// `ai.mistral.vibe/` extension directory.
// @see https://github.com/mistralai/mistral-vibe/blob/v2.25.8/vibe/core/plugins/_native.py
export const VIBE_PLUGIN_SKILLS_DIR = "skills";
export const VIBE_PLUGIN_MCP_FILE_NAME = "mcp.json";
export const VIBE_PLUGIN_EXTENSION_DIR = "ai.mistral.vibe";
export const VIBE_PLUGIN_AGENTS_DIR_NAME = "agents";
export const VIBE_PLUGIN_HOOKS_FILE_NAME = "hooks.toml";

// Devin plugin components live directly under the plugin root: an always-on
// `AGENTS.md`, triggered `rules/`, `agents/<name>/AGENT.md` subagents, a root
// `hooks.json`, `.mcp.json` and `skills/`. The manifest is
// `.devin-plugin/plugin.json`.
// @see https://docs.devin.ai/cli/extensibility/plugins/overview
export const DEVIN_PLUGIN_RULES_DIR = "rules";
export const DEVIN_PLUGIN_AGENTS_DIR = "agents";
export const DEVIN_PLUGIN_SKILLS_DIR = "skills";
export const DEVIN_PLUGIN_HOOKS_FILE_NAME = "hooks.json";
export const DEVIN_PLUGIN_MCP_FILE_NAME = ".mcp.json";

// Kimi Code plugin components live directly under the plugin root. Only
// `agents/` is auto-discovered; `skills`, `commands` and `systemPromptPath` must
// be declared in the `kimi.plugin.json` manifest, which also carries the inline
// `mcpServers` and `hooks` that rulesync does not write.
// @see https://github.com/MoonshotAI/kimi-code/blob/%40moonshot-ai/kimi-code%402.1.1/docs/en/customization/plugins.md
export const KIMI_CODE_PLUGIN_SYSTEM_PROMPT_FILE_NAME = "SYSTEM.md";
export const KIMI_CODE_PLUGIN_COMMANDS_DIR = "commands";
export const KIMI_CODE_PLUGIN_AGENTS_DIR = "agents";
export const KIMI_CODE_PLUGIN_SKILLS_DIR = "skills";

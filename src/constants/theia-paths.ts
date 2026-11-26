import { join } from "node:path";

import { AGENTSMD_SKILLS_DIR_PATH, AGENTSMD_SUBAGENTS_DIR_PATH } from "./agentsmd-paths.js";

// Eclipse Theia AI (the AI layer of the Theia IDE and of the products built on
// the Theia platform) reads its workspace configuration from the files below.
// @see https://theia-ide.org/docs/user_ai/

// Rules. Theia AI reads the workspace-root `AGENTS.md` only: `CLAUDE.md`,
// `AGENT.md` and nested files are deliberately not fallbacks, so non-root rules
// fold into the root file.
// @see https://github.com/eclipse-theia/theia/blob/master/packages/ai-core/src/common/agents-md.ts
export const THEIA_RULE_FILE_NAME = "AGENTS.md";

// Commands. Slash commands are prompt templates (`*.prompttemplate`) with
// `isCommand: true` frontmatter in the workspace template directories, whose
// default (`ai-features.promptTemplates.WorkspaceTemplateDirectories`) is
// `.prompts`. Theia reads that directory at its top level only.
// @see https://theia-ide.org/docs/user_ai/#slash-commands
export const THEIA_PROMPTS_DIR_PATH = ".prompts";
export const THEIA_PROMPT_TEMPLATE_EXTENSION = "prompttemplate";

// Subagents. Custom agents live in `.agents/agents/<id>/agent.md` (the folder
// name is the agent id); `.agents` is the default location for new agents and
// wins over the legacy `.prompts/agents/` on id conflicts.
// @see https://theia-ide.org/docs/user_ai/#custom-agents
export const THEIA_AGENTS_DIR_PATH = AGENTSMD_SUBAGENTS_DIR_PATH;
export const THEIA_AGENT_FILE_NAME = "agent.md";

// Skills. Workspace skills are read from `.prompts/skills/` and the shared
// Agent Skills root `.agents/skills/`; user skills from `~/.theia/skills/` and
// `~/.agents/skills/`. Rulesync writes the shared project root and the
// Theia-specific user root.
// @see https://theia-ide.org/docs/user_ai/#agent-skills
export const THEIA_SKILLS_DIR_PATH = AGENTSMD_SKILLS_DIR_PATH;
export const THEIA_GLOBAL_SKILLS_DIR_PATH = join(".theia", "skills");

// MCP. Servers are configured in the `ai-features.mcp.mcpServers` preference.
// Workspace preferences live in `.theia/settings.json` (Theia's workspace
// preference folder and file name), beside every other workspace preference,
// so the key is merged in place.
// @see https://theia-ide.org/docs/user_ai/#mcp-integration
// @see https://github.com/eclipse-theia/theia/blob/master/packages/ai-mcp/src/common/mcp-preferences.ts
export const THEIA_DIR = ".theia";
export const THEIA_SETTINGS_FILE_NAME = "settings.json";
export const THEIA_MCP_SERVERS_KEY = "ai-features.mcp.mcpServers";

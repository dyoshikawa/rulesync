import { join } from "node:path";

import { AGENTSMD_SKILLS_DIR_PATH } from "./agentsmd-paths.js";

const AIASSISTANT_DIR = ".aiassistant";
export const AIASSISTANT_RULES_DIR_PATH = join(AIASSISTANT_DIR, "rules");
// JetBrains AI Assistant shares the JetBrains-wide `.aiignore` filename (the
// same file Junie uses) at the project root.
export const AIASSISTANT_IGNORE_FILE_NAME = ".aiignore";
// JetBrains AI Assistant 2026.1 added a Skill Manager that auto-discovers
// project-level skills from the committable `.agents/skills/<name>/SKILL.md`
// directory, following the open Agent Skills standard. The relative path is the
// same as the agentsskills target. https://agentskills.io/specification
export const AIASSISTANT_SKILLS_DIR_PATH = AGENTSMD_SKILLS_DIR_PATH;
// JetBrains AI Assistant project-level MCP configuration is read from
// `.ai/mcp/mcp.json`. The help page (https://www.jetbrains.com/help/ai-assistant/mcp.html)
// documents the file shape but not its location; the path is the plugin's
// own default, declared in `ml-llm/lib/ml-llm.jar!/META-INF/plugin.xml` of
// the JetBrains AI Assistant plugin (https://plugins.jetbrains.com/plugin/22282)
// as the registry keys `llm.mcp.client.project.mcp.json.path` and
// `llm.mcp.client.global.mcp.json.path`, both defaulting to
// `.ai/mcp/mcp.json` (verified in builds 262.10315.x and 263.4732.x).
export const AIASSISTANT_MCP_DIR = ".ai";
export const AIASSISTANT_MCP_SUB_DIR = "mcp";
export const AIASSISTANT_MCP_DIR_PATH = join(AIASSISTANT_MCP_DIR, AIASSISTANT_MCP_SUB_DIR);
export const AIASSISTANT_MCP_FILE_NAME = "mcp.json";

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
// `.ai/mcp/mcp.json`. https://www.jetbrains.com/help/ai-assistant/mcp.html
export const AIASSISTANT_MCP_DIR = ".ai";
export const AIASSISTANT_MCP_SUB_DIR = "mcp";
export const AIASSISTANT_MCP_DIR_PATH = join(AIASSISTANT_MCP_DIR, AIASSISTANT_MCP_SUB_DIR);
export const AIASSISTANT_MCP_FILE_NAME = "mcp.json";

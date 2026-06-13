import { join } from "node:path";

export const PI_DIR = ".pi";
export const PI_AGENT_DIR = join(PI_DIR, "agent");
export const PI_AGENT_PROMPTS_DIR_PATH = join(PI_AGENT_DIR, "prompts");
export const PI_AGENT_SKILLS_DIR_PATH = join(PI_AGENT_DIR, "skills");
export const PI_PROMPTS_DIR_PATH = join(PI_DIR, "prompts");
export const PI_SKILLS_DIR_PATH = join(PI_DIR, "skills");
export const PI_RULE_FILE_NAME = "AGENTS.md";
export const PI_MEMORIES_DIR = ".agents";
export const PI_MEMORIES_DIR_PATH = join(PI_MEMORIES_DIR, "memories");

import { join } from "node:path";

export const AMP_DIR = ".amp";
export const AMP_GLOBAL_DIR = join(".config", "amp");
export const AMP_AGENTS_DIR = ".agents";
export const AMP_SKILLS_PROJECT_DIR = join(AMP_AGENTS_DIR, "skills");
export const AMP_SKILLS_GLOBAL_DIR = join(".config", "agents", "skills");
export const AMP_RULE_FILE_NAME = "AGENTS.md";
export const AMP_SETTINGS_FILE_NAME = "settings.json";
export const AMP_SETTINGS_JSONC_FILE_NAME = "settings.jsonc";

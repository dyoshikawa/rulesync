import { join } from "node:path";

export const CODEXCLI_DIR = ".codex";
export const CODEXCLI_PROMPTS_DIR_PATH = join(CODEXCLI_DIR, "prompts");
export const CODEXCLI_RULES_DIR_PATH = join(CODEXCLI_DIR, "rules");
export const CODEXCLI_AGENTS_DIR_PATH = join(CODEXCLI_DIR, "agents");
export const CODEXCLI_SKILLS_DIR_PATH = join(".agents", "skills");
export const CODEXCLI_HOOKS_FILE_NAME = "hooks.json";
export const CODEXCLI_MCP_FILE_NAME = "config.toml";
export const CODEXCLI_RULE_FILE_NAME = "AGENTS.md";
export const CODEXCLI_BASH_RULES_FILE_NAME = "rulesync.rules";
export const CODEXCLI_OPENAI_YAML_RELATIVE_PATH = join("agents", "openai.yaml");

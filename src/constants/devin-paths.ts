import { join } from "node:path";

export const DEVIN_DIR = ".devin";
const CODEIUM_DIR = ".codeium";
const WINDSURF_SUBDIR = "windsurf";
export const CODEIUM_WINDSURF_DIR = join(CODEIUM_DIR, WINDSURF_SUBDIR);
export const DEVIN_WORKFLOWS_DIR_PATH = join(DEVIN_DIR, "workflows");
export const DEVIN_SKILLS_DIR_PATH = join(DEVIN_DIR, "skills");
export const DEVIN_AGENTS_DIR_PATH = join(DEVIN_DIR, "agents");
// Devin Local global config directory. On Linux/macOS this is `~/.config/devin`
// (the home directory is resolved by the processor through outputRoot in global
// mode). https://docs.devin.ai/cli/extensibility/configuration
export const DEVIN_GLOBAL_CONFIG_DIR_PATH = join(".config", "devin");
// Devin Local custom subagent profiles in global mode live under
// `~/.config/devin/agents/` (NOT `.devin/agents/` under the home directory).
// https://docs.devin.ai/cli/subagents
export const DEVIN_GLOBAL_AGENTS_DIR_PATH = join(DEVIN_GLOBAL_CONFIG_DIR_PATH, "agents");
export const CODEIUM_WINDSURF_GLOBAL_WORKFLOWS_DIR_PATH = join(
  CODEIUM_WINDSURF_DIR,
  "global_workflows",
);
export const CODEIUM_WINDSURF_SKILLS_DIR_PATH = join(CODEIUM_WINDSURF_DIR, "skills");
// Native Devin Local config file. Holds `mcpServers`, `permissions`, and (in
// global mode) `hooks`. Project: `.devin/config.json`; user:
// `~/.config/devin/config.json`. https://docs.devin.ai/cli/extensibility/configuration
export const DEVIN_CONFIG_FILE_NAME = "config.json";
// Native Devin Local standalone project hooks file. The hooks object is the
// entire file (no wrapper key). https://docs.devin.ai/cli/extensibility/hooks/overview
export const DEVIN_HOOKS_V1_FILE_NAME = "hooks.v1.json";
// Native Devin Local global always-on rules file at `~/.config/devin/AGENTS.md`.
// https://docs.devin.ai/cli/extensibility/rules
export const DEVIN_GLOBAL_AGENTS_FILE_NAME = "AGENTS.md";
export const DEVIN_IGNORE_FILE_NAME = ".devinignore";
export const DEVIN_LEGACY_IGNORE_FILE_NAME = ".codeiumignore";

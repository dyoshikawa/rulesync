import { join } from "node:path";

export const DEVIN_DIR = ".devin";
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
// Devin Local global skills live under `~/.config/devin/skills/` — the
// Devin-native (XDG) directory, consistent with the global agents/rules paths.
// The legacy `~/.codeium/<channel>/skills/` location is channel-dependent and no
// longer emitted. https://docs.devin.ai/cli/extensibility/skills
export const DEVIN_GLOBAL_SKILLS_DIR_PATH = join(DEVIN_GLOBAL_CONFIG_DIR_PATH, "skills");
// Native Devin Local config file. Holds `mcpServers`, `permissions`, and (in
// global mode) `hooks`. Project: `.devin/config.json`; user:
// `~/.config/devin/config.json`. https://docs.devin.ai/cli/extensibility/configuration
export const DEVIN_CONFIG_FILE_NAME = "config.json";
// Dedicated MCP config file since v3000.3 (the Local 3.6 release): project
// `.devin/mcp_config.json`, user `~/.config/devin/mcp_config.json`. Legacy
// `mcpServers` entries in config.json are auto-migrated here on startup.
// https://docs.devin.ai/cli/extensibility/mcp/configuration
export const DEVIN_MCP_CONFIG_FILE_NAME = "mcp_config.json";
// Personal/gitignored local override next to the project MCP config. Never
// emitted by rulesync; listed for gitignore derivation only.
export const DEVIN_MCP_LOCAL_CONFIG_FILE_NAME = "mcp_config.local.json";
// Native Devin Local standalone project hooks file. The hooks object is the
// entire file (no wrapper key). https://docs.devin.ai/cli/extensibility/hooks/overview
export const DEVIN_HOOKS_V1_FILE_NAME = "hooks.v1.json";
// Native Devin Local global always-on rules file at `~/.config/devin/AGENTS.md`.
// https://docs.devin.ai/cli/extensibility/rules
export const DEVIN_GLOBAL_AGENTS_FILE_NAME = "AGENTS.md";
export const DEVIN_IGNORE_FILE_NAME = ".devinignore";
export const DEVIN_LEGACY_IGNORE_FILE_NAME = ".codeiumignore";
// Third project-scope ignore filename Devin Desktop honors, carried over from
// the Windsurf era. The docs list `.devinignore`, `.codeiumignore`, and
// `.windsurfignore` side by side without defining a precedence, so rulesync
// reads all three on import and emits only `.devinignore`.
// https://docs.devin.ai/desktop/context-awareness/windsurf-ignore
export const DEVIN_WINDSURF_IGNORE_FILE_NAME = ".windsurfignore";
// Enterprise-wide ignore file at `~/.codeium/.codeiumignore`, applied across
// every repository. Three things about it are deliberate and worth recording:
//
// 1. It keeps the legacy `.codeium`/`.codeiumignore` brand spelling. Unlike the
//    project file, which was renamed to `.devinignore` in Desktop v3.1.7, the
//    global one is documented only under the pre-rebrand name, so no
//    `.devinignore` variant is emitted or read here.
// 2. It is documented in the Devin *Desktop* docs tree, not the Devin Local
//    (CLI) one, so it does not live under `~/.config/devin` with the other
//    global Devin paths.
// 3. It is positioned as an enterprise feature for managing multiple
//    repositories, not a general per-user setting.
//
// https://docs.devin.ai/desktop/context-awareness/windsurf-ignore
export const DEVIN_GLOBAL_IGNORE_DIR_PATH = ".codeium";
export const DEVIN_GLOBAL_IGNORE_FILE_NAME = DEVIN_LEGACY_IGNORE_FILE_NAME;

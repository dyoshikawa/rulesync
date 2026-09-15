import { join } from "node:path";

// Crush (Charm's terminal coding agent) reads project rules from `CRUSH.md`
// (also `crush.md` / `Crush.md` and their `.local` variants) at the working
// directory root, and a global rules file at `~/.config/crush/CRUSH.md`. Its
// full default context-path list also opportunistically reads `AGENTS.md`,
// `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.cursor/rules/` and
// `.github/copilot-instructions.md` — those are already owned by other
// rulesync targets, so this target only claims the Crush-specific spelling.
// @see https://github.com/charmbracelet/crush/blob/main/internal/config/config.go
// @see https://github.com/charmbracelet/crush/blob/main/internal/config/load.go
export const CRUSH_RULE_FILE_NAME = "CRUSH.md";
export const CRUSH_GLOBAL_DIR = join(".config", "crush");

// `defaultContextPaths` lists `crush.local.md`, `Crush.local.md` and
// `CRUSH.local.md` next to their shared siblings, so Crush reads a personal,
// uncommitted project context file the way Claude Code reads `CLAUDE.local.md`.
// Project scope only: the global context path list has no `.local` entry.
// Crush does not gitignore the file for you, so the derived `.gitignore`
// carries it (see `HAND_MAINTAINED_GITIGNORE_ENTRIES`).
// @see https://github.com/charmbracelet/crush/blob/main/internal/config/config.go
export const CRUSH_LOCAL_RULE_FILE_NAME = "CRUSH.local.md";

// `.crushignore` uses gitignore syntax and is read hierarchically (root and
// any subdirectory), the same way Crush walks `.gitignore`. Crush documents no
// global/user-scope ignore file, so this is project-only.
// @see https://github.com/charmbracelet/crush/blob/main/internal/fsext/fileutil.go
export const CRUSH_IGNORE_FILE_NAME = ".crushignore";

// Crush auto-discovers Agent Skills (`SKILL.md` per directory) from
// `.crush/skills/` at project scope and `~/.config/crush/skills/` (or
// `$CRUSH_SKILLS_DIR`) at global scope.
// @see https://github.com/charmbracelet/crush/blob/main/internal/config/load.go
export const CRUSH_SKILLS_PROJECT_DIR = join(".crush", "skills");
export const CRUSH_SKILLS_GLOBAL_DIR = join(CRUSH_GLOBAL_DIR, "skills");

// Crush's JSON config. Project scope reads `.crush.json` and `crush.json` at
// the working directory (walking up to the git root); the global file is
// `~/.config/crush/crush.json`. Every discovered file is merged key by key
// with the more specific one winning, and a `.crush.json` beats a `crush.json`
// in the same directory. The JSON format is documented as deprecated in favor
// of the Bash-based `crushrc`, but it stays supported, is still the schema
// published at https://charm.land/crush.json, and every `crushrc` builtin
// compiles into the same JSON sections — so it is the surface rulesync
// writes. A `crushrc` next to it overrides the JSON key by key.
// @see https://github.com/charmbracelet/crush/blob/main/docs/config/README.md
// @see https://github.com/charmbracelet/crush/blob/main/internal/config/load.go
export const CRUSH_CONFIG_FILE_NAME = "crush.json";
export const CRUSH_HIDDEN_CONFIG_FILE_NAME = ".crush.json";

// Top-level keys of the config that rulesync owns, plus the nested list keys
// the permissions feature rebuilds.
// @see https://github.com/charmbracelet/crush/blob/main/internal/config/config.go
export const CRUSH_MCP_KEY = "mcp";
export const CRUSH_PERMISSIONS_KEY = "permissions";
export const CRUSH_ALLOWED_TOOLS_KEY = "allowed_tools";
export const CRUSH_OPTIONS_KEY = "options";
export const CRUSH_DISABLED_TOOLS_KEY = "disabled_tools";
export const CRUSH_HOOKS_KEY = "hooks";

import { join } from "node:path";

// Crush (Charm's terminal coding agent) reads project rules from `CRUSH.md`
// (also `crush.md` / `Crush.md` and their `.local` variants) at the working
// directory root, and a global rules file at `~/.config/crush/CRUSH.md`. It
// also opportunistically reads `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` and
// `.cursorrules` — those are already owned by other rulesync targets, so this
// target only claims the Crush-specific spelling.
// @see https://github.com/charmbracelet/crush/blob/main/internal/config/config.go
// @see https://github.com/charmbracelet/crush/blob/main/internal/config/load.go
export const CRUSH_RULE_FILE_NAME = "CRUSH.md";
export const CRUSH_GLOBAL_DIR = join(".config", "crush");

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

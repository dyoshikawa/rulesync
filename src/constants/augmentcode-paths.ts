import { join } from "node:path";

export const AUGMENTCODE_DIR = ".augment";
export const AUGMENTCODE_COMMANDS_DIR_PATH = join(AUGMENTCODE_DIR, "commands");
export const AUGMENTCODE_SKILLS_DIR_PATH = join(AUGMENTCODE_DIR, "skills");
export const AUGMENTCODE_AGENTS_DIR_PATH = join(AUGMENTCODE_DIR, "agents");
// Auggie CLI 0.16.0+ also discovers subagents and skills from the cross-tool
// `.agents/` directory (project `.agents/` and user `~/.agents/`) in addition to
// `.augment/`. These are import-only discovery roots; generation still targets
// `.augment/agents/` and `.augment/skills/`.
// @see https://www.augmentcode.com/changelog/auggie-cli-0-16-0-release-notes
// @see https://docs.augmentcode.com/cli/skills
export const AUGMENTCODE_ALT_AGENTS_DIR_PATH = ".agents";
export const AUGMENTCODE_AGENTS_SKILLS_DIR_PATH = join(".agents", "skills");
export const AUGMENTCODE_SETTINGS_FILE_NAME = "settings.json";
export const AUGMENTCODE_IGNORE_FILE_NAME = ".augmentignore";
export const AUGMENTCODE_LEGACY_RULE_FILE_NAME = ".augment-guidelines";

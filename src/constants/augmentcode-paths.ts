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
// Auggie CLI 0.16.0+ evaluates a layered settings model. The gitignored,
// machine-specific overrides file `<workspace>/.augment/settings.local.json`
// is merged ON TOP OF `<workspace>/.augment/settings.json` (local wins). This
// file exists only at the project (workspace) level — there is no global
// `~/.augment/settings.local.json`. rulesync reads it on IMPORT only and never
// writes it (it stays a user-owned, gitignored file).
// @see https://docs.augmentcode.com/cli/config
export const AUGMENTCODE_SETTINGS_LOCAL_FILE_NAME = "settings.local.json";
export const AUGMENTCODE_IGNORE_FILE_NAME = ".augmentignore";
export const AUGMENTCODE_LEGACY_RULE_FILE_NAME = ".augment-guidelines";

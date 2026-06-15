import { join } from "node:path";

export const AUGMENTCODE_DIR = ".augment";
export const AUGMENTCODE_COMMANDS_DIR_PATH = join(AUGMENTCODE_DIR, "commands");
export const AUGMENTCODE_SKILLS_DIR_PATH = join(AUGMENTCODE_DIR, "skills");
export const AUGMENTCODE_AGENTS_DIR_PATH = join(AUGMENTCODE_DIR, "agents");
export const AUGMENTCODE_SETTINGS_FILE_NAME = "settings.json";
export const AUGMENTCODE_IGNORE_FILE_NAME = ".augmentignore";
export const AUGMENTCODE_LEGACY_RULE_FILE_NAME = ".augment-guidelines";

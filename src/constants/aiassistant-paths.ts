import { join } from "node:path";

export const AIASSISTANT_DIR = ".aiassistant";
export const AIASSISTANT_RULES_DIR_PATH = join(AIASSISTANT_DIR, "rules");
// JetBrains AI Assistant shares the JetBrains-wide `.aiignore` filename (the
// same file Junie uses) at the project root.
export const AIASSISTANT_IGNORE_FILE_NAME = ".aiignore";

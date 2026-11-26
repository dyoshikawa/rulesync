import { join } from "node:path";

/**
 * bb keeps its own provider-agnostic agent configuration in a workspace's
 * `.bb/` directory and in its data directory (`~/.bb/` by default). The same
 * relative layout is used under the project root and under the home directory.
 *
 * @see https://github.com/get-bb/bb/blob/main/docs/configuration.md#agent-instructions
 */
export const BB_DIR = ".bb";

/** Instructions bb appends to every provider-backed thread's system prompt. */
export const BB_RULE_FILE_NAME = "AGENTS.md";

/** Skills (`<name>/SKILL.md`) bb injects into every provider. */
export const BB_SKILLS_DIR_PATH = join(BB_DIR, "skills");

import { join } from "node:path";

import type { OmpLayout } from "./omp-paths.js";

/**
 * Gajae-Code (`gjc`), a descendant of pi-mono and oh-my-pi, reads its native
 * configuration from the project's `.gjc/` directory and from the user agent
 * directory `~/.gjc/agent/`. Claude Code and Codex layouts are explicit import
 * sources only and are never loaded by a session.
 *
 * @see https://github.com/Yeachan-Heo/gajae-code/blob/main/docs/customization.md
 */
export const GAJAECODE_DIR = ".gjc";
export const GAJAECODE_GLOBAL_DIR = join(GAJAECODE_DIR, "agent");

export const GAJAECODE_LAYOUT: OmpLayout = {
  toolTarget: "gajaecode",
  toolName: "Gajae-Code",
  dir: GAJAECODE_DIR,
  globalDir: GAJAECODE_GLOBAL_DIR,
  commandsDirName: "commands",
};

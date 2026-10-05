import { join } from "node:path";

import type { PiLayout } from "./pi-paths.js";

/**
 * oh-my-pi (`omp`), a fork of Pi, reads its native configuration from the
 * `.omp/` directory of the project and from the active profile's agent
 * directory (`~/.omp/agent/` for the default profile) globally.
 *
 * @see https://github.com/can1357/oh-my-pi/blob/main/docs/config-usage.md
 * @see https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/discovery/builtin.ts
 */
export const OMP_DIR = ".omp";
export const OMP_GLOBAL_DIR = join(OMP_DIR, "agent");
export const OMP_RULE_FILE_NAME = "AGENTS.md";
export const OMP_RULES_DIR_NAME = "rules";
export const OMP_AGENTS_DIR_NAME = "agents";
export const OMP_MCP_FILE_NAME = "mcp.json";
export const OMP_CONFIG_FILE_NAME = "config.yml";

export const OMP_LAYOUT: PiLayout = {
  toolTarget: "omp",
  dir: OMP_DIR,
  globalDir: OMP_GLOBAL_DIR,
  commandsDirName: "commands",
};

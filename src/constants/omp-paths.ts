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
// oh-my-pi auto-discovers extension modules from `.omp/extensions/*.{ts,js}`
// (project, cwd only) and the agent directory's `extensions/` (global).
// https://github.com/can1357/oh-my-pi/blob/40e9368ef0458fd9073329cdff4174895f91bc6b/docs/extension-loading.md
export const OMP_EXTENSIONS_DIR_PATH = join(OMP_DIR, "extensions");
export const OMP_GLOBAL_EXTENSIONS_DIR_PATH = join(OMP_GLOBAL_DIR, "extensions");
export const OMP_HOOKS_FILE_NAME = "rulesync-hooks.ts";

/**
 * Layout of oh-my-pi and its own descendants (Gajae-Code), which share
 * oh-my-pi's rule, MCP and agent formats beside Pi's skill and command ones.
 * Their rule, MCP and subagent classes subclass the oh-my-pi ones and override
 * only this layout. File and directory names under the config directories
 * (`AGENTS.md`, `rules/`, `agents/`, `mcp.json`) are the same in every fork.
 */
export type OmpLayout = PiLayout & {
  toolTarget: "omp" | "gajaecode";
  /** Display name used in warnings and error messages. */
  toolName: string;
};

export const OMP_LAYOUT: OmpLayout = {
  toolTarget: "omp",
  toolName: "oh-my-pi",
  dir: OMP_DIR,
  globalDir: OMP_GLOBAL_DIR,
  commandsDirName: "commands",
};

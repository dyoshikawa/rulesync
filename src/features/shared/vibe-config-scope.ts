import { join } from "node:path";

import { fileExists } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";

/**
 * Vibe selects exactly **one** persistence TOML and does not merge scopes: the
 * trusted project `.vibe/config.toml` when one is discovered, otherwise
 * `~/.vibe/config.toml` (single code path since v2.22.0's ConfigOrchestrator
 * migration). A `--global` run that writes the home file is therefore inert in
 * any project that has its own config — worth a heads-up, since the other Vibe
 * surfaces (rules, hooks, agents, skills) genuinely combine scopes.
 */
export async function warnIfGlobalVibeConfigIsShadowed(logger?: Logger): Promise<void> {
  if (!(await fileExists(join(process.cwd(), ".vibe", "config.toml")))) {
    return;
  }
  logger?.warn(
    `Vibe reads exactly one config.toml (project .vibe/config.toml when present, ` +
      `otherwise ~/.vibe/config.toml — a fallback, not a merge). This project has ` +
      `.vibe/config.toml, so the global file written by --global is ignored here.`,
  );
}

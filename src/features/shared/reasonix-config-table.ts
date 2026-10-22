import { join } from "node:path";

import {
  REASONIX_NESTED_PROJECT_CONFIG_RELATIVE_FILE_PATH,
  REASONIX_PROJECT_MCP_FILE_NAME,
} from "../../constants/reasonix-paths.js";
import { fileExists, isPresentButUnresolvable, toPosixPath } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isPlainObject } from "../../utils/type-guards.js";

/**
 * Shape-narrowing helpers for the Reasonix TOML config (`reasonix.toml` /
 * `~/.reasonix/config.toml`), shared by the features that read-modify-write it.
 *
 * TOML is only structurally validated on parse, so a hand-edited config can
 * hold any type under `permissions` or inside `allow`/`ask`/`deny`. Both the
 * `permissions` and `ignore` adapters have to narrow the same two shapes
 * before merging, so the narrowing lives here once rather than being re-spelled
 * (and re-diverging) per feature.
 */

/** Keep only the string entries of a TOML array; anything else becomes `[]`. */
export function toReasonixStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Copy a TOML table; a non-table (scalar, array, missing) becomes `{}`. */
export function toReasonixTable(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    return {};
  }
  return { ...value };
}

/**
 * The tool name a Reasonix `[permissions]` rule must use to reach file reads.
 * Reasonix matches a rule's tool exactly against its registered tools
 * (`read_file`, `write_file`, `grep`, ...); only `Bash`, `Edit`, `Browser` and
 * `Computer` are Claude-Code-style aliases (`canonicalRuleTool` in
 * `internal/safety/permission/permission.go`), so a `Read(...)` rule matches
 * nothing. Shared by the `ignore` and `permissions` adapters, which both write
 * read denies into the same table.
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/v2.41.0/internal/safety/permission/permission.go
 */
export const REASONIX_READ_TOOL_NAME = "read_file";

/**
 * The spelling rulesync wrote for read rules before it followed the Reasonix
 * tool vocabulary. Still accepted on import, and an entry spelled this way is
 * treated as rulesync-owned on generate so the dormant copy is replaced.
 */
export const REASONIX_LEGACY_READ_TOOL_NAME = "Read";

async function isPathPresent(path: string): Promise<boolean> {
  return (await fileExists(path)) || (await isPresentButUnresolvable(path));
}

/**
 * Warns when a project-scope generate is about to create `./reasonix.toml`
 * next to an existing `.reasonix/reasonix.toml`.
 *
 * Since v2.46.0 Reasonix reads `.reasonix/reasonix.toml` as the project config
 * when `./reasonix.toml` is absent, and never merges the two: once the root
 * file exists it wins, so every setting in the nested file (permissions,
 * sandbox, disabled tools, MCP servers, ...) silently stops applying. rulesync
 * writes only the root file, so it cannot keep the nested one in effect; this
 * at least names the problem. Like Reasonix, anything at the root path
 * (including a broken symlink) counts as the root file being there.
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/studio-v2.47.1/internal/contract/config/paths.go
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/studio-v2.47.1/docs/CONFIG_PATHS.md
 */
export async function warnIfReasonixNestedProjectConfigShadowed({
  outputRoot,
  global,
  feature,
  logger,
}: {
  outputRoot: string;
  global: boolean;
  feature: string;
  logger?: Logger;
}): Promise<void> {
  if (global || logger === undefined) return;
  if (await isPathPresent(join(outputRoot, REASONIX_PROJECT_MCP_FILE_NAME))) return;
  if (!(await isPathPresent(join(outputRoot, REASONIX_NESTED_PROJECT_CONFIG_RELATIVE_FILE_PATH)))) {
    return;
  }
  const nested = toPosixPath(REASONIX_NESTED_PROJECT_CONFIG_RELATIVE_FILE_PATH);
  logger.warn(
    `Reasonix ${feature}: ${nested} exists but ${REASONIX_PROJECT_MCP_FILE_NAME} does not. ` +
      `Generating creates ${REASONIX_PROJECT_MCP_FILE_NAME}, and Reasonix then reads it instead of ` +
      `${nested} (the two are never merged), so every setting in ${nested} stops applying. ` +
      `Move those settings into ${REASONIX_PROJECT_MCP_FILE_NAME} or the rulesync sources.`,
  );
}

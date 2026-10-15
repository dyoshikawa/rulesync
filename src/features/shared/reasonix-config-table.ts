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

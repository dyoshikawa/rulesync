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

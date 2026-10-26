import { basename } from "node:path";

import type { z } from "zod/mini";

import type { Logger } from "../../utils/logger.js";
import { isPlainObject } from "../../utils/type-guards.js";
import type { RulesyncCheck } from "./rulesync-check.js";

/**
 * Turn a name that came out of a tool's own config file into one safe to use as
 * a `.rulesync/checks/<name>.md` file name. Shared by the adapters whose checks
 * collapse into a single file, since the name they read back is whatever the
 * user wrote there.
 */
export function slugifyCheckName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      // Again after the slice, so a cut landing on a separator does not leave a
      // name like `foo--1.md`.
      .replace(/-+$/, "")
  );
}

/**
 * A check's file stem. basename, so a check in a subdirectory does not name
 * itself `dir/name`.
 */
export function checkStem(rulesyncCheck: RulesyncCheck): string {
  return basename(rulesyncCheck.getRelativeFilePath(), ".md");
}

/**
 * Disambiguate a name against the ones already taken. Used for rule ids on
 * generate (two same-named checks in different subdirectories) and for check
 * file names on import (one rule id repeated across two areas), since a
 * collision in either direction silently loses one of the pair.
 */
export function uniqueCheckName({
  preferred,
  used,
}: {
  preferred: string;
  used: Set<string>;
}): string {
  let name = preferred;
  let suffix = 2;
  while (used.has(name)) {
    name = `${preferred}-${suffix}`;
    suffix += 1;
  }
  used.add(name);
  return name;
}

/**
 * Parse a check's tool-specific frontmatter block (e.g. `augmentcode:`). A
 * missing block is empty; one that is not a mapping is ignored with a warning,
 * since it would otherwise silently produce the wrong shape; an invalid one
 * throws.
 */
export function parseCheckOverride<T extends object>({
  raw,
  filePath,
  section,
  schema,
  logger,
}: {
  raw: unknown;
  filePath: string;
  section: string;
  schema: z.ZodMiniType<T>;
  logger?: Logger;
}): Partial<T> {
  if (raw === undefined) {
    return {};
  }
  if (!isPlainObject(raw)) {
    logger?.warn(`Ignoring the \`${section}\` block in ${filePath}: expected a mapping.`);
    return {};
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid \`${section}\` block in ${filePath}: ${result.error.message}`, {
      cause: result.error,
    });
  }
  return result.data;
}

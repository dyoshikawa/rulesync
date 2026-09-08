import { z } from "zod/mini";

import type { ValidationResult } from "../../types/ai-file.js";
import { ToolFile } from "../../types/tool-file.js";

/**
 * Current lock format version. Bump when {@link HooksOwnershipLockSchema}
 * changes; a lock written by another version is ignored rather than migrated,
 * which degrades to "preserve everything" — the non-destructive direction.
 */
export const HOOKS_OWNERSHIP_LOCK_VERSION = 1;

/**
 * Name of the ownership record written next to the hooks destination it
 * describes (e.g. `.claude/.rulesync-hooks-lock.json`). Only written when hook
 * preservation is enabled, so a project that never opts in never sees it.
 */
export const HOOKS_OWNERSHIP_LOCK_FILE_NAME = ".rulesync-hooks-lock.json";

/**
 * One hook entry rulesync generated on the previous run. `matcher` is the
 * stable key of the matcher group the handler sat in, absent for flat
 * destinations that have no matcher groups.
 */
export type OwnedHookRef = {
  event: string;
  matcher?: string;
  identity: string;
};

const OwnedHookRefSchema = z.object({
  event: z.string(),
  matcher: z.optional(z.string()),
  identity: z.string(),
});

const HooksOwnershipLockSchema = z.object({
  lockfileVersion: z.number(),
  owned: z.array(OwnedHookRefSchema),
});

/**
 * The comparable form of a hook entry: identical keys mean "the same hook, in
 * the same place". Encoded as JSON so no separator can collide with a matcher
 * or an identity that happens to contain one.
 */
export function ownedHookKey({ event, matcher, identity }: OwnedHookRef): string {
  return JSON.stringify([event, matcher ?? null, identity]);
}

/**
 * Read the previous run's owned set. Anything unreadable — missing, empty,
 * malformed, or written by a different lock version — yields an empty set,
 * which makes every existing handler look third-party and therefore preserved.
 */
export function parseHooksOwnershipLock(content: string | null): ReadonlySet<string> {
  if (content === null || content.trim() === "") {
    return new Set();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return new Set();
  }
  const result = HooksOwnershipLockSchema.safeParse(parsed);
  if (!result.success || result.data.lockfileVersion !== HOOKS_OWNERSHIP_LOCK_VERSION) {
    return new Set();
  }
  return new Set(result.data.owned.map((ref) => ownedHookKey(ref)));
}

function compareOwnedHookRefs(a: OwnedHookRef, b: OwnedHookRef): number {
  const left = ownedHookKey(a);
  const right = ownedHookKey(b);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Serialize the owned set in a stable order so regenerating produces no diff. */
export function serializeHooksOwnershipLock(owned: readonly OwnedHookRef[]): string {
  return `${JSON.stringify(
    {
      lockfileVersion: HOOKS_OWNERSHIP_LOCK_VERSION,
      owned: [...owned].toSorted(compareOwnedHookRefs),
    },
    null,
    2,
  )}\n`;
}

/**
 * The ownership record itself. It is a rulesync by-product rather than tool
 * configuration, so it is deletable: dropping the target should take it along.
 */
export class HooksOwnershipLockFile extends ToolFile {
  override isDeletable(): boolean {
    return true;
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}

/** Build the lock file that records what this run generated. */
export function buildHooksOwnershipLockFile({
  outputRoot,
  relativeDirPath,
  owned,
}: {
  outputRoot: string;
  relativeDirPath: string;
  owned: readonly OwnedHookRef[];
}): HooksOwnershipLockFile {
  return new HooksOwnershipLockFile({
    outputRoot,
    relativeDirPath,
    relativeFilePath: HOOKS_OWNERSHIP_LOCK_FILE_NAME,
    fileContent: serializeHooksOwnershipLock(owned),
    validate: false,
  });
}

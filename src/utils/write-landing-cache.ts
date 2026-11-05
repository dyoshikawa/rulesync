import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Paths `writeLandingPath` (in `file.ts`) found to exist and not be links,
 * remembered for the rest of a {@link withWriteLandingCache} scope.
 *
 * A generate run checks every file it writes, and each check walks from the
 * filesystem root, so the same ancestors were looked up tens of thousands of
 * times per run. Remembering them is safe inside one run because Rulesync
 * never creates a link itself: an entry it writes or deletes afterwards still
 * is not a link, and a walk through a non-link segment does not move. Only a
 * link planted by another process during the run would be missed, and the
 * check could never close that window anyway, since the write happens after it.
 *
 * Links and missing entries are never remembered, so every link is still
 * followed and every entry the run creates is looked up again.
 *
 * This lives in its own module, importing nothing of rulesync's, so tests that
 * mock `file.js` wholesale still run their operation inside the scope.
 */
const knownNonLinkPaths = new AsyncLocalStorage<Set<string>>();

/** The paths the current scope already knows are not links, or `undefined` outside one. */
export function getKnownNonLinkPaths(): Set<string> | undefined {
  return knownNonLinkPaths.getStore();
}

/**
 * Run `operation` with `writeLandingPath` remembering the paths it found to
 * exist and not be links. Outside a scope every walk looks every segment up.
 */
export async function withWriteLandingCache<T>(operation: () => Promise<T>): Promise<T> {
  return await knownNonLinkPaths.run(new Set(), operation);
}

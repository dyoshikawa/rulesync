import type { Logger } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";

/**
 * One setting this generate is about to write that widens what the target tool
 * trusts. `label` names the setting as it appears in the target file (with the
 * value spliced in where the value is what widens), and `reason` is the verb
 * phrase that completes "it ...". They are collected rather than logged one by
 * one so a file that sets many of them produces a single summary line instead
 * of a run of near-identical warnings.
 */
export type TrustAffectingEntry = {
  readonly label: string;
  readonly reason: string;
};

/**
 * One row of a tool's trust-affecting `sandbox` table: the path to inspect, the
 * reason to print, and the predicate that decides whether the value found there
 * actually loosens the policy. `widens` is what keeps a warning off the
 * restrictive value of a key whose permissive value is the one worth naming.
 */
export type TrustAffectingSandboxPath = {
  readonly path: readonly string[];
  readonly reason: string;
  readonly widens: (value: unknown) => boolean;
};

// The predicates the "which value actually widens?" tables are built from.
// Each names the value that does *not* widen and reports everything else, never
// the reverse: an override is authored JSONC, so a key can carry any value at
// all, and one the target tool coerces is still honored. Reporting an off-type
// value keeps the warning fail-safe — silence has to mean "this cannot loosen
// anything", not "this is not the type the table expected".

/** A key whose quiet value is an explicit `false`. */
export const isNotFalse = (value: unknown): boolean => value !== false;

/** A key whose quiet value is an explicit `true`. */
export const isNotTrue = (value: unknown): boolean => value !== true;

/** A list-valued key whose quiet value is the empty list. */
export const isNonEmptyList = (value: unknown): boolean =>
  !Array.isArray(value) || value.length > 0;

/** The map-valued counterpart of {@link isNonEmptyList}. */
export const isNonEmptyMap = (value: unknown): boolean =>
  !isRecord(value) || Object.keys(value).length > 0;

/**
 * What {@link readSandboxPath} returns when a container on the way to the leaf
 * is present but is not an object, so the leaf cannot be read at all. It is not
 * `undefined`, because the two mean opposite things to a caller: `undefined` is
 * "this path is not being written", while this is "something is being written
 * here and its shape hides what". The same fail-safe rule the predicates follow
 * applies to the walk — silence must mean "this cannot loosen anything", not
 * "this is not the shape the table expected".
 */
export const UNREADABLE_SANDBOX_PATH = Symbol("unreadable-sandbox-path");

/**
 * Reads `sandbox` at `path`. Returns `undefined` when a segment is absent, and
 * {@link UNREADABLE_SANDBOX_PATH} when one is present but is not an object.
 * Shared by everything that addresses a `sandbox` path so a nested path added to
 * one of the tables is actually traversed rather than silently skipped, and so a
 * hostile shape (an array, a string, `null`) is reported rather than throwing.
 */
export function readSandboxPath({
  sandbox,
  path,
}: {
  sandbox: Record<string, unknown>;
  path: readonly string[];
}): unknown {
  let cursor: unknown = sandbox;
  for (const segment of path) {
    if (cursor === undefined) return undefined;
    if (!isRecord(cursor)) return UNREADABLE_SANDBOX_PATH;
    cursor = cursor[segment];
  }
  return cursor;
}

/**
 * Every path in `paths` whose value in `sandbox` loosens the policy. Nothing is
 * removed — the values are written, just not silently. Call it on the block this
 * generate authored, after any scope filter has run: a value the file already
 * held is the user's own, not something rulesync opened, and a path a filter
 * dropped is not being written at all.
 */
export function collectTrustAffectingSandboxPaths({
  sandbox,
  paths,
}: {
  sandbox: Record<string, unknown>;
  paths: readonly TrustAffectingSandboxPath[];
}): TrustAffectingEntry[] {
  const entries: TrustAffectingEntry[] = [];
  const reportedContainers = new Set<string>();
  for (const { path, reason, widens } of paths) {
    const value = readSandboxPath({ sandbox, path });
    if (value === undefined) continue;

    // An unreadable container is reported without consulting `widens`: the
    // predicate is written for the leaf's own values, and a shape that hides the
    // leaf is exactly the case silence must not cover. One container usually
    // hides several table rows, so it is named once rather than once per row.
    if (value === UNREADABLE_SANDBOX_PATH) {
      const label = findUnreadableContainer({ sandbox, path });
      if (label === undefined || reportedContainers.has(label)) continue;
      reportedContainers.add(label);
      entries.push({ label, reason: UNREADABLE_CONTAINER_REASON });
      continue;
    }

    if (!widens(value)) continue;
    entries.push({ label: `sandbox.${path.join(".")}`, reason });
  }
  return entries;
}

/** The reason printed for a container that hides the settings underneath it. */
const UNREADABLE_CONTAINER_REASON =
  "is not the object it has to be, so nothing under it can be checked for what it opens";

/**
 * The prefix of `path` that {@link readSandboxPath} could not walk past, as a
 * label. `undefined` when the walk was not blocked at all. Callers that report
 * an unreadable path name the container rather than the leaf, because the leaf
 * is not what the file actually holds.
 */
export function findUnreadableContainer({
  sandbox,
  path,
}: {
  sandbox: Record<string, unknown>;
  path: readonly string[];
}): string | undefined {
  let cursor: unknown = sandbox;
  const walked: string[] = [];
  for (const segment of path) {
    if (cursor === undefined) return undefined;
    // The root itself can be the blocked container, and `sandbox.` is not a
    // path anyone can look up.
    if (!isRecord(cursor)) return walked.length === 0 ? "sandbox" : `sandbox.${walked.join(".")}`;
    walked.push(segment);
    cursor = cursor[segment];
  }
  return undefined;
}

/**
 * One row of the restriction-loss table. It is the mirror of
 * {@link TrustAffectingSandboxPath}: the value alone says nothing, because these
 * paths restrict, so what matters is what the merge takes away from the list the
 * file already had.
 */
export type RestrictionLosingSandboxPath = {
  readonly path: readonly string[];
  readonly reason: string;
  readonly loosens: (args: { before: readonly unknown[]; after: readonly unknown[] }) => boolean;
};

/**
 * The reason printed for a value the file held in a shape that cannot be read,
 * which this generate is about to replace. `shape` names what the tool documents
 * there, so the message says which expectation the file's value missed.
 */
export const replacedUnreadableReason = ({
  shape,
  toolLabel,
}: {
  shape: "list" | "object";
  toolLabel: string;
}): string =>
  `replaces a value already in the file that is not the ${shape} ${toolLabel} documents, so what it restricted cannot be read`;

/**
 * The restrictions this generate would weaken, compared between the `sandbox`
 * already in the file and the one about to replace it. A `before` that is
 * present but not a list is reported outright: a shape the tool may still honor
 * is not something to go quiet about just because it cannot be diffed. Shared by
 * every tool whose override replaces a restricting list whole rather than
 * merging into it — Claude Code needs no equivalent, because it merges its lists
 * across settings scopes, so a file can only ever add to them.
 */
export function collectRestrictionLosingSandboxEntries({
  existing,
  merged,
  paths,
  toolLabel,
}: {
  existing: Record<string, unknown>;
  merged: Record<string, unknown>;
  paths: readonly RestrictionLosingSandboxPath[];
  toolLabel: string;
}): TrustAffectingEntry[] {
  const entries: TrustAffectingEntry[] = [];
  const reportedContainers = new Set<string>();
  for (const { path, reason, loosens } of paths) {
    const before = readSandboxPath({ sandbox: existing, path });
    if (before === undefined) continue;

    // The merge is shallow at the sandbox's top level, so a path is untouched
    // exactly when its first segment still holds the value the file had —
    // nothing was dropped, whatever shape that value is in. Comparing the leaf
    // reads instead would call two unreadable containers identical.
    const [rootKey] = path;
    if (rootKey !== undefined && existing[rootKey] === merged[rootKey]) continue;

    const after = readSandboxPath({ sandbox: merged, path });

    const label = `sandbox.${path.join(".")}`;
    // A value the file holds that is not the list the tool documents, replaced
    // by one that is: whatever it meant, it is not something to overwrite
    // quietly. The row's own reason would claim entries were dropped, which is
    // exactly what cannot be read here. When it is a container on the way that
    // blocks the read, that container is what the file holds — naming the leaf
    // would send the user looking for a path their file does not have.
    if (before === UNREADABLE_SANDBOX_PATH) {
      const container = findUnreadableContainer({ sandbox: existing, path });
      if (container === undefined || reportedContainers.has(container)) continue;
      reportedContainers.add(container);
      entries.push({
        label: container,
        reason: replacedUnreadableReason({ shape: "object", toolLabel }),
      });
      continue;
    }
    if (!Array.isArray(before)) {
      entries.push({ label, reason: replacedUnreadableReason({ shape: "list", toolLabel }) });
      continue;
    }
    if (before.length === 0) continue;

    if (!loosens({ before, after: Array.isArray(after) ? after : [] })) continue;

    entries.push({ label, reason });
  }
  return entries;
}

/**
 * The one warning that names every trust-affecting setting this generate wrote
 * to `relativeFilePath`. Emitted once per file: the individual reasons are what
 * matter, but the "review this as you would a hook" framing only needs saying
 * once, and repeating it per key buries the reasons in boilerplate. `noun` lets
 * a tool whose entries are not all additions call them something more accurate
 * than "setting".
 */
export function warnOnTrustAffectingEntries({
  toolLabel,
  noun = "setting",
  entries,
  relativeFilePath,
  logger,
}: {
  toolLabel: string;
  noun?: string;
  entries: readonly TrustAffectingEntry[];
  relativeFilePath: string;
  logger?: Logger;
}): void {
  if (entries.length === 0) return;
  const one = entries.length === 1;
  const details = entries.map(({ label, reason }) => `'${label}' — ${reason}`).join("; ");
  logger?.warn(
    `${toolLabel} permissions: writing ${entries.length} trust-affecting ${noun}${one ? "" : "s"} to ${relativeFilePath}; review ${one ? "it" : "them"} as you would a hook, especially if this permissions file came from 'rulesync fetch'. ${details}.`,
  );
}

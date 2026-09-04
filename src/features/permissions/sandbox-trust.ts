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

/** A key whose permissive value is anything but an explicit `false`. */
export const isNotFalse = (value: unknown): boolean => value !== false;

/**
 * A list-valued key that widens once it has entries. A value that is not a list
 * at all counts as widening too: a malformed entry is not a reason to go quiet
 * about a key whose whole purpose is to open something up.
 */
export const isNonEmptyList = (value: unknown): boolean =>
  !Array.isArray(value) || value.length > 0;

/** The map-valued counterpart of {@link isNonEmptyList}. */
export const isNonEmptyMap = (value: unknown): boolean =>
  !isRecord(value) || Object.keys(value).length > 0;

/**
 * Reads `sandbox` at `path`, returning `undefined` when a segment is missing or
 * is not an object. Shared by everything that addresses a `sandbox` path so a
 * nested path added to one of the tables is actually traversed rather than
 * silently skipped, and so a hostile shape (an array, a string, `null`) reads as
 * absent instead of throwing.
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
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

/**
 * Every path in `paths` whose value in `sandbox` loosens the policy. Nothing is
 * removed — the values are written, just not silently. Call it on the block
 * that is actually being written, so it never claims to be writing a path a
 * scope filter dropped.
 */
export function collectTrustAffectingSandboxPaths({
  sandbox,
  paths,
}: {
  sandbox: Record<string, unknown>;
  paths: readonly TrustAffectingSandboxPath[];
}): TrustAffectingEntry[] {
  const entries: TrustAffectingEntry[] = [];
  for (const { path, reason, widens } of paths) {
    const value = readSandboxPath({ sandbox, path });
    if (value === undefined || !widens(value)) continue;
    entries.push({ label: `sandbox.${path.join(".")}`, reason });
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

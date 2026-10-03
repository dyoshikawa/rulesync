import { dirname, resolve } from "node:path";

import { writeLandingPath } from "../utils/file.js";

/** A path an orphan sweep deleted, or would delete under `--dry-run`/`--check`. */
export type DeletedPath = { path: string; kind: "file" | "directory" };

/**
 * Run-scoped bookkeeping that keeps the `--delete` orphan sweep from turning
 * one target's output into another target's orphan.
 *
 * Several targets deliberately write into a single directory — `.agents/agents/`
 * is written by every Antigravity target and by the simulated `agentsmd` one,
 * `.agents/skills/` likewise — but each target's sweep enumerates that directory
 * and compares it against only *its own* expected outputs. A sibling's file,
 * written moments earlier in the same run, therefore looks exactly like a
 * leftover from a previous one.
 *
 * Two things fix that together:
 *
 * - {@link OrphanSweepPlan.registerGenerated} (and its directory-tree sibling
 *   {@link OrphanSweepPlan.registerGeneratedTree}) records every path the run
 *   intends to write, across all targets and all features, so a sweep can tell a
 *   sibling's fresh output from a genuine orphan.
 * - {@link OrphanSweepPlan.defer} holds the sweeps back until every generation
 *   step has written. Registration alone would still depend on target order
 *   (the first target sweeps before the second has written anything), and
 *   deleting a file that a later step immediately rewrites is what makes
 *   `generate --check` report a permanently out-of-date tree.
 *
 * Paths are keyed by {@link resolve} so that the same file reached through
 * different-but-equivalent output roots compares equal. Case folding is
 * deliberately *not* applied: it is a separate, filesystem-dependent concern,
 * and it can only miss a claim, never invent one.
 *
 * The checks a sweep asks before it deletes ({@link OrphanSweepPlan.rejectClaimed}
 * and {@link OrphanSweepPlan.isGeneratedExactly}) also follow symbolic links: a
 * path that matches no claim as spelled is compared again by where it lands.
 * `.cursor/commands` linked to `.claude/commands` is one directory under two
 * spellings, so a file only one tool generates must not read as the other's
 * orphan. Following links only adds matches, so it never sweeps a path the
 * lexical comparison keeps.
 */
export type OrphanSweepPlan = {
  /** Record paths this run writes, so no later sweep treats them as orphans. */
  registerGenerated(params: { paths: string[] }): void;
  /**
   * Record directories this run writes as whole trees.
   *
   * Directory features (skills) know the directory they produce but not every
   * file inside it — `SKILL.md` and its companions are written by the `AiDir`
   * itself. Claiming the tree covers those without each feature having to
   * enumerate them, which matters because deferring the sweeps means a
   * *file* feature's sweep now runs after the skills step has written.
   */
  registerGeneratedTree(params: { paths: string[] }): void;
  /** True when some target in this run wrote, or intends to write, `path`. */
  isGenerated(params: { path: string }): boolean;
  /**
   * True when some target in this run wrote, or intends to write, exactly
   * `path` — a tree claim on an ancestor does not count.
   *
   * For a sweep that looks *inside* a claimed tree. {@link isGenerated} answers
   * yes for every path under such a tree, which is the right answer for a sweep
   * deciding whether to delete the tree and useless for one deciding which
   * files within it the run actually wrote.
   */
  isGeneratedExactly(params: { path: string }): Promise<boolean>;
  /** Drop every item this run claims; what remains is a genuine orphan candidate. */
  rejectClaimed<T>(params: { items: T[]; getPath: (item: T) => string }): Promise<T[]>;
  /**
   * Hold a sweep back until every generation step has written its files.
   *
   * `reportDeleted`, read once the sweep has run, names the paths it deleted
   * (or, under `--dry-run`/`--check`, would have deleted). It is attributed to
   * the feature of the {@link forFeature} view the sweep was deferred through.
   */
  defer(params: {
    sweep: () => Promise<boolean>;
    reportDeleted?: () => readonly DeletedPath[];
  }): void;
  /** Run the deferred sweeps in registration order; true if anything changed. */
  run(): Promise<boolean>;
  /**
   * A view of this plan whose deferred sweeps report their deletions under
   * `feature`. Every other method acts on the shared plan unchanged.
   */
  forFeature(feature: string): OrphanSweepPlan;
  /**
   * The paths the sweeps that already ran reported as deleted, keyed by the
   * feature they were deferred under and sorted within each feature, so two
   * previews of the same tree list them identically.
   */
  getDeletedPathsByFeature(): ReadonlyMap<string, readonly DeletedPath[]>;
};

type DeferredSweep = {
  sweep: () => Promise<boolean>;
  reportDeleted?: () => readonly DeletedPath[];
  feature?: string;
};

export function createOrphanSweepPlan(): OrphanSweepPlan {
  const generatedPaths = new Set<string>();
  const generatedTrees = new Set<string>();
  const deferredSweeps: DeferredSweep[] = [];
  const deletedPathsByFeature = new Map<string, DeletedPath[]>();

  // Built on first use and dropped when a claim is added.
  let landingClaims: Promise<{ paths: Set<string>; trees: Set<string> }> | undefined;

  const isInsideTree = ({ path, trees }: { path: string; trees: Set<string> }): boolean => {
    let current = path;
    let parent = dirname(current);
    // `dirname` is its own fixed point at the filesystem root, which ends the walk.
    while (parent !== current) {
      if (trees.has(parent)) return true;
      current = parent;
      parent = dirname(current);
    }
    return false;
  };

  // `null` for a cycle or a link that cannot be read.
  const followLinks = async (path: string): Promise<string | null> => {
    try {
      return await writeLandingPath(path);
    } catch {
      return null;
    }
  };

  const landingsOf = async (paths: Set<string>): Promise<Set<string>> => {
    const landings = await Promise.all([...paths].map((path) => followLinks(path)));
    return new Set(landings.filter((landing): landing is string => landing !== null));
  };

  const getLandingClaims = () => {
    landingClaims ??= Promise.all([landingsOf(generatedPaths), landingsOf(generatedTrees)]).then(
      ([paths, trees]) => ({
        paths,
        // The same guard `registerGeneratedTree` applies to the spelled path.
        trees: new Set([...trees].filter((tree) => dirname(tree) !== tree)),
      }),
    );
    return landingClaims;
  };

  const landsOnClaim = async ({ path, exactly }: { path: string; exactly: boolean }) => {
    // A path whose links cannot be followed is kept: not deleting is the safe answer.
    const landing = await followLinks(resolve(path));
    if (landing === null) return true;
    const claims = await getLandingClaims();
    return (
      claims.paths.has(landing) ||
      (!exactly && isInsideTree({ path: landing, trees: claims.trees }))
    );
  };

  const plan: OrphanSweepPlan = {
    registerGenerated({ paths }) {
      landingClaims = undefined;
      for (const path of paths) {
        generatedPaths.add(resolve(path));
      }
    },
    registerGeneratedTree({ paths }) {
      landingClaims = undefined;
      for (const path of paths) {
        const resolved = resolve(path);
        generatedPaths.add(resolved);
        // Defense in depth against a tree root that collapsed onto something far
        // broader than one generated directory: claiming a filesystem root would
        // silence every sweep in the run. `AiDir` rejects the names that can
        // collapse that far, so this only ever fires on a future regression —
        // claim the path itself, never the tree.
        if (dirname(resolved) !== resolved) {
          generatedTrees.add(resolved);
        }
      }
    },
    isGenerated({ path }) {
      const resolved = resolve(path);
      return (
        generatedPaths.has(resolved) || isInsideTree({ path: resolved, trees: generatedTrees })
      );
    },
    async isGeneratedExactly({ path }) {
      return generatedPaths.has(resolve(path)) || (await landsOnClaim({ path, exactly: true }));
    },
    async rejectClaimed({ items, getPath }) {
      const claimed = await Promise.all(
        items.map(
          async (item) =>
            plan.isGenerated({ path: getPath(item) }) ||
            (await landsOnClaim({ path: getPath(item), exactly: false })),
        ),
      );
      return items.filter((_, index) => !claimed[index]);
    },
    defer({ sweep, reportDeleted }) {
      deferredSweeps.push({ sweep, reportDeleted });
    },
    async run() {
      let hasDiff = false;
      for (const { sweep, reportDeleted, feature } of deferredSweeps) {
        if (await sweep()) hasDiff = true;
        if (feature === undefined || reportDeleted === undefined) continue;
        const deleted = reportDeleted();
        if (deleted.length === 0) continue;
        const existing = deletedPathsByFeature.get(feature) ?? [];
        existing.push(...deleted);
        deletedPathsByFeature.set(feature, existing);
      }
      deferredSweeps.length = 0;
      return hasDiff;
    },
    forFeature(feature) {
      return {
        ...plan,
        defer({ sweep, reportDeleted }) {
          deferredSweeps.push({ sweep, reportDeleted, feature });
        },
      };
    },
    getDeletedPathsByFeature() {
      return new Map(
        [...deletedPathsByFeature].map(([feature, deleted]) => {
          // Keyed path-first so the sort below orders by path, independent of locale.
          const unique = new Map(deleted.map((entry) => [`${entry.path}\0${entry.kind}`, entry]));
          return [feature, [...unique.keys()].toSorted().map((key) => unique.get(key)!)];
        }),
      );
    },
  };

  return plan;
}

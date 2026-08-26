import { dirname, resolve } from "node:path";

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
 * different-but-equivalent output roots compares equal. Two normalizations are
 * deliberately *not* applied: case folding (a separate, filesystem-dependent
 * concern) and symlink resolution (`resolve` is purely lexical, so two output
 * roots that reach one directory through different symlinks still hash apart).
 * Neither can invent a claim, only miss one — but a missed claim is not free:
 * with the sweeps deferred, both writers of such a directory now sweep after
 * both have written, so a spelling this plan cannot match loses the accidental
 * protection that write/sweep interleaving used to give one of them.
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
  /** Drop every item this run claims; what remains is a genuine orphan candidate. */
  rejectClaimed<T>(params: { items: T[]; getPath: (item: T) => string }): T[];
  /** Hold a sweep back until every generation step has written its files. */
  defer(params: { sweep: () => Promise<boolean> }): void;
  /** Run the deferred sweeps in registration order; true if anything changed. */
  run(): Promise<boolean>;
};

export function createOrphanSweepPlan(): OrphanSweepPlan {
  const generatedPaths = new Set<string>();
  const generatedTrees = new Set<string>();
  const deferredSweeps: Array<() => Promise<boolean>> = [];

  const isInsideGeneratedTree = (absolutePath: string): boolean => {
    let current = absolutePath;
    let parent = dirname(current);
    // `dirname` is its own fixed point at the filesystem root, which ends the walk.
    while (parent !== current) {
      if (generatedTrees.has(parent)) return true;
      current = parent;
      parent = dirname(current);
    }
    return false;
  };

  const plan: OrphanSweepPlan = {
    registerGenerated({ paths }) {
      for (const path of paths) {
        generatedPaths.add(resolve(path));
      }
    },
    registerGeneratedTree({ paths }) {
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
      return generatedPaths.has(resolved) || isInsideGeneratedTree(resolved);
    },
    rejectClaimed({ items, getPath }) {
      return items.filter((item) => !plan.isGenerated({ path: getPath(item) }));
    },
    defer({ sweep }) {
      deferredSweeps.push(sweep);
    },
    async run() {
      let hasDiff = false;
      for (const sweep of deferredSweeps) {
        if (await sweep()) hasDiff = true;
      }
      deferredSweeps.length = 0;
      return hasDiff;
    },
  };

  return plan;
}

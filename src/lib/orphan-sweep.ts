import { resolve } from "node:path";

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
 * - {@link OrphanSweepPlan.registerGenerated} records every path the run intends
 *   to write, across all targets and all features, so a sweep can tell a
 *   sibling's fresh output from a genuine orphan.
 * - {@link OrphanSweepPlan.defer} holds the sweeps back until every generation
 *   step has written. Registration alone would still depend on target order
 *   (the first target sweeps before the second has written anything), and
 *   deleting a file that a later step immediately rewrites is what makes
 *   `generate --check` report a permanently out-of-date tree.
 *
 * Paths are keyed by {@link resolve} so that the same file reached through
 * different-but-equivalent output roots compares equal. Case-only differences
 * are deliberately *not* normalized: that is a separate, filesystem-dependent
 * concern.
 */
export type OrphanSweepPlan = {
  /** Record paths this run writes, so no later sweep treats them as orphans. */
  registerGenerated(params: { paths: string[] }): void;
  /** True when some target in this run wrote, or intends to write, `path`. */
  isGenerated(params: { path: string }): boolean;
  /** Hold a sweep back until every generation step has written its files. */
  defer(params: { sweep: () => Promise<boolean> }): void;
  /** Run the deferred sweeps in registration order; true if anything changed. */
  run(): Promise<boolean>;
};

export function createOrphanSweepPlan(): OrphanSweepPlan {
  const generatedPaths = new Set<string>();
  const deferredSweeps: Array<() => Promise<boolean>> = [];

  return {
    registerGenerated({ paths }) {
      for (const path of paths) {
        generatedPaths.add(resolve(path));
      }
    },
    isGenerated({ path }) {
      return generatedPaths.has(resolve(path));
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
}

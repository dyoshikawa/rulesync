import { join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createOrphanSweepPlan } from "./orphan-sweep.js";

describe("createOrphanSweepPlan", () => {
  describe("registerGenerated", () => {
    it("should report a registered path as generated", () => {
      const plan = createOrphanSweepPlan();

      plan.registerGenerated({ paths: [join("out", ".agents", "agents", "reviewer.md")] });

      expect(plan.isGenerated({ path: join("out", ".agents", "agents", "reviewer.md") })).toBe(
        true,
      );
      expect(plan.isGenerated({ path: join("out", ".agents", "agents", "other.md") })).toBe(false);
    });

    it("should match paths that resolve to the same file", () => {
      // Two targets reach one shared directory through different-but-equivalent
      // output roots, so a raw string comparison would miss the match and let
      // one target sweep away the other's file.
      const plan = createOrphanSweepPlan();

      plan.registerGenerated({ paths: [join("out", ".agents", "agents", "reviewer.md")] });

      expect(
        plan.isGenerated({
          path: join(resolve("out"), "nested", "..", ".agents", "agents", "reviewer.md"),
        }),
      ).toBe(true);
    });

    it("should accumulate across calls", () => {
      const plan = createOrphanSweepPlan();

      plan.registerGenerated({ paths: [join("out", "a.md")] });
      plan.registerGenerated({ paths: [join("out", "b.md")] });

      expect(plan.isGenerated({ path: join("out", "a.md") })).toBe(true);
      expect(plan.isGenerated({ path: join("out", "b.md") })).toBe(true);
    });
  });

  describe("run", () => {
    it("should run nothing before it is called", async () => {
      const plan = createOrphanSweepPlan();
      const sweep = vi.fn().mockResolvedValue(false);

      plan.defer({ sweep });
      expect(sweep).not.toHaveBeenCalled();

      await plan.run();
      expect(sweep).toHaveBeenCalledTimes(1);
    });

    it("should run the deferred sweeps in registration order", async () => {
      const plan = createOrphanSweepPlan();
      const order: string[] = [];

      plan.defer({
        sweep: async () => {
          order.push("first");
          return false;
        },
      });
      plan.defer({
        sweep: async () => {
          order.push("second");
          return false;
        },
      });

      await plan.run();

      expect(order).toEqual(["first", "second"]);
    });

    it("should report a diff when any sweep deleted something", async () => {
      const plan = createOrphanSweepPlan();

      plan.defer({ sweep: async () => false });
      plan.defer({ sweep: async () => true });

      await expect(plan.run()).resolves.toBe(true);
    });

    it("should report no diff when every sweep was a no-op", async () => {
      const plan = createOrphanSweepPlan();

      plan.defer({ sweep: async () => false });

      await expect(plan.run()).resolves.toBe(false);
    });

    it("should report no diff when nothing was deferred", async () => {
      await expect(createOrphanSweepPlan().run()).resolves.toBe(false);
    });

    it("should not re-run a sweep on a second run", async () => {
      // `--watch` keeps one process alive across regenerations; a plan drained
      // twice must not delete against a stale expectation of the tree.
      const plan = createOrphanSweepPlan();
      const sweep = vi.fn().mockResolvedValue(true);

      plan.defer({ sweep });
      await plan.run();
      await expect(plan.run()).resolves.toBe(false);

      expect(sweep).toHaveBeenCalledTimes(1);
    });
  });
});

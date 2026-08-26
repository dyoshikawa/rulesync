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
      // `generate()` builds a fresh plan per run, so a second drain is never
      // part of the normal flow; draining once keeps it that way rather than
      // silently sweeping twice if a caller ever loops over one plan.
      const plan = createOrphanSweepPlan();
      const sweep = vi.fn().mockResolvedValue(true);

      plan.defer({ sweep });
      await plan.run();
      await expect(plan.run()).resolves.toBe(false);

      expect(sweep).toHaveBeenCalledTimes(1);
    });
  });

  describe("registerGeneratedTree", () => {
    it("should report a file inside a registered tree as generated", () => {
      const plan = createOrphanSweepPlan();

      plan.registerGeneratedTree({ paths: [join("out", ".agents", "skills", "review")] });

      expect(
        plan.isGenerated({ path: join("out", ".agents", "skills", "review", "SKILL.md") }),
      ).toBe(true);
      expect(
        plan.isGenerated({
          path: join("out", ".agents", "skills", "review", "reference", "notes.md"),
        }),
      ).toBe(true);
      expect(plan.isGenerated({ path: join("out", ".agents", "skills", "review") })).toBe(true);
    });

    it("should not report a sibling of a registered tree as generated", () => {
      const plan = createOrphanSweepPlan();

      plan.registerGeneratedTree({ paths: [join("out", ".agents", "skills", "review")] });

      expect(plan.isGenerated({ path: join("out", ".agents", "skills", "review-old") })).toBe(
        false,
      );
      expect(
        plan.isGenerated({ path: join("out", ".agents", "skills", "other", "SKILL.md") }),
      ).toBe(false);
    });

    it("should not claim the ancestors of a registered tree", () => {
      const plan = createOrphanSweepPlan();

      plan.registerGeneratedTree({ paths: [join("out", ".agents", "skills", "review")] });

      expect(plan.isGenerated({ path: join("out", ".agents", "skills") })).toBe(false);
    });
  });

  describe("rejectClaimed", () => {
    it("should keep only the items this run did not claim", () => {
      const plan = createOrphanSweepPlan();
      const generated = join("out", ".agents", "agents", "reviewer.md");
      const insideTree = join("out", ".agents", "skills", "review", "SKILL.md");
      const orphan = join("out", ".agents", "agents", "left-over.md");

      plan.registerGenerated({ paths: [generated] });
      plan.registerGeneratedTree({ paths: [join("out", ".agents", "skills", "review")] });

      expect(
        plan.rejectClaimed({
          items: [{ path: generated }, { path: insideTree }, { path: orphan }],
          getPath: (item) => item.path,
        }),
      ).toEqual([{ path: orphan }]);
    });
  });
});

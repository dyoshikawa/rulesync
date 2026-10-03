import { symlink } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir } from "../utils/file.js";
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

    it("should attribute reported deletions to the feature they were deferred under", async () => {
      const plan = createOrphanSweepPlan();

      plan.forFeature("rules").defer({
        sweep: async () => true,
        reportDeleted: () => [
          { path: "b.md", kind: "file" },
          { path: "a.md", kind: "file" },
        ],
      });
      plan.forFeature("skills").defer({
        sweep: async () => true,
        reportDeleted: () => [{ path: ".claude/skills/old", kind: "directory" }],
      });
      plan.forFeature("rules").defer({
        sweep: async () => true,
        // A second output root or target reporting a path already listed.
        reportDeleted: () => [{ path: "a.md", kind: "file" }],
      });
      // Deferred on the plan itself: run, but attributed to no feature.
      plan.defer({
        sweep: async () => true,
        reportDeleted: () => [{ path: "x.md", kind: "file" }],
      });

      await plan.run();

      expect(Object.fromEntries(plan.getDeletedPathsByFeature())).toEqual({
        rules: [
          { path: "a.md", kind: "file" },
          { path: "b.md", kind: "file" },
        ],
        skills: [{ path: ".claude/skills/old", kind: "directory" }],
      });
    });

    it("should share claims between a feature view and the plan", () => {
      const plan = createOrphanSweepPlan();

      plan.forFeature("rules").registerGenerated({ paths: [join("out", "a.md")] });

      expect(plan.isGenerated({ path: join("out", "a.md") })).toBe(true);
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

    it("should not claim the whole filesystem when handed a root path", () => {
      // `AiDir` rejects the names that could collapse a tree root this far, but a
      // claimed root would silence every sweep in the run, so the plan refuses to
      // widen a root path into a tree.
      const plan = createOrphanSweepPlan();
      const root = resolve("/");

      plan.registerGeneratedTree({ paths: [root] });

      expect(plan.isGenerated({ path: root })).toBe(true);
      expect(plan.isGenerated({ path: join(root, "anything", "at", "all.md") })).toBe(false);
    });

    it("should not claim the ancestors of a registered tree", () => {
      const plan = createOrphanSweepPlan();

      plan.registerGeneratedTree({ paths: [join("out", ".agents", "skills", "review")] });

      expect(plan.isGenerated({ path: join("out", ".agents", "skills") })).toBe(false);
    });
  });

  describe("isGeneratedExactly", () => {
    it("should not answer for a file merely inside a registered tree", async () => {
      // The sweep that looks inside a generated skill directory asks this: the
      // tree claim covers every candidate it could consider, so only the names
      // the run actually wrote may protect a file from it.
      const plan = createOrphanSweepPlan();
      const dirPath = join("out", ".agents", "skills", "review");

      plan.registerGeneratedTree({ paths: [dirPath] });
      plan.registerGenerated({ paths: [join(dirPath, "SKILL.md")] });

      expect(await plan.isGeneratedExactly({ path: join(dirPath, "SKILL.md") })).toBe(true);
      expect(await plan.isGeneratedExactly({ path: join(dirPath, "stale.md") })).toBe(false);
      // The tree claim still answers for the sweep that decides on directories.
      expect(plan.isGenerated({ path: join(dirPath, "stale.md") })).toBe(true);
    });
  });

  describe("rejectClaimed", () => {
    it("should keep only the items this run did not claim", async () => {
      const plan = createOrphanSweepPlan();
      const generated = join("out", ".agents", "agents", "reviewer.md");
      const insideTree = join("out", ".agents", "skills", "review", "SKILL.md");
      const orphan = join("out", ".agents", "agents", "left-over.md");

      plan.registerGenerated({ paths: [generated] });
      plan.registerGeneratedTree({ paths: [join("out", ".agents", "skills", "review")] });

      expect(
        await plan.rejectClaimed({
          items: [{ path: generated }, { path: insideTree }, { path: orphan }],
          getPath: (item) => item.path,
        }),
      ).toEqual([{ path: orphan }]);
    });
  });

  describe.skipIf(process.platform === "win32")("claims reached through a symbolic link", () => {
    // One output directory shared by two tools through a link, here
    // `~/.cursor/commands -> ~/.claude/commands`, is the same directory under
    // two spellings. A path only one tool generates must not read as the other
    // tool's orphan, or every `--delete` run deletes what the run just wrote.
    let testDir: string;
    let cleanup: () => Promise<void>;
    let claudeDir: string;
    let cursorDir: string;

    beforeEach(async () => {
      ({ testDir, cleanup } = await setupTestDirectory());
      claudeDir = join(testDir, "home", ".claude", "commands");
      cursorDir = join(testDir, "home", ".cursor", "commands");
    });

    afterEach(async () => {
      await cleanup();
    });

    it("should reject a candidate reached through a link to a claimed tree", async () => {
      await ensureDir(join(claudeDir, "only-claude"));
      await ensureDir(join(testDir, "home", ".cursor"));
      await symlink(claudeDir, cursorDir);
      const plan = createOrphanSweepPlan();

      plan.registerGeneratedTree({ paths: [join(claudeDir, "only-claude")] });

      expect(
        await plan.rejectClaimed({
          items: [join(cursorDir, "only-claude")],
          getPath: (path) => path,
        }),
      ).toEqual([]);
    });

    it("should reject a candidate whose claim was registered through a link", async () => {
      await ensureDir(join(cursorDir, "only-claude"));
      await ensureDir(join(testDir, "home", ".claude"));
      await symlink(cursorDir, claudeDir);
      const plan = createOrphanSweepPlan();

      plan.registerGeneratedTree({ paths: [join(claudeDir, "only-claude")] });

      expect(
        await plan.rejectClaimed({
          items: [join(cursorDir, "only-claude")],
          getPath: (path) => path,
        }),
      ).toEqual([]);
    });

    it("should keep an unclaimed candidate reached through a link", async () => {
      await ensureDir(join(claudeDir, "only-claude"));
      await ensureDir(join(claudeDir, "stale"));
      await ensureDir(join(testDir, "home", ".cursor"));
      await symlink(claudeDir, cursorDir);
      const plan = createOrphanSweepPlan();

      plan.registerGeneratedTree({ paths: [join(claudeDir, "only-claude")] });

      expect(
        await plan.rejectClaimed({
          items: [join(cursorDir, "stale")],
          getPath: (path) => path,
        }),
      ).toEqual([join(cursorDir, "stale")]);
    });

    it("should answer isGeneratedExactly for a file reached through a link", async () => {
      await ensureDir(join(claudeDir, "shared"));
      await ensureDir(join(testDir, "home", ".cursor"));
      await symlink(claudeDir, cursorDir);
      const plan = createOrphanSweepPlan();

      plan.registerGenerated({ paths: [join(claudeDir, "shared", "claude-only.md")] });

      expect(
        await plan.isGeneratedExactly({ path: join(cursorDir, "shared", "claude-only.md") }),
      ).toBe(true);
      expect(await plan.isGeneratedExactly({ path: join(cursorDir, "shared", "stale.md") })).toBe(
        false,
      );
    });
  });
});

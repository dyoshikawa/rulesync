import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { DEFAULT_TAKT_SKILL_DIR, TaktSkill } from "./takt-skill.js";

describe("TaktSkill", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("defaults to the knowledge facet directory", () => {
      expect(TaktSkill.getSettablePaths().relativeDirPath).toBe(
        join(".takt", "facets", DEFAULT_TAKT_SKILL_DIR),
      );
      expect(DEFAULT_TAKT_SKILL_DIR).toBe("knowledge");
    });
  });

  describe("fromRulesyncSkill", () => {
    it("emits a single flat .md file under knowledge/", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        dirName: "runbook",
        frontmatter: {
          name: "runbook",
          description: "runbook procedures",
          targets: ["*"],
        },
        body: "Runbook body",
      });

      const skill = TaktSkill.fromRulesyncSkill({ baseDir: testDir, rulesyncSkill });
      expect(skill.getRelativeDirPath()).toBe(join(".takt", "facets", "knowledge"));
      expect(skill.getFileName()).toBe("runbook.md");
      expect(skill.getBody()).toBe("Runbook body");
      // getDirPath drops the dirName segment so the main file lands directly
      // under the facet directory.
      expect(skill.getDirPath()).toBe(join(testDir, ".takt", "facets", "knowledge"));
    });

    it("renames the stem with takt.name", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        dirName: "long-source",
        frontmatter: {
          name: "long-source",
          description: "x",
          targets: ["*"],
          ...({ takt: { name: "short" } } as Record<string, unknown>),
        },
        body: "body",
      });

      const skill = TaktSkill.fromRulesyncSkill({ baseDir: testDir, rulesyncSkill });
      expect(skill.getFileName()).toBe("short.md");
      expect(skill.getRelativeDirPath()).toBe(join(".takt", "facets", "knowledge"));
    });

    it("throws on an unsafe takt.name value", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        dirName: "src",
        frontmatter: {
          name: "src",
          description: "x",
          targets: ["*"],
          ...({ takt: { name: "../escape" } } as Record<string, unknown>),
        },
        body: "x",
      });
      expect(() => TaktSkill.fromRulesyncSkill({ baseDir: testDir, rulesyncSkill })).toThrow(
        /Invalid takt\.name/,
      );
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it.each([
      [["*"], true],
      [["takt"], true],
      [["claudecode"], false],
    ] as const)("targets=%j → %s", (targets, expected) => {
      const r = new RulesyncSkill({
        baseDir: testDir,
        dirName: "x",
        frontmatter: { name: "x", description: "x", targets: [...targets] },
        body: "y",
      });
      expect(TaktSkill.isTargetedByRulesyncSkill(r)).toBe(expected);
    });
  });

  describe("getDirPath path-traversal guard", () => {
    it("throws when relativeDirPath escapes baseDir", () => {
      const skill = new TaktSkill({
        baseDir: testDir,
        relativeDirPath: join("..", "escape"),
        dirName: "x",
        fileName: "x.md",
        body: "y",
        validate: false,
      });
      expect(() => skill.getDirPath()).toThrow(/Path traversal detected/);
    });
  });

  describe("fromDir / toRulesyncSkill (unsupported)", () => {
    it("fromDir throws because reverse import is unsupported", async () => {
      await expect(TaktSkill.fromDir({ baseDir: testDir, dirName: "x" })).rejects.toThrow(
        /not supported/,
      );
    });

    it("toRulesyncSkill throws because reverse import is unsupported", () => {
      const skill = new TaktSkill({
        baseDir: testDir,
        relativeDirPath: join(".takt", "facets", "knowledge"),
        dirName: "x",
        fileName: "x.md",
        body: "y",
      });
      expect(() => skill.toRulesyncSkill()).toThrow(/not supported/);
    });
  });

  describe("forDeletion", () => {
    it("constructs an empty instance for deletion", () => {
      const skill = TaktSkill.forDeletion({
        baseDir: testDir,
        relativeDirPath: join(".takt", "facets", "knowledge"),
        dirName: "x",
      });
      expect(skill.getBody()).toBe("");
      expect(skill.getFileName()).toBe("x.md");
    });
  });
});

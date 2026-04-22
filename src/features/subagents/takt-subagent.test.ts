import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { TaktSubagent } from "./takt-subagent.js";

describe("TaktSubagent", () => {
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
    it("returns the personas facet directory", () => {
      expect(TaktSubagent.getSettablePaths().relativeDirPath).toBe(
        join(".takt", "facets", "personas"),
      );
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("emits a plain Markdown body under personas/", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "planner.md",
        frontmatter: {
          targets: ["*"],
          name: "planner",
          description: "plans",
        },
        body: "You are the planner.",
      });

      const sub = TaktSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: join(".takt", "facets", "personas"),
        rulesyncSubagent,
      });
      expect(sub.getRelativeDirPath()).toBe(join(".takt", "facets", "personas"));
      expect(sub.getRelativeFilePath()).toBe("planner.md");
      expect(sub.getFileContent()).toBe("You are the planner.");
    });

    it("renames the stem with takt.name", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "long.md",
        frontmatter: {
          targets: ["*"],
          name: "long",
          ...({ takt: { name: "short" } } as Record<string, unknown>),
        },
        body: "body",
      });

      const sub = TaktSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: join(".takt", "facets", "personas"),
        rulesyncSubagent,
      });
      expect(sub.getRelativeFilePath()).toBe("short.md");
      expect(sub.getRelativeDirPath()).toBe(join(".takt", "facets", "personas"));
    });

    it("throws on an unsafe takt.name value", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "src.md",
        frontmatter: {
          targets: ["*"],
          name: "src",
          ...({ takt: { name: "../escape" } } as Record<string, unknown>),
        },
        body: "x",
      });
      expect(() =>
        TaktSubagent.fromRulesyncSubagent({
          baseDir: testDir,
          relativeDirPath: join(".takt", "facets", "personas"),
          rulesyncSubagent,
        }),
      ).toThrow(/Invalid takt\.name/);
    });
  });

  describe("fromFile", () => {
    it("loads a plain Markdown personas file", async () => {
      const dir = join(testDir, ".takt", "facets", "personas");
      await ensureDir(dir);
      await writeFileContent(join(dir, "p.md"), "body\n");

      const sub = await TaktSubagent.fromFile({ baseDir: testDir, relativeFilePath: "p.md" });
      expect(sub.getBody()).toBe("body");
    });
  });

  describe("forDeletion", () => {
    it("constructs a deletable empty instance", () => {
      const sub = TaktSubagent.forDeletion({
        baseDir: testDir,
        relativeDirPath: join(".takt", "facets", "personas"),
        relativeFilePath: "p.md",
      });
      expect(sub.getFileContent()).toBe("");
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it.each([
      [["*"], true],
      [["takt"], true],
      [["claudecode"], false],
    ] as const)("targets=%j → %s", (targets, expected) => {
      const r = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "x.md",
        frontmatter: { targets: [...targets], name: "x" },
        body: "y",
      });
      expect(TaktSubagent.isTargetedByRulesyncSubagent(r)).toBe(expected);
    });
  });
});

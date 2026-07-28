import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { GooseSubagent } from "./goose-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

const buildRulesyncSubagent = (overrides?: {
  body?: string;
  name?: string;
  description?: string;
  goose?: Record<string, unknown>;
}): RulesyncSubagent =>
  new RulesyncSubagent({
    relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    relativeFilePath: `${overrides?.name ?? "planner"}.md`,
    frontmatter: {
      targets: ["*"],
      name: overrides?.name ?? "planner",
      description: overrides?.description ?? "Plans tasks",
      ...(overrides?.goose ? { goose: overrides.goose } : {}),
    },
    body: overrides?.body ?? "Break down tasks into steps.",
  });

describe("GooseSubagent", () => {
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
    it("returns the project custom-agents dir", () => {
      expect(GooseSubagent.getSettablePaths().relativeDirPath).toBe(join(".goose", "agents"));
    });

    it("returns the global custom-agents dir", () => {
      expect(GooseSubagent.getSettablePaths({ global: true }).relativeDirPath).toBe(
        join(".config", "goose", "agents"),
      );
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("emits a Markdown custom-agent file with name/description frontmatter", () => {
      const subagent = GooseSubagent.fromRulesyncSubagent({
        relativeDirPath: join(".goose", "agents"),
        rulesyncSubagent: buildRulesyncSubagent(),
      }) as GooseSubagent;

      expect(subagent.getRelativeDirPath()).toBe(join(".goose", "agents"));
      expect(subagent.getRelativeFilePath()).toBe("planner.md");
      expect(subagent.getFrontmatter()).toEqual({
        name: "planner",
        description: "Plans tasks",
      });
      expect(subagent.getBody()).toBe("Break down tasks into steps.");
      expect(subagent.getFileContent()).toContain("name: planner");
      expect(subagent.getFileContent()).toContain("Break down tasks into steps.");
    });

    it("carries model and future fields through the goose section", () => {
      const subagent = GooseSubagent.fromRulesyncSubagent({
        relativeDirPath: join(".goose", "agents"),
        rulesyncSubagent: buildRulesyncSubagent({
          goose: { model: "claude-sonnet-5", futureField: "kept" },
        }),
      }) as GooseSubagent;

      const frontmatter = subagent.getFrontmatter() as Record<string, unknown>;
      expect(frontmatter.model).toBe("claude-sonnet-5");
      expect(frontmatter.futureField).toBe("kept");
    });

    it("strips recipe-only keys of the retired sub-recipe surface", () => {
      const subagent = GooseSubagent.fromRulesyncSubagent({
        relativeDirPath: join(".goose", "agents"),
        rulesyncSubagent: buildRulesyncSubagent({
          goose: {
            version: "1.0.0",
            title: "planner",
            instructions: "old override",
            extensions: [{ name: "dev" }],
            model: "fast",
          },
        }),
      }) as GooseSubagent;

      const frontmatter = subagent.getFrontmatter() as Record<string, unknown>;
      // Recipe fields have no meaning on a custom-agent file; the old
      // goose.instructions body override is gone by design.
      expect(frontmatter.version).toBeUndefined();
      expect(frontmatter.title).toBeUndefined();
      expect(frontmatter.instructions).toBeUndefined();
      expect(frontmatter.extensions).toBeUndefined();
      expect(frontmatter.model).toBe("fast");
      expect(subagent.getBody()).toBe("Break down tasks into steps.");
    });

    it("writes to the global custom-agents dir when global is set", () => {
      const subagent = GooseSubagent.fromRulesyncSubagent({
        relativeDirPath: join(".config", "goose", "agents"),
        rulesyncSubagent: buildRulesyncSubagent(),
        global: true,
      }) as GooseSubagent;

      expect(subagent.getRelativeDirPath()).toBe(join(".config", "goose", "agents"));
    });
  });

  describe("toRulesyncSubagent", () => {
    it("round-trips name/description/body and lifts extras into the goose section", () => {
      const subagent = new GooseSubagent({
        relativeDirPath: join(".goose", "agents"),
        relativeFilePath: "planner.md",
        frontmatter: { name: "planner", description: "Plans tasks", model: "fast" },
        body: "Break down tasks into steps.",
      });

      const rulesync = subagent.toRulesyncSubagent();
      const frontmatter = rulesync.getFrontmatter();
      expect(frontmatter.name).toBe("planner");
      expect(frontmatter.description).toBe("Plans tasks");
      expect(frontmatter.goose).toEqual({ model: "fast" });
      expect(rulesync.getBody()).toBe("Break down tasks into steps.");
    });
  });

  describe("fromFile", () => {
    it("loads a custom-agent file from disk", async () => {
      await writeFileContent(
        join(testDir, ".goose", "agents", "planner.md"),
        "---\nname: planner\ndescription: Plans tasks\nmodel: fast\n---\n\nBreak down tasks.",
      );

      const subagent = await GooseSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "planner.md",
      });

      expect(subagent.getFrontmatter().name).toBe("planner");
      expect(subagent.getBody()).toBe("Break down tasks.");
      expect(subagent.toRulesyncSubagent().getFrontmatter().goose).toEqual({ model: "fast" });
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("returns true for wildcard and goose targets", () => {
      expect(GooseSubagent.isTargetedByRulesyncSubagent(buildRulesyncSubagent())).toBe(true);

      const gooseOnly = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "planner.md",
        frontmatter: { targets: ["goose"], name: "planner", description: "Plans" },
        body: "Body",
      });
      expect(GooseSubagent.isTargetedByRulesyncSubagent(gooseOnly)).toBe(true);

      const other = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "planner.md",
        frontmatter: { targets: ["claudecode"], name: "planner", description: "Plans" },
        body: "Body",
      });
      expect(GooseSubagent.isTargetedByRulesyncSubagent(other)).toBe(false);
    });
  });
});

import { join } from "node:path";

import { load } from "js-yaml";
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
    it("returns the project recipes/subagents dir", () => {
      expect(GooseSubagent.getSettablePaths().relativeDirPath).toBe(
        join(".goose", "recipes", "subagents"),
      );
    });

    it("returns the global recipes/subagents dir", () => {
      expect(GooseSubagent.getSettablePaths({ global: true }).relativeDirPath).toBe(
        join(".config", "goose", "recipes", "subagents"),
      );
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("emits a valid recipe with instructions as the body field", () => {
      const subagent = GooseSubagent.fromRulesyncSubagent({
        relativeDirPath: GooseSubagent.getSettablePaths().relativeDirPath,
        rulesyncSubagent: buildRulesyncSubagent(),
      });

      expect(subagent.getRelativeFilePath()).toBe("planner.yaml");
      expect(subagent.getRelativeDirPath()).toBe(join(".goose", "recipes", "subagents"));
      const recipe = load(subagent.getFileContent()) as Record<string, unknown>;
      expect(recipe.version).toBe("1.0.0");
      expect(recipe.title).toBe("planner");
      expect(recipe.description).toBe("Plans tasks");
      expect(recipe.instructions).toBe("Break down tasks into steps.");
    });

    it("writes to the global subagents dir when global is set", () => {
      const subagent = GooseSubagent.fromRulesyncSubagent({
        relativeDirPath: GooseSubagent.getSettablePaths().relativeDirPath,
        rulesyncSubagent: buildRulesyncSubagent(),
        global: true,
      });
      expect(subagent.getRelativeDirPath()).toBe(join(".config", "goose", "recipes", "subagents"));
    });
  });

  describe("toRulesyncSubagent", () => {
    it("round-trips instructions as the body and name/description", () => {
      const subagent = GooseSubagent.fromRulesyncSubagent({
        relativeDirPath: GooseSubagent.getSettablePaths().relativeDirPath,
        rulesyncSubagent: buildRulesyncSubagent(),
      });
      const rulesync = subagent.toRulesyncSubagent();
      expect(rulesync.getRelativeFilePath()).toBe("planner.md");
      expect(rulesync.getBody()).toBe("Break down tasks into steps.");
      const fm = rulesync.getFrontmatter();
      expect(fm.name).toBe("planner");
      expect(fm.description).toBe("Plans tasks");
    });
  });

  describe("toRulesyncSubagent (prompt fallback)", () => {
    it("uses prompt as the body without duplicating it into the goose section", async () => {
      const yamlContent = [
        "version: 1.0.0",
        "title: planner",
        "description: Plans tasks",
        "prompt: Break down tasks into steps.",
      ].join("\n");
      await writeFileContent(
        join(testDir, ".goose", "recipes", "subagents", "planner.yaml"),
        yamlContent,
      );

      const subagent = await GooseSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "planner.yaml",
      });
      const rulesync = subagent.toRulesyncSubagent();
      expect(rulesync.getBody()).toBe("Break down tasks into steps.");
      const goose = rulesync.getFrontmatter().goose as Record<string, unknown> | undefined;
      expect(goose?.prompt).toBeUndefined();
    });
  });

  describe("fromFile", () => {
    it("loads a sub-recipe file from disk", async () => {
      const yamlContent =
        "version: 1.0.0\ntitle: planner\ndescription: Plans\ninstructions: Steps\n";
      await writeFileContent(
        join(testDir, ".goose", "recipes", "subagents", "planner.yaml"),
        yamlContent,
      );

      const subagent = await GooseSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "planner.yaml",
      });

      expect(subagent).toBeInstanceOf(GooseSubagent);
      expect(subagent.getBody()).toBe("Steps");
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("returns true for wildcard and goose targets", () => {
      expect(GooseSubagent.isTargetedByRulesyncSubagent(buildRulesyncSubagent())).toBe(true);
    });
  });
});

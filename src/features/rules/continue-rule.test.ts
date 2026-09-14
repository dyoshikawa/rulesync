import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { ContinueRule } from "./continue-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

const buildRulesyncRule = ({
  frontmatter,
  body = "# Rule body",
  relativeFilePath = "topic.md",
}: {
  frontmatter: Record<string, unknown>;
  body?: string;
  relativeFilePath?: string;
}): RulesyncRule =>
  new RulesyncRule({
    relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
    relativeFilePath,
    frontmatter: { targets: ["*"], root: false, ...frontmatter },
    body,
  });

describe("ContinueRule", () => {
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
    it("emits the root rule to the workspace AGENTS.md and the rest to .continue/rules", () => {
      const paths = ContinueRule.getSettablePaths();
      expect(paths.root).toEqual({ relativeDirPath: ".", relativeFilePath: "AGENTS.md" });
      expect(paths.nonRoot).toEqual({ relativeDirPath: join(".continue", "rules") });
    });

    it("puts the global root rule inside ~/.continue/rules", () => {
      const paths = ContinueRule.getSettablePaths({ global: true });
      expect(paths.root).toEqual({
        relativeDirPath: join(".continue", "rules"),
        relativeFilePath: "AGENTS.md",
      });
      expect(paths.nonRoot).toEqual({ relativeDirPath: join(".continue", "rules") });
    });

    it("drops the tool directory when excludeToolDir is set", () => {
      const paths = ContinueRule.getSettablePaths({ excludeToolDir: true });
      expect(paths.nonRoot.relativeDirPath).toBe("rules");
    });
  });

  describe("constructor", () => {
    it("writes the root rule as a plain AGENTS.md without frontmatter", () => {
      const rule = new ContinueRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        frontmatter: { description: "ignored on the root file" },
        body: "# Overview",
        root: true,
      });

      expect(rule.getFileContent()).toBe("# Overview");
    });

    it("omits the frontmatter block when no key is set", () => {
      const rule = new ContinueRule({
        relativeDirPath: join(".continue", "rules"),
        relativeFilePath: "topic.md",
        frontmatter: {},
        body: "# Topic",
      });

      expect(rule.getFileContent()).toBe("# Topic");
    });

    it("emits description, globs, regex and alwaysApply as frontmatter", () => {
      const rule = new ContinueRule({
        relativeDirPath: join(".continue", "rules"),
        relativeFilePath: "topic.md",
        frontmatter: {
          description: "TypeScript conventions",
          globs: ["src/**/*.ts"],
          regex: ["import .* from 'react'"],
          alwaysApply: false,
        },
        body: "# Topic",
      });

      const { frontmatter, body } = parseFrontmatter(rule.getFileContent());
      expect(frontmatter).toEqual({
        description: "TypeScript conventions",
        globs: ["src/**/*.ts"],
        regex: ["import .* from 'react'"],
        alwaysApply: false,
      });
      expect(body.trim()).toBe("# Topic");
    });

    it("rejects an invalid frontmatter when validation is on", () => {
      expect(
        () =>
          new ContinueRule({
            relativeDirPath: join(".continue", "rules"),
            relativeFilePath: "topic.md",
            frontmatter: { alwaysApply: "yes" as unknown as boolean },
            body: "# Topic",
            validate: true,
          }),
      ).toThrow(/Invalid frontmatter/);
    });
  });

  describe("fromRulesyncRule", () => {
    it("emits the root rule to the workspace root in project mode", () => {
      const rule = ContinueRule.fromRulesyncRule({
        rulesyncRule: buildRulesyncRule({
          frontmatter: { root: true, description: "Overview" },
          body: "# Overview",
          relativeFilePath: "overview.md",
        }),
      });

      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.getFileContent()).toBe("# Overview");
      expect(rule.isRoot()).toBe(true);
    });

    it("emits the root rule to ~/.continue/rules/AGENTS.md in global mode", () => {
      const rule = ContinueRule.fromRulesyncRule({
        rulesyncRule: buildRulesyncRule({ frontmatter: { root: true }, body: "# Overview" }),
        global: true,
      });

      expect(rule.getRelativeDirPath()).toBe(join(".continue", "rules"));
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("emits a non-root rule with the canonical description and globs", () => {
      const rule = ContinueRule.fromRulesyncRule({
        rulesyncRule: buildRulesyncRule({
          frontmatter: { description: "TS rules", globs: ["src/**/*.ts", "src/**/*.tsx"] },
        }),
      });

      expect(rule.getRelativeDirPath()).toBe(join(".continue", "rules"));
      expect(rule.getRelativeFilePath()).toBe("topic.md");
      const { frontmatter } = parseFrontmatter(rule.getFileContent());
      expect(frontmatter).toEqual({
        description: "TS rules",
        globs: ["src/**/*.ts", "src/**/*.tsx"],
      });
    });

    it("drops the universal glob because a globless rule is already always-on", () => {
      const rule = ContinueRule.fromRulesyncRule({
        rulesyncRule: buildRulesyncRule({ frontmatter: { globs: ["**/*"] } }),
      });

      expect(rule.getFileContent()).toBe("# Rule body");
    });

    it("lets the continue block override description and globs and add regex/alwaysApply", () => {
      const rule = ContinueRule.fromRulesyncRule({
        rulesyncRule: buildRulesyncRule({
          frontmatter: {
            description: "shared",
            globs: ["**/*"],
            continue: {
              description: "continue-specific",
              globs: "lib/**",
              regex: "useEffect",
              alwaysApply: false,
            },
          },
        }),
      });

      const { frontmatter } = parseFrontmatter(rule.getFileContent());
      expect(frontmatter).toEqual({
        description: "continue-specific",
        globs: ["lib/**"],
        regex: ["useEffect"],
        alwaysApply: false,
      });
    });

    it("emits alwaysApply: true without the redundant universal glob", () => {
      const rule = ContinueRule.fromRulesyncRule({
        rulesyncRule: buildRulesyncRule({
          frontmatter: { globs: ["**/*"], continue: { alwaysApply: true } },
        }),
      });

      const { frontmatter } = parseFrontmatter(rule.getFileContent());
      expect(frontmatter).toEqual({ alwaysApply: true });
    });

    it("ignores empty continue globs and regex", () => {
      const rule = ContinueRule.fromRulesyncRule({
        rulesyncRule: buildRulesyncRule({
          frontmatter: { globs: ["src/**"], continue: { globs: [], regex: "" } },
        }),
      });

      const { frontmatter } = parseFrontmatter(rule.getFileContent());
      expect(frontmatter).toEqual({ globs: ["src/**"] });
    });
  });

  describe("fromFile", () => {
    it("imports the workspace AGENTS.md as the root rule", async () => {
      await writeFileContent(join(testDir, "AGENTS.md"), "# Overview\n");

      const rule = await ContinueRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.isRoot()).toBe(true);
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getBody()).toBe("# Overview");
    });

    it("imports ~/.continue/rules/AGENTS.md as the root rule in global mode", async () => {
      const rulesDir = join(testDir, ".continue", "rules");
      await ensureDir(rulesDir);
      await writeFileContent(join(rulesDir, "AGENTS.md"), "# Global overview");

      const rule = await ContinueRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
        global: true,
      });

      expect(rule.isRoot()).toBe(true);
      expect(rule.getRelativeDirPath()).toBe(join(".continue", "rules"));
    });

    it("imports a rule with frontmatter from .continue/rules", async () => {
      const rulesDir = join(testDir, ".continue", "rules");
      await ensureDir(rulesDir);
      await writeFileContent(
        join(rulesDir, "react.md"),
        '---\nname: React\ndescription: React rules\nglobs: "**/*.tsx"\nalwaysApply: false\n---\n# React\n',
      );

      const rule = await ContinueRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "react.md",
      });

      expect(rule.isRoot()).toBe(false);
      expect(rule.getRelativeDirPath()).toBe(join(".continue", "rules"));
      expect(rule.getFrontmatter()).toEqual({
        name: "React",
        description: "React rules",
        globs: "**/*.tsx",
        alwaysApply: false,
      });
      expect(rule.getBody()).toBe("# React");
    });

    it("rejects a rule whose frontmatter is invalid", async () => {
      const rulesDir = join(testDir, ".continue", "rules");
      await ensureDir(rulesDir);
      await writeFileContent(join(rulesDir, "bad.md"), "---\nglobs: 1\n---\n# Bad\n");

      await expect(
        ContinueRule.fromFile({ outputRoot: testDir, relativeFilePath: "bad.md" }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });

    it("throws when the file does not exist", async () => {
      await expect(
        ContinueRule.fromFile({ outputRoot: testDir, relativeFilePath: "missing.md" }),
      ).rejects.toThrow();
    });
  });

  describe("toRulesyncRule", () => {
    it("converts the root rule with the universal glob", () => {
      const rule = new ContinueRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        frontmatter: {},
        body: "# Overview",
        root: true,
      });

      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter()).toMatchObject({
        targets: ["*"],
        root: true,
        globs: ["**/*"],
      });
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("overview.md");
      expect(rulesyncRule.getBody()).toBe("# Overview");
    });

    it("maps a globless rule to the universal glob", () => {
      const rule = new ContinueRule({
        relativeDirPath: join(".continue", "rules"),
        relativeFilePath: "topic.md",
        frontmatter: { description: "Topic" },
        body: "# Topic",
      });

      const frontmatter = rule.toRulesyncRule().getFrontmatter();
      expect(frontmatter.globs).toEqual(["**/*"]);
      expect(frontmatter.description).toBe("Topic");
      expect(frontmatter.continue).toBeUndefined();
    });

    it("keeps globs and moves regex/alwaysApply into the continue block", () => {
      const rule = new ContinueRule({
        relativeDirPath: join(".continue", "rules"),
        relativeFilePath: "topic.md",
        frontmatter: { globs: "src/**", regex: ["foo", "bar"], alwaysApply: false },
        body: "# Topic",
      });

      const frontmatter = rule.toRulesyncRule().getFrontmatter();
      expect(frontmatter.globs).toEqual(["src/**"]);
      expect(frontmatter.continue).toEqual({ alwaysApply: false, regex: ["foo", "bar"] });
    });

    it("does not invent a universal glob for alwaysApply: false without globs", () => {
      const rule = new ContinueRule({
        relativeDirPath: join(".continue", "rules"),
        relativeFilePath: "topic.md",
        frontmatter: { alwaysApply: false, regex: "TODO" },
        body: "# Topic",
      });

      const frontmatter = rule.toRulesyncRule().getFrontmatter();
      expect(frontmatter.globs).toEqual([]);
      expect(frontmatter.continue).toEqual({ alwaysApply: false, regex: ["TODO"] });
    });

    it("round-trips rulesync -> continue -> rulesync", () => {
      const original = buildRulesyncRule({
        frontmatter: {
          description: "TS rules",
          globs: ["src/**/*.ts"],
          continue: { alwaysApply: false, regex: "class " },
        },
        body: "# TS",
      });

      const roundTripped = ContinueRule.fromRulesyncRule({ rulesyncRule: original })
        .toRulesyncRule()
        .getFrontmatter();

      expect(roundTripped.description).toBe("TS rules");
      expect(roundTripped.globs).toEqual(["src/**/*.ts"]);
      expect(roundTripped.continue).toEqual({ alwaysApply: false, regex: ["class "] });
    });
  });

  describe("forDeletion", () => {
    it("marks the workspace AGENTS.md as root in project mode", () => {
      const rule = ContinueRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      });
      expect(rule.isRoot()).toBe(true);
    });

    it("treats a rules-directory file as non-root", () => {
      const rule = ContinueRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".continue", "rules"),
        relativeFilePath: "topic.md",
      });
      expect(rule.isRoot()).toBe(false);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("returns true for continue and * targets, false otherwise", () => {
      expect(
        ContinueRule.isTargetedByRulesyncRule(
          buildRulesyncRule({ frontmatter: { targets: ["continue"] } }),
        ),
      ).toBe(true);
      expect(
        ContinueRule.isTargetedByRulesyncRule(
          buildRulesyncRule({ frontmatter: { targets: ["*"] } }),
        ),
      ).toBe(true);
      expect(
        ContinueRule.isTargetedByRulesyncRule(
          buildRulesyncRule({ frontmatter: { targets: ["cursor"] } }),
        ),
      ).toBe(false);
    });
  });

  describe("validate", () => {
    it("succeeds for a valid frontmatter", () => {
      const rule = new ContinueRule({
        relativeDirPath: join(".continue", "rules"),
        relativeFilePath: "topic.md",
        frontmatter: { globs: ["src/**"] },
        body: "# Topic",
        validate: false,
      });
      expect(rule.validate()).toEqual({ success: true, error: null });
    });
  });
});

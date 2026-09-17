import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { fallbackLogger } from "../../utils/logger.js";
import { AiassistantRule } from "./aiassistant-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("AiassistantRule", () => {
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
    it("targets .aiassistant/rules as a flat non-root directory", () => {
      const paths = AiassistantRule.getSettablePaths();
      expect(paths.nonRoot.relativeDirPath).toBe(join(".aiassistant", "rules"));
    });
  });

  describe("fromRulesyncRule", () => {
    const build = (
      frontmatter: ConstructorParameters<typeof RulesyncRule>[0]["frontmatter"],
      body = "# Coding style\n\nUse 4-space indentation.",
    ) =>
      AiassistantRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: new RulesyncRule({
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "coding-style.md",
          frontmatter,
          body,
        }),
      });

    it("emits specific globs as `by file patterns` with comma-separated patterns", () => {
      const rule = build({
        root: false,
        targets: ["*"],
        description: "Coding style",
        globs: ["*.kt", "src/**/*.kt"],
      });

      expect(rule.getRelativeDirPath()).toBe(join(".aiassistant", "rules"));
      expect(rule.getRelativeFilePath()).toBe("coding-style.md");
      // The block is the plugin's line-based metadata, not YAML: globs are
      // joined with a comma and written unquoted.
      expect(rule.getFileContent()).toBe(
        "---\napply: by file patterns\npatterns: *.kt, src/**/*.kt\n---\n\n# Coding style\n\nUse 4-space indentation.",
      );
      expect(rule.getBody()).toBe("# Coding style\n\nUse 4-space indentation.");
    });

    it("emits a description without specific globs as `by model decision`", () => {
      const rule = build({
        root: false,
        targets: ["*"],
        description: "Kotlin\n  coding style",
        globs: [],
      });

      expect(rule.getFileContent()).toBe(
        "---\napply: by model decision\ninstructions: Kotlin coding style\n---\n\n# Coding style\n\nUse 4-space indentation.",
      );
    });

    it("emits `always` when any glob is universal, even beside specific ones", () => {
      expect(
        build({ root: false, targets: ["*"], globs: ["**/*", "*.kt"] }).getFileContent(),
      ).toMatch(/^---\napply: always\n---\n\n/);
    });

    it("emits `always` for the root rule, universal globs, and bare rules", () => {
      expect(
        build({
          root: true,
          targets: ["*"],
          description: "Overview",
          globs: ["**/*"],
        }).getFileContent(),
      ).toMatch(/^---\napply: always\n---\n\n/);
      expect(
        build({ root: false, targets: ["*"], description: "Style", globs: ["*"] }).getFileContent(),
      ).toMatch(/^---\napply: always\n---\n\n/);
      expect(build({ root: false, targets: ["*"] }).getFileContent()).toBe(
        "---\napply: always\n---\n\n# Coding style\n\nUse 4-space indentation.",
      );
    });

    it("lets an explicit aiassistant.apply override the derived rule type", () => {
      const rule = build({
        root: false,
        targets: ["*"],
        description: "Style",
        globs: ["*.kt"],
        aiassistant: { apply: "manually" },
      });

      expect(rule.getFileContent()).toMatch(/^---\napply: manually\n---\n\n/);
      // An explicit `by file patterns` keeps universal globs as patterns.
      expect(
        build({
          root: false,
          targets: ["*"],
          globs: ["**/*"],
          aiassistant: { apply: "by file patterns" },
        }).getFileContent(),
      ).toMatch(/^---\napply: by file patterns\npatterns: \*\*\/\*\n---\n\n/);
      // An unknown value is written as is (with a warning) rather than dropped.
      expect(
        build({
          root: false,
          targets: ["*"],
          globs: ["*.kt"],
          aiassistant: { apply: "sometimes" },
        }).getFileContent(),
      ).toMatch(/^---\napply: sometimes\n---\n\n/);
    });

    it("flattens a folded explicit apply before matching it", () => {
      const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});
      expect(
        build({
          root: false,
          targets: ["*"],
          globs: ["*.kt"],
          aiassistant: { apply: "by file\npatterns" },
        }).getFileContent(),
      ).toMatch(/^---\napply: by file patterns\npatterns: \*\.kt\n---\n\n/);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("warns about a block the plugin cannot act on", () => {
      const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});
      const warnings = (frontmatter: Parameters<typeof build>[0]) => {
        warnSpy.mockClear();
        build(frontmatter);
        return warnSpy.mock.calls.map(([message]) => String(message));
      };

      expect(
        warnings({
          root: false,
          targets: ["*"],
          globs: ["*.kt"],
          aiassistant: { apply: "sometimes" },
        }),
      ).toEqual([
        expect.stringContaining(
          'coding-style.md: aiassistant.apply "sometimes" is not one of always, manually, by model decision, by file patterns, off',
        ),
      ]);
      expect(
        warnings({
          root: false,
          targets: ["*"],
          globs: [],
          aiassistant: { apply: "by file patterns" },
        }),
      ).toEqual([expect.stringContaining("but the rule has no globs")]);
      expect(
        warnings({ root: false, targets: ["*"], aiassistant: { apply: "by model decision" } }),
      ).toEqual([expect.stringContaining("but the rule has no description")]);
      expect(warnings({ root: false, targets: ["*"], globs: ["a,b/**"] })).toEqual([
        expect.stringContaining('the glob "a,b/**" contains a comma'),
      ]);
      expect(
        warnings({ root: false, targets: ["*"], description: "Use --- as a divider", globs: [] }),
      ).toEqual([expect.stringContaining('a metadata value contains "---"')]);
      expect(
        warnings({ root: false, targets: ["*"], description: "Style", globs: ["*.kt"] }),
      ).toEqual([]);
    });

    it("expands brace alternations, which the plugin would split on the comma", () => {
      expect(
        build({
          root: false,
          targets: ["*"],
          globs: ["src/**/*.{ts,tsx}", "docs/**"],
        }).getFileContent(),
      ).toMatch(
        /^---\napply: by file patterns\npatterns: src\/\*\*\/\*\.ts, src\/\*\*\/\*\.tsx, docs\/\*\*\n---\n\n/,
      );
    });

    it("keeps a line break in a value from starting a new metadata line", () => {
      expect(
        build({
          root: false,
          targets: ["*"],
          globs: ["src/**\napply: off"],
        }).getFileContent(),
      ).toMatch(/^---\napply: by file patterns\npatterns: src\/\*\* apply: off\n---\n\n/);
      expect(
        build({
          root: false,
          targets: ["*"],
          description: "Use this\rapply: off",
          globs: [],
        }).getFileContent(),
      ).toMatch(/^---\napply: by model decision\ninstructions: Use this apply: off\n---\n\n/);
    });
  });

  describe("parseFileContent", () => {
    it("reads the metadata block and strips it from the body", () => {
      expect(
        AiassistantRule.parseFileContent(
          "---\napply: by file patterns\npatterns: *.kt, src/**/*.kt\n---\n\n# Body\n",
        ),
      ).toEqual({
        metadata: { apply: "by file patterns", patterns: ["*.kt", "src/**/*.kt"] },
        body: "# Body",
      });
      expect(
        AiassistantRule.parseFileContent(
          "---\napply: by model decision\ninstructions: When editing Kotlin: be strict\n---\nBody",
        ),
      ).toEqual({
        metadata: { apply: "by model decision", instructions: "When editing Kotlin: be strict" },
        body: "Body",
      });
    });

    it("yields no metadata for a body-only file and keeps an unknown apply value", () => {
      expect(AiassistantRule.parseFileContent("# Overview\n\nProject context.")).toEqual({
        metadata: undefined,
        body: "# Overview\n\nProject context.",
      });
      expect(AiassistantRule.parseFileContent("---\ninstructions: x\n---\nBody")).toEqual({
        metadata: undefined,
        body: "Body",
      });
      // The plugin matches the value case-sensitively (typing this rule Off
      // today); the value is carried verbatim so a regenerate reproduces it.
      expect(AiassistantRule.parseFileContent("---\napply: Always\n---\nBody")).toEqual({
        metadata: { apply: "Always" },
        body: "Body",
      });
    });

    it("tolerates a BOM, leading blank lines, CRLF, and a delimiter inside a value", () => {
      expect(
        AiassistantRule.parseFileContent(
          "\uFEFF\n\n---\r\napply: always\r\n---\r\n\r\nBody\r\nMore",
        ),
      ).toEqual({ metadata: { apply: "always" }, body: "Body\r\nMore" });
      expect(
        AiassistantRule.parseFileContent(
          "---\napply: by model decision\ninstructions: Use --- as a divider\n---\nBody",
        ),
      ).toEqual({
        metadata: { apply: "by model decision", instructions: "Use --- as a divider" },
        body: "Body",
      });
      // An unclosed block is body.
      expect(AiassistantRule.parseFileContent("---\napply: always\nBody")).toEqual({
        metadata: undefined,
        body: "---\napply: always\nBody",
      });
    });

    it("splits patterns on commas outside brace groups", () => {
      expect(
        AiassistantRule.parseFileContent(
          "---\napply: by file patterns\npatterns: src/**/*.{ts,tsx}, docs/**\n---\nBody",
        ).metadata,
      ).toEqual({ apply: "by file patterns", patterns: ["src/**/*.{ts,tsx}", "docs/**"] });
    });
  });

  describe("fromFile", () => {
    const read = async (fileContent: string) => {
      const dir = join(testDir, ".aiassistant", "rules");
      await ensureDir(dir);
      await writeFileContent(join(dir, "overview.md"), fileContent);
      return AiassistantRule.fromFile({ outputRoot: testDir, relativeFilePath: "overview.md" });
    };

    it("reads a flat rule file from .aiassistant/rules", async () => {
      const rule = await read("---\napply: always\n---\n\n# Overview\n\nProject context.");

      expect(rule.getRelativeDirPath()).toBe(join(".aiassistant", "rules"));
      expect(rule.getRelativeFilePath()).toBe("overview.md");
      expect(rule.getMetadata()).toEqual({ apply: "always" });
      expect(rule.getBody()).toBe("# Overview\n\nProject context.");
    });

    it("reads the companion fields and edge-case layouts", async () => {
      expect(
        (
          await read("---\napply: by file patterns\npatterns: *.kt, *.kts\n---\nBody")
        ).getMetadata(),
      ).toEqual({ apply: "by file patterns", patterns: ["*.kt", "*.kts"] });
      expect(
        (
          await read("---\napply: by model decision\ninstructions: Kotlin\n---\nBody")
        ).getMetadata(),
      ).toEqual({ apply: "by model decision", instructions: "Kotlin" });
      expect((await read("---\napply: sometimes\n---\nBody")).getMetadata()).toEqual({
        apply: "sometimes",
      });

      const leadingBlank = await read("\n---\r\napply: always\r\n---\r\n\r\nBody");
      expect(leadingBlank.getMetadata()).toEqual({ apply: "always" });
      expect(leadingBlank.getBody()).toBe("Body");
      // The regenerated file carries exactly one block.
      expect(
        AiassistantRule.fromRulesyncRule({
          outputRoot: testDir,
          rulesyncRule: leadingBlank.toRulesyncRule(),
        }).getFileContent(),
      ).toBe("---\napply: always\n---\n\nBody");
    });
  });

  describe("toRulesyncRule round-trip", () => {
    const build = (fileContent: string) => {
      const { metadata, body } = AiassistantRule.parseFileContent(fileContent);
      return new AiassistantRule({
        outputRoot: testDir,
        relativeDirPath: join(".aiassistant", "rules"),
        relativeFilePath: "overview.md",
        body,
        metadata,
        root: false,
      }).toRulesyncRule();
    };

    it("maps each rule type back onto globs, description, or aiassistant.apply", () => {
      const always = build("---\napply: always\n---\n# Overview\n\nBody content.");
      expect(always.getBody()).toBe("# Overview\n\nBody content.");
      expect(always.getFrontmatter()).toMatchObject({ root: false, globs: ["**/*"] });
      expect(always.getFrontmatter().aiassistant).toBeUndefined();

      const patterns = build("---\napply: by file patterns\npatterns: *.kt\n---\nBody");
      expect(patterns.getFrontmatter().globs).toEqual(["*.kt"]);

      const decision = build("---\napply: by model decision\ninstructions: Kotlin only\n---\nBody");
      expect(decision.getFrontmatter()).toMatchObject({ description: "Kotlin only", globs: [] });

      const manually = build("---\napply: manually\n---\nBody");
      expect(manually.getFrontmatter()).toMatchObject({
        globs: [],
        aiassistant: { apply: "manually" },
      });

      const bodyOnly = build("# Overview\n\nBody content.");
      expect(bodyOnly.getFrontmatter()).toMatchObject({ globs: [] });
      expect(bodyOnly.getFrontmatter().aiassistant).toBeUndefined();
    });

    it("carries aiassistant.apply whenever the derivation would not reproduce it", () => {
      expect(build("---\napply: sometimes\n---\nBody").getFrontmatter().aiassistant).toEqual({
        apply: "sometimes",
      });
      expect(
        build("---\napply: by file patterns\npatterns: **/*\n---\nBody").getFrontmatter(),
      ).toMatchObject({ globs: ["**/*"], aiassistant: { apply: "by file patterns" } });
      expect(build("---\napply: by file patterns\n---\nBody").getFrontmatter()).toMatchObject({
        globs: [],
        aiassistant: { apply: "by file patterns" },
      });
      expect(
        build("---\napply: by file patterns\npatterns: **/*, *.kt\n---\nBody").getFrontmatter(),
      ).toMatchObject({ globs: ["**/*", "*.kt"], aiassistant: { apply: "by file patterns" } });
      expect(build("---\napply: by model decision\n---\nBody").getFrontmatter()).toMatchObject({
        globs: [],
        aiassistant: { apply: "by model decision" },
      });
    });

    it("regenerates the same file from an imported rule", () => {
      for (const fileContent of [
        "---\napply: always\n---\n\nBody",
        "---\napply: by file patterns\npatterns: *.kt, src/**/*.kt\n---\n\nBody",
        "---\napply: by model decision\ninstructions: Kotlin only\n---\n\nBody",
        "---\napply: manually\n---\n\nBody",
        "---\napply: off\n---\n\nBody",
        "---\napply: sometimes\n---\n\nBody",
        "---\napply: by file patterns\npatterns: **/*\n---\n\nBody",
        "---\napply: by file patterns\npatterns: **/*, *.kt\n---\n\nBody",
        "---\napply: by file patterns\n---\n\nBody",
        "---\napply: by model decision\n---\n\nBody",
      ]) {
        expect(
          AiassistantRule.fromRulesyncRule({
            outputRoot: testDir,
            rulesyncRule: build(fileContent),
          }).getFileContent(),
        ).toBe(fileContent);
      }
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("matches wildcard and explicit aiassistant targets", () => {
      const wildcard = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "a.md",
        frontmatter: { root: false, targets: ["*"], description: "", globs: [] },
        body: "x",
      });
      const explicit = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "b.md",
        frontmatter: { root: false, targets: ["aiassistant"], description: "", globs: [] },
        body: "y",
      });
      const other = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "c.md",
        frontmatter: { root: false, targets: ["cursor"], description: "", globs: [] },
        body: "z",
      });

      expect(AiassistantRule.isTargetedByRulesyncRule(wildcard)).toBe(true);
      expect(AiassistantRule.isTargetedByRulesyncRule(explicit)).toBe(true);
      expect(AiassistantRule.isTargetedByRulesyncRule(other)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("returns an empty instance", () => {
      const rule = AiassistantRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".aiassistant", "rules"),
        relativeFilePath: "overview.md",
      });
      expect(rule).toBeInstanceOf(AiassistantRule);
      expect(rule.getFileContent()).toBe("");
    });
  });
});

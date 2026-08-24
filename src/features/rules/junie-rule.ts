import { join } from "node:path";

import {
  JUNIE_DIR,
  JUNIE_LEGACY_RULE_FILE_NAME,
  JUNIE_PLAYBOOK_FILE_NAME,
  JUNIE_RULE_FILE_NAME,
  JUNIE_RULES_DIR_NAME,
} from "../../constants/junie-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleImportOnlyRoot,
  ToolRuleSettablePathsGlobal,
  buildToolPath,
} from "./tool-rule.js";

export type JunieRuleSettablePaths = {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  /** Legacy `.junie/guidelines.md`, accepted as an import fallback. */
  alternativeRoots?: Array<{
    relativeDirPath: string;
    relativeFilePath: string;
  }>;
  /** `.junie/rules/*.md` and `.junie/playbook.md`, read on import only. */
  importOnlyRoots?: ToolRuleImportOnlyRoot[];
  nonRoot?: undefined;
};

/**
 * Rule generator for JetBrains Junie AI coding agent
 *
 * Generates `.junie/AGENTS.md` files based on rulesync rule content. Junie CLI
 * resolves project guidelines in this order: `.junie/AGENTS.md` → root
 * `AGENTS.md` **combined with `.junie/playbook.md` and every
 * `.junie/rules/*.md`** → legacy `.junie/guidelines.md` / `.junie/guidelines/`.
 * The multi-file branch exists, but it is unreachable while `.junie/AGENTS.md`
 * is present: that file "is used exclusively and no other guidelines files are
 * combined with it". So emitting `.junie/rules/*.md` next to the root file
 * rulesync writes would produce files Junie never reads, and moving the root
 * output to project-root `AGENTS.md` would both change every existing output
 * path and collide with the `agentsmd` target. Non-root rules therefore stay
 * folded into the single root `.junie/AGENTS.md` by the RulesProcessor
 * (`nonRoot` is `undefined`, mirroring the warp / deepagents targets) — the
 * fold is lossless, since Junie loads that one file in full. The original
 * rationale for this shape was recorded in issue #2211 and re-confirmed
 * against the 2026-08-21 docs revision in issue #2728. The legacy
 * `.junie/guidelines.md` is still accepted as an import fallback, but
 * generation always targets `.junie/AGENTS.md`. Junie uses plain markdown
 * without frontmatter requirements.
 *
 * The multi-file branch is still read on **import**, though: a repo that
 * authors `.junie/rules/*.md` or `.junie/playbook.md` by hand — the live
 * layout whenever `.junie/AGENTS.md` is absent, which is exactly the state a
 * first `rulesync import` finds — declares those paths as `importOnlyRoots`
 * and imports them as non-root rules. They are never written back there:
 * generating `.junie/AGENTS.md` moves Junie onto the first branch, where the
 * folded root file carries the same content.
 *
 * Global (user) scope writes a single `~/.junie/AGENTS.md` file. Junie merges
 * these user-scope guidelines with the project guidelines (both are included
 * and marked clearly).
 *
 * @see https://junie.jetbrains.com/docs/junie-ide-plugin.html
 * @see https://junie.jetbrains.com/docs/guidelines-and-memory.html
 */
export class JunieRule extends ToolRule {
  static getSettablePaths({
    global = false,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): JunieRuleSettablePaths | ToolRuleSettablePathsGlobal {
    if (global) {
      // Junie merges the user-scope `~/.junie/AGENTS.md` guideline file with
      // the project guidelines. Global guidelines are a single root file.
      return {
        root: {
          relativeDirPath: buildToolPath(JUNIE_DIR, ".", excludeToolDir),
          relativeFilePath: JUNIE_RULE_FILE_NAME,
        },
      };
    }
    return {
      root: {
        relativeDirPath: buildToolPath(JUNIE_DIR, ".", excludeToolDir),
        relativeFilePath: JUNIE_RULE_FILE_NAME,
      },
      // Junie still reads the legacy `.junie/guidelines.md`; accept it on import as a
      // fallback when `.junie/AGENTS.md` is absent so existing repos keep round-tripping.
      alternativeRoots: [
        {
          relativeDirPath: buildToolPath(JUNIE_DIR, ".", excludeToolDir),
          relativeFilePath: JUNIE_LEGACY_RULE_FILE_NAME,
        },
      ],
      // Junie's multi-file branch. Rulesync never writes these — generation
      // folds everything into `.junie/AGENTS.md`, which switches Junie off
      // this branch entirely — but a repo that has not adopted rulesync yet
      // is usually authoring exactly these files, so import reads them.
      // Junie reads these only while `.junie/AGENTS.md` is absent, and so does
      // Rulesync: once the root file exists it already contains them, folded in
      // by a previous generate.
      importOnlyRoots: [
        {
          relativeDirPath: buildToolPath(JUNIE_DIR, JUNIE_RULES_DIR_NAME, excludeToolDir),
          onlyWhenRootAbsent: true,
        },
        {
          relativeDirPath: buildToolPath(JUNIE_DIR, ".", excludeToolDir),
          relativeFilePath: JUNIE_PLAYBOOK_FILE_NAME,
          onlyWhenRootAbsent: true,
        },
      ],
    };
  }

  /**
   * Determines whether a given relative file path refers to a root guideline file.
   * The preferred file is `AGENTS.md`; the legacy `guidelines.md` is still accepted.
   */
  private static isRootRelativeFilePath(relativeFilePath: string): boolean {
    return (
      relativeFilePath === JUNIE_RULE_FILE_NAME || relativeFilePath === JUNIE_LEGACY_RULE_FILE_NAME
    );
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath: relativeDirPathParam,
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<JunieRule> {
    if (global) {
      const paths = this.getSettablePaths({ global: true });
      if (!("root" in paths) || !paths.root) {
        throw new Error("JunieRule global settable paths must include a root path");
      }
      const fileContent = await readFileContent(
        join(outputRoot, paths.root.relativeDirPath, paths.root.relativeFilePath),
      );

      return new JunieRule({
        outputRoot,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        fileContent,
        validate,
        root: true,
      });
    }

    const settablePaths = this.getSettablePaths();
    // The caller's directory is honored so the import-only roots
    // (`.junie/rules/`, and `.junie/playbook.md` beside the root file) load
    // from where they actually live; only the root file defaults to `.junie`.
    const relativeDirPath = relativeDirPathParam ?? settablePaths.root.relativeDirPath;
    // Read from the actual discovered filename so the legacy `guidelines.md` fallback
    // is loaded correctly; generation still normalizes back to `AGENTS.md`.
    const relativePath = join(relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new JunieRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
      // A `.junie/rules/AGENTS.md` is one of the combined files, not the root
      // guideline, so the name alone does not decide this. The comparison uses
      // the default (`.junie`-prefixed) paths because `fromFile` has no
      // `excludeToolDir` input; a future caller that flattens the tool
      // directory would have to thread that flag through here too.
      root:
        relativeDirPath === settablePaths.root.relativeDirPath &&
        JunieRule.isRootRelativeFilePath(relativeFilePath),
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): JunieRule {
    if (global) {
      const paths = this.getSettablePaths({ global: true });
      if (!("root" in paths) || !paths.root) {
        throw new Error("JunieRule global settable paths must include a root path");
      }
      const frontmatter = rulesyncRule.getFrontmatter();
      return new JunieRule({
        outputRoot,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        fileContent: rulesyncRule.getBody(),
        validate,
        root: frontmatter.root ?? false,
        description: frontmatter.description,
        globs: frontmatter.globs,
      });
    }

    // Both root and non-root rules target the single root `.junie/AGENTS.md`;
    // the RulesProcessor folds the non-root bodies into the root rule and
    // drops the redundant non-root instances before writing.
    const { root } = this.getSettablePaths();
    return new JunieRule({
      outputRoot,
      relativeDirPath: root.relativeDirPath,
      relativeFilePath: root.relativeFilePath,
      fileContent: rulesyncRule.getBody(),
      validate,
      root: rulesyncRule.getFrontmatter().root ?? false,
    });
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    // Junie rules are always valid since they don't require frontmatter
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): JunieRule {
    const isRoot = JunieRule.isRootRelativeFilePath(relativeFilePath);

    return new JunieRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "junie",
    });
  }
}

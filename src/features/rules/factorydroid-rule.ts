import { join } from "node:path";

import {
  FACTORYDROID_DESIGN_FILE_NAME,
  FACTORYDROID_DIR,
  FACTORYDROID_RULE_FILE_NAME,
} from "../../constants/factorydroid-paths.js";
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleExtraFixedFile,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
  buildToolPath,
} from "./tool-rule.js";

export type FactorydroidRuleParams = AiFileParams & {
  root?: boolean;
  /**
   * Marks an instance whose body maps to Factory Droid's `DESIGN.md`
   * design-guidelines channel instead of the coding-guidelines `AGENTS.md`.
   */
  design?: boolean;
};

export type FactorydroidRuleSettablePaths = ToolRuleSettablePaths & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  /**
   * Factory Droid's design-guidelines file. Rules opt into this path via the
   * `factorydroid.channel: design` frontmatter block; multiple opted-in rules
   * are concatenated into this single file by the RulesProcessor. Project
   * scope only — see {@link FactorydroidRule} for why.
   */
  design: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
};

export type FactorydroidRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal;

/**
 * Rule generator for Factory Droid.
 *
 * Factory Droid loads the root `AGENTS.md` (project) / `~/.factory/AGENTS.md`
 * (global) as coding guidelines, plus non-root rules referenced from it via
 * `.factory/rules/*.md`.
 *
 * Factory Droid also loads `DESIGN.md` (project only) as a second,
 * independent instruction surface: "Always-on design-system, UX, visual, and
 * interaction guidance", loaded separately from `AGENTS.md`'s coding
 * guidelines. Rulesync emits it from any non-root rule that opts in via a
 * `factorydroid.channel: design` frontmatter block — those rule bodies are
 * routed to `DESIGN.md` instead of `AGENTS.md`/`.factory/rules/*.md`, and
 * multiple opted-in rules concatenate in source order. Factory's docs describe
 * `DESIGN.md` at the repository root and in nested subdirectories, like
 * `AGENTS.md`, but document no personal/global home-directory equivalent, so
 * this channel is project scope only.
 * @see https://docs.factory.ai/cli/configuration/agents-md
 */
export class FactorydroidRule extends ToolRule {
  private readonly design: boolean;

  constructor({ fileContent, root, design = false, ...rest }: FactorydroidRuleParams) {
    super({
      ...rest,
      fileContent,
      root: root ?? false,
    });
    this.design = design;
  }

  static getSettablePaths({
    global,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): FactorydroidRuleSettablePaths | FactorydroidRuleSettablePathsGlobal {
    if (global) {
      return {
        root: {
          relativeDirPath: buildToolPath(FACTORYDROID_DIR, ".", excludeToolDir),
          relativeFilePath: FACTORYDROID_RULE_FILE_NAME,
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: FACTORYDROID_RULE_FILE_NAME,
      },
      nonRoot: {
        relativeDirPath: buildToolPath(FACTORYDROID_DIR, "rules", excludeToolDir),
      },
      design: {
        relativeDirPath: ".",
        relativeFilePath: FACTORYDROID_DESIGN_FILE_NAME,
      },
    };
  }

  /**
   * Extra fixed files this tool manages beyond the root/non-root rules. The
   * RulesProcessor enumerates these for import and deletion so a stale
   * `DESIGN.md` is cleaned up once no rule opts in anymore. Empty in global
   * mode: `DESIGN.md` has no documented home-directory equivalent.
   */
  static getExtraFixedFiles({
    global = false,
  }: { global?: boolean } = {}): ToolRuleExtraFixedFile[] {
    if (global) {
      return [];
    }
    return [(this.getSettablePaths({ global }) as FactorydroidRuleSettablePaths).design];
  }

  /**
   * Factory Droid loads `DESIGN.md` itself, so listing it in the root rule's
   * TOON reference section would double-load the content (and misrepresent it
   * as a rule the model must remember to open).
   */
  override isExcludedFromRootReferences(): boolean {
    return this.design;
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<FactorydroidRule> {
    const paths = this.getSettablePaths({ global });

    // Route the design-guidelines file to its own instance; everything else
    // resolves through the existing root/non-root handling. Matching on
    // `relativeDirPath` too (not just the basename) keeps a non-root rule
    // that happens to be named `DESIGN.md` under `.factory/rules/` from
    // being routed here by mistake — mirrors the equivalent guard in
    // `forDeletion`.
    const design = !global ? (paths as FactorydroidRuleSettablePaths).design : undefined;
    const isDesign =
      design !== undefined &&
      relativeDirPath === design.relativeDirPath &&
      relativeFilePath === design.relativeFilePath;

    if (isDesign) {
      const relativePath = join(design.relativeDirPath, design.relativeFilePath);
      const fileContent = await readFileContent(join(outputRoot, relativePath));

      return new FactorydroidRule({
        outputRoot,
        relativeDirPath: design.relativeDirPath,
        relativeFilePath: design.relativeFilePath,
        fileContent,
        validate,
        root: false,
        design: true,
      });
    }

    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    if (isRoot) {
      const relativePath = join(paths.root.relativeDirPath, paths.root.relativeFilePath);
      const fileContent = await readFileContent(join(outputRoot, relativePath));

      return new FactorydroidRule({
        outputRoot,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        fileContent,
        validate,
        root: true,
      });
    }

    if (!paths.nonRoot) {
      throw new Error(`nonRoot path is not set for ${relativeFilePath}`);
    }

    const relativePath = join(paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));
    return new FactorydroidRule({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
      root: false,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): FactorydroidRule {
    const paths = this.getSettablePaths({ global });
    const design = !global ? (paths as FactorydroidRuleSettablePaths).design : undefined;
    const isDesign =
      design !== undefined &&
      relativeDirPath === design.relativeDirPath &&
      relativeFilePath === design.relativeFilePath;
    const isRoot =
      !isDesign &&
      relativeFilePath === paths.root.relativeFilePath &&
      relativeDirPath === paths.root.relativeDirPath;

    return new FactorydroidRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot,
      design: isDesign,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): FactorydroidRule {
    const frontmatter = rulesyncRule.getFrontmatter();
    const paths = this.getSettablePaths({ global });

    // Opted-in non-root rules route to the design-guidelines file instead of
    // AGENTS.md / .factory/rules/*.md. Project scope only, matching
    // `getExtraFixedFiles`; the flag is ignored elsewhere (folded normally).
    if (!global && !frontmatter.root && frontmatter.factorydroid?.channel === "design") {
      const { design } = paths as FactorydroidRuleSettablePaths;
      return new FactorydroidRule({
        outputRoot,
        relativeDirPath: design.relativeDirPath,
        relativeFilePath: design.relativeFilePath,
        fileContent: rulesyncRule.getBody(),
        validate,
        root: false,
        design: true,
      });
    }

    return new FactorydroidRule(
      this.buildToolRuleParamsAgentsmd({
        outputRoot,
        rulesyncRule,
        validate,
        rootPath: paths.root,
        nonRootPath: paths.nonRoot,
      }),
    );
  }

  toRulesyncRule(): RulesyncRule {
    if (this.design) {
      return new RulesyncRule({
        outputRoot: process.cwd(),
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: FACTORYDROID_DESIGN_FILE_NAME,
        frontmatter: {
          root: false,
          targets: ["factorydroid"],
          factorydroid: { channel: "design" },
        },
        body: this.getFileContent(),
      });
    }
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "factorydroid",
    });
  }
}

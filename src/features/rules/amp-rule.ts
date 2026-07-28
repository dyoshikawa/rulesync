import { join } from "node:path";

import { AMP_AGENTS_DIR, AMP_GLOBAL_DIR, AMP_RULE_FILE_NAME } from "../../constants/amp-paths.js";
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
  buildToolPath,
} from "./tool-rule.js";

/** Amp `globs:` frontmatter: accepted only as a list of strings. */
function parseAmpGlobs(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((glob): glob is string => typeof glob === "string")
    ? value
    : undefined;
}

export type AmpRuleSettablePaths = ToolRuleSettablePaths & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
};

export type AmpRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal;

/**
 * Rule generator for Amp (ampcode).
 *
 * Amp reads `AGENTS.md` at the project root (and parent directories / subtrees)
 * plus the global `~/.config/amp/AGENTS.md`. Non-root rules are emitted under
 * `.agents/memories/` and referenced from the root file in TOON format
 * (`ruleDiscoveryMode: "toon"`), mapping rulesync per-rule `globs` to the
 * `applyTo` field. Subtree AGENTS.md files additionally support `globs:`
 * frontmatter and `@`-mention imports.
 *
 * In global mode, only the root `~/.config/amp/AGENTS.md` is emitted; non-root
 * rules are not supported.
 */
export class AmpRule extends ToolRule {
  static getSettablePaths({
    global,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): AmpRuleSettablePaths | AmpRuleSettablePathsGlobal {
    if (global) {
      return {
        root: {
          relativeDirPath: buildToolPath(AMP_GLOBAL_DIR, ".", excludeToolDir),
          relativeFilePath: AMP_RULE_FILE_NAME,
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: AMP_RULE_FILE_NAME,
      },
      nonRoot: {
        relativeDirPath: buildToolPath(AMP_AGENTS_DIR, "memories", excludeToolDir),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<AmpRule> {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    if (isRoot) {
      const fileContent = await readFileContent(
        join(outputRoot, paths.root.relativeDirPath, paths.root.relativeFilePath),
      );

      return new AmpRule({
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
    // A memories file may carry Amp's `globs:` frontmatter (the native
    // conditional-loading gate); restore it into the canonical globs so the
    // round-trip keeps the condition instead of flattening it into an
    // always-loaded rule. A file without frontmatter parses as-is.
    const { frontmatter } = parseFrontmatter(fileContent, join(outputRoot, relativePath));
    return new AmpRule({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
      root: false,
      globs: parseAmpGlobs(frontmatter.globs),
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): AmpRule {
    const paths = this.getSettablePaths({ global });
    const params = this.buildToolRuleParamsAgentsmd({
      outputRoot,
      rulesyncRule,
      validate,
      rootPath: paths.root,
      nonRootPath: paths.nonRoot,
    });
    // Amp natively gates an @-mentioned file (and a subtree AGENTS.md) on
    // `globs:` YAML frontmatter — without it the file is ALWAYS included, and
    // the `applyTo` value in the root file's TOON table is advisory prose Amp
    // never enforces. Amp implicitly prefixes each glob with `**/` unless it
    // starts with `./` or `../`, so canonical globs pass through verbatim.
    // https://ampcode.com/news/globs-in-AGENTS.md
    if (!params.root && params.globs !== undefined && params.globs.length > 0) {
      params.fileContent = stringifyFrontmatter(params.fileContent, { globs: params.globs });
    }
    return new AmpRule(params);
  }

  toRulesyncRule(): RulesyncRule {
    if (this.isRoot()) {
      return this.toRulesyncRuleDefault();
    }
    // A non-root file's `globs:` frontmatter is Amp's native conditional-load
    // gate, not rule content: strip it from the body and restore it into the
    // canonical globs so the condition round-trips.
    const { frontmatter, body } = parseFrontmatter(this.getFileContent(), this.getFilePath());
    return new RulesyncRule({
      outputRoot: process.cwd(),
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: {
        root: false,
        targets: ["*"],
        description: this.getDescription(),
        globs: this.getGlobs() ?? parseAmpGlobs(frontmatter.globs) ?? [],
      },
      body: body.trim(),
    });
  }

  validate(): ValidationResult {
    // Amp rules are plain markdown with optional `globs:` frontmatter, so any
    // body content is considered valid (mirrors other AGENTS.md rule classes).
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): AmpRule {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    return new AmpRule({
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
      toolTarget: "amp",
    });
  }
}

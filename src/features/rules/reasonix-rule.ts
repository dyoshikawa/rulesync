import { join } from "node:path";

import { REASONIX_GLOBAL_DIR, REASONIX_RULE_FILE_NAME } from "../../constants/reasonix-paths.js";
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent, toPosixPath } from "../../utils/file.js";
import {
  NESTED_SCAN_EXCLUDED_DIRS_ANY_DEPTH,
  NESTED_SCAN_EXCLUDED_ROOT_DIRS,
} from "./nested-scan-exclusions.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleNestedFilePatterns,
  ToolRuleSettablePaths,
} from "./tool-rule.js";

export type ReasonixRuleParams = AiFileParams & {
  root?: boolean;
};

/**
 * Rule generator for DeepSeek-Reasonix.
 *
 * Reasonix auto-injects a hierarchical instruction document, reading its
 * vendor-specific `REASONIX.md` (alongside the cross-tool `AGENTS.md`/`CLAUDE.md`)
 * discovered by walking user-home → ancestors → project root/local. rulesync
 * emits the vendor `REASONIX.md` at the project root (project scope) and
 * `~/.reasonix/REASONIX.md` (global scope). Like codexcli/warp, there is
 * no non-root instruction directory to map rulesync's topic rules onto, so their
 * bodies are folded into the single root `REASONIX.md` by the RulesProcessor
 * (`nonRoot` is `undefined`).
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/GUIDE.md
 */
export type ReasonixRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export class ReasonixRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: ReasonixRuleParams) {
    super({
      ...rest,
      fileContent,
      root: root ?? false,
    });
  }

  static getSettablePaths({
    global = false,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): ReasonixRuleSettablePaths {
    return {
      root: {
        relativeDirPath: global ? REASONIX_GLOBAL_DIR : ".",
        relativeFilePath: REASONIX_RULE_FILE_NAME,
      },
    };
  }

  /**
   * Context Engine v2 (v1.18.0) walks from the workspace root to the target
   * path loading per-directory instruction files, so nested `REASONIX.md`
   * files are a real scoping surface: "Deeper directories beat broader
   * directories." The scan mirrors the AGENTS.md standard's nested discovery
   * (same exclusions, import-only, project scope).
   * @see https://github.com/esengine/DeepSeek-Reasonix/blob/v1.18.0/docs/SESSION_MEMORY_RETRIEVAL.md
   */
  static getNestedFilePatterns({ outputRoot }: { outputRoot: string }): ToolRuleNestedFilePatterns {
    const root = toPosixPath(outputRoot);
    return {
      include: [`${root}/**/${REASONIX_RULE_FILE_NAME}`],
      ignore: [
        // Enumerated separately as the root rule.
        `${root}/${REASONIX_RULE_FILE_NAME}`,
        `${root}/**/.*/**`,
        ...NESTED_SCAN_EXCLUDED_DIRS_ANY_DEPTH.map((dir) => `${root}/**/${dir}/**`),
        ...NESTED_SCAN_EXCLUDED_ROOT_DIRS.map((dir) => `${root}/${dir}/**`),
      ],
    };
  }

  /**
   * The subproject directory this rule scopes, or `undefined` for the root
   * file (project or global).
   */
  private getSubprojectPath(): string | undefined {
    if (this.isRoot()) {
      return undefined;
    }
    const relativeDirPath = toPosixPath(this.getRelativeDirPath());
    if (relativeDirPath === "." || relativeDirPath === "" || relativeDirPath.startsWith(".")) {
      return undefined;
    }
    return relativeDirPath;
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath: _relativeFilePath,
    relativeDirPath: overrideDirPath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<ReasonixRule> {
    const { root } = this.getSettablePaths({ global });

    // A nested per-directory file discovered by `getNestedFilePatterns` — the
    // processor passes its directory; the root file passes none (or the root
    // directory itself).
    if (
      overrideDirPath !== undefined &&
      overrideDirPath !== root.relativeDirPath &&
      overrideDirPath !== "."
    ) {
      const fileContent = await readFileContent(
        join(outputRoot, overrideDirPath, REASONIX_RULE_FILE_NAME),
      );
      return new ReasonixRule({
        outputRoot,
        relativeDirPath: overrideDirPath,
        relativeFilePath: REASONIX_RULE_FILE_NAME,
        fileContent,
        validate,
        root: false,
      });
    }

    const relativePath = join(root.relativeDirPath, root.relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new ReasonixRule({
      outputRoot,
      relativeDirPath: root.relativeDirPath,
      relativeFilePath: root.relativeFilePath,
      fileContent,
      validate,
      root: true,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): ReasonixRule {
    const { root } = this.getSettablePaths({ global });
    const frontmatter = rulesyncRule.getFrontmatter();
    const isRoot = frontmatter.root ?? false;

    // A directory-scoped rule (the shared `agentsmd.subprojectPath` carrier)
    // becomes a nested `<dir>/REASONIX.md` instead of being folded into the
    // root file — Context Engine v2 loads it only under that path, so its
    // paragraphs are not carried by every turn. Project scope only; the global
    // root has no workspace to nest under.
    const subprojectPath = frontmatter.agentsmd?.subprojectPath;
    if (!global && !isRoot && subprojectPath) {
      return new ReasonixRule({
        outputRoot,
        relativeDirPath: join(subprojectPath),
        relativeFilePath: REASONIX_RULE_FILE_NAME,
        fileContent: rulesyncRule.getBody(),
        validate,
        root: false,
      });
    }

    return new ReasonixRule({
      outputRoot,
      relativeDirPath: root.relativeDirPath,
      relativeFilePath: root.relativeFilePath,
      fileContent: rulesyncRule.getBody(),
      validate,
      root: isRoot,
    });
  }

  toRulesyncRule(): RulesyncRule {
    const subprojectPath = this.getSubprojectPath();
    if (subprojectPath === undefined) {
      return this.toRulesyncRuleDefault();
    }

    // Nested files import to a name derived from their directory, suffixed so
    // they cannot clobber the AGENTS.md standard's derived names for the same
    // subprojects, and targeted at reasonix only so a re-generate does not
    // surprise other tools with new nested files.
    const slug = subprojectPath.replaceAll("/", "-");
    return new RulesyncRule({
      outputRoot: this.getOutputRoot(),
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: `${slug}-reasonix.md`,
      frontmatter: {
        targets: ["reasonix"],
        root: false,
        globs: [`${subprojectPath}/**/*`],
        agentsmd: { subprojectPath },
      },
      body: this.getFileContent(),
      validate: true,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): ReasonixRule {
    const isRoot =
      relativeFilePath === REASONIX_RULE_FILE_NAME &&
      (relativeDirPath === "." || relativeDirPath === REASONIX_GLOBAL_DIR);

    return new ReasonixRule({
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
      toolTarget: "reasonix",
    });
  }
}

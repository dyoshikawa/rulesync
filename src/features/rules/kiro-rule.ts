import { join } from "node:path";

import {
  KIRO_DIR,
  KIRO_GLOBAL_ROOT_STEERING_FILE_NAME,
  KIRO_STEERING_DIR_NAME,
} from "../../constants/kiro-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent, toPosixPath } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
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
  ToolRuleSettablePathsGlobal,
  buildToolPath,
} from "./tool-rule.js";

/**
 * Kiro loads `AGENTS.md` as steering context from any directory in the
 * workspace tree (CLI 2.18.0 / IDE 1.0.309), not just the workspace root.
 */
const KIRO_NESTED_STEERING_FILE_NAME = "AGENTS.md";

export type KiroRuleSettablePaths =
  | Pick<ToolRuleSettablePaths, "nonRoot">
  | ToolRuleSettablePathsGlobal;

/**
 * Steering `inclusion` frontmatter that Kiro reads at the top of each
 * `.kiro/steering/*.md` file:
 * - `always` — loaded into every interaction (Kiro's default when no frontmatter
 *   is present, so rulesync omits the block in this case).
 * - `fileMatch` — loaded only when the open file matches `fileMatchPattern`.
 * - `manual` — loaded on demand via `#steering-file-name`.
 * - `auto` — auto-included when a request matches `description` (skill-like);
 *   requires companion `name` and `description` fields.
 *
 * @see https://kiro.dev/docs/steering/
 */
export type KiroSteeringInclusion = {
  inclusion: string;
  // A single glob is emitted as a string; multiple globs as a YAML array, both of
  // which Kiro accepts for `fileMatchPattern`.
  fileMatchPattern?: string | string[];
  // Companion fields Kiro requires for `inclusion: auto` (ignored otherwise).
  name?: string;
  description?: string;
};

const WILDCARD_GLOBS = new Set(["**/*", "**", "*"]);

/**
 * Emits one glob as a string and several as an array, matching the two
 * `fileMatchPattern` forms Kiro accepts.
 */
function toFileMatchPattern(globs: string[]): string | string[] | undefined {
  if (globs.length === 0) {
    return undefined;
  }
  return globs.length === 1 ? globs[0] : globs;
}

/**
 * Derives the Kiro steering `inclusion` frontmatter for a non-root rule from the
 * rulesync rule frontmatter.
 *
 * Precedence:
 * 1. An explicit `kiro.inclusion` block round-trips as-is (with `fileMatchPattern`
 *    taken from the block, or derived from `globs` when omitted for `fileMatch`;
 *    and with the companion `name`/`description` carried through for `auto`).
 * 2. Otherwise specific (non-wildcard) globs map to `fileMatch`, scoping the rule
 *    to matching files instead of leaving it implicitly always-on.
 * 3. Otherwise the rule stays `always` — represented by omitting the block so the
 *    emitted file matches Kiro's no-frontmatter default.
 *
 * Returns `undefined` when no frontmatter should be written (the `always` case).
 */
export function deriveKiroInclusion({
  kiro,
  globs,
}: {
  kiro?: {
    inclusion?: string;
    fileMatchPattern?: string | string[];
    name?: string;
    description?: string;
  };
  globs?: string[];
}): KiroSteeringInclusion | undefined {
  const specificGlobs = (globs ?? []).filter((g) => !WILDCARD_GLOBS.has(g));

  if (kiro?.inclusion) {
    if (kiro.inclusion === "fileMatch") {
      const fileMatchPattern = kiro.fileMatchPattern ?? toFileMatchPattern(specificGlobs);
      return fileMatchPattern
        ? { inclusion: "fileMatch", fileMatchPattern }
        : { inclusion: "fileMatch" };
    }
    // `auto` relies on the companion `name`/`description` to decide relevance, so
    // carry them through when present.
    if (kiro.inclusion === "auto") {
      return {
        inclusion: "auto",
        ...(kiro.name !== undefined ? { name: kiro.name } : {}),
        ...(kiro.description !== undefined ? { description: kiro.description } : {}),
      };
    }
    return { inclusion: kiro.inclusion };
  }

  const fileMatchPattern = toFileMatchPattern(specificGlobs);
  if (fileMatchPattern) {
    return { inclusion: "fileMatch", fileMatchPattern };
  }

  return undefined;
}

/**
 * Rule generator for Kiro AI-powered IDE
 *
 * Generates steering documents for Kiro's spec-driven development approach in the
 * `.kiro/steering/` directory (product.md, structure.md, tech.md, ...).
 *
 * Non-root steering files carry an `inclusion` frontmatter block derived from the
 * rulesync rule's globs / `kiro` override (see {@link deriveKiroInclusion}); the
 * root overview index stays plain so Kiro always loads it.
 */
export class KiroRule extends ToolRule {
  static getSettablePaths(
    options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): KiroRuleSettablePaths {
    const steeringDirPath = buildToolPath(KIRO_DIR, KIRO_STEERING_DIR_NAME, options.excludeToolDir);

    // In global scope Kiro does not read `~/AGENTS.md`, so the root rule is
    // written alongside the non-root steering files as
    // `~/.kiro/steering/product.md` instead of the project-scope root `AGENTS.md`.
    if (options.global) {
      return {
        root: {
          relativeDirPath: steeringDirPath,
          relativeFilePath: KIRO_GLOBAL_ROOT_STEERING_FILE_NAME,
        },
        nonRoot: {
          relativeDirPath: steeringDirPath,
        },
      };
    }

    return {
      nonRoot: {
        relativeDirPath: steeringDirPath,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    relativeDirPath: overrideDirPath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<KiroRule> {
    const paths = this.getSettablePaths({ global });

    // A nested `AGENTS.md` discovered by `getNestedFilePatterns`: the processor
    // passes its directory, which is outside the steering directory.
    const steeringDirPath =
      paths.nonRoot?.relativeDirPath ?? buildToolPath(KIRO_DIR, KIRO_STEERING_DIR_NAME);
    if (
      overrideDirPath !== undefined &&
      overrideDirPath !== steeringDirPath &&
      overrideDirPath !== "." &&
      relativeFilePath === KIRO_NESTED_STEERING_FILE_NAME
    ) {
      return new KiroRule({
        outputRoot,
        relativeDirPath: overrideDirPath,
        relativeFilePath,
        fileContent: await readFileContent(join(outputRoot, overrideDirPath, relativeFilePath)),
        validate,
        root: false,
      });
    }
    // In global scope the root steering file (`product.md`) lives in the same
    // directory as the non-root files; treat it as the root rule on import.
    const isRoot = "root" in paths && relativeFilePath === paths.root.relativeFilePath;
    const relativeDirPath =
      paths.nonRoot?.relativeDirPath ?? buildToolPath(KIRO_DIR, KIRO_STEERING_DIR_NAME);
    const fileContent = await readFileContent(join(outputRoot, relativeDirPath, relativeFilePath));

    return new KiroRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath: relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): KiroRule {
    const paths = this.getSettablePaths({ global });
    const params = this.buildToolRuleParamsDefault({
      outputRoot,
      rulesyncRule,
      validate,
      ...("root" in paths && { rootPath: paths.root }),
      nonRootPath: paths.nonRoot,
    });

    // The root overview index stays plain (Kiro always-loads a frontmatter-less
    // steering file). Only non-root steering files carry inclusion frontmatter.
    if (params.root) {
      return new KiroRule(params);
    }

    const frontmatter = rulesyncRule.getFrontmatter();

    // Kiro CLI 2.18.0 / IDE 1.0.309 load `AGENTS.md` as steering context from
    // anywhere in the workspace tree, so a directory-scoped rule is written to
    // `<dir>/AGENTS.md` INSTEAD of being flattened into `.kiro/steering/`.
    // Project scope only: nested discovery is workspace-tree-relative and has no
    // meaning under `~/.kiro/steering/`. A nested `AGENTS.md` is a plain
    // steering file, so no `inclusion` frontmatter is attached to it — that
    // block belongs to `.kiro/steering/*.md`.
    // @see https://kiro.dev/docs/steering/
    const subprojectPath = frontmatter.agentsmd?.subprojectPath;
    if (!global && subprojectPath) {
      return new KiroRule({
        ...params,
        relativeDirPath: join(subprojectPath),
        relativeFilePath: KIRO_NESTED_STEERING_FILE_NAME,
      });
    }

    const inclusion = deriveKiroInclusion({
      kiro: frontmatter.kiro,
      globs: frontmatter.globs,
    });

    if (!inclusion) {
      return new KiroRule(params);
    }

    return new KiroRule({
      ...params,
      fileContent: stringifyFrontmatter(rulesyncRule.getBody(), inclusion),
    });
  }

  /**
   * The subproject directory a nested `AGENTS.md` scopes, or `undefined` for the
   * root rule and for the `.kiro/steering/` files.
   */
  private getSubprojectPath(): string | undefined {
    if (this.isRoot() || this.getRelativeFilePath() !== KIRO_NESTED_STEERING_FILE_NAME) {
      return undefined;
    }
    const relativeDirPath = toPosixPath(this.getRelativeDirPath());
    if (relativeDirPath === "." || relativeDirPath === "" || relativeDirPath.startsWith(".")) {
      return undefined;
    }
    return relativeDirPath;
  }

  toRulesyncRule(): RulesyncRule {
    const subprojectPath = this.getSubprojectPath();
    if (subprojectPath !== undefined) {
      // Nested files import to a name derived from their directory, suffixed so
      // they cannot clobber the AGENTS.md standard's derived names for the same
      // subproject, and targeted at kiro only so a re-generate does not surprise
      // other tools with new nested files.
      const slug = subprojectPath.replaceAll("/", "-");
      return new RulesyncRule({
        outputRoot: this.getOutputRoot(),
        relativeDirPath: RulesyncRule.getSettablePaths().recommended.relativeDirPath,
        relativeFilePath: `${slug}-kiro.md`,
        frontmatter: {
          targets: ["kiro"],
          root: false,
          globs: [`${subprojectPath}/**/*`],
          agentsmd: { subprojectPath },
        },
        body: this.getFileContent(),
        validate: true,
      });
    }

    // Round-trip steering inclusion frontmatter back into the rulesync `kiro`
    // block (plus `globs` for fileMatch), so re-generating reproduces the file.
    const { frontmatter, body } = parseFrontmatter(
      this.getFileContent(),
      this.getRelativeFilePath(),
    );
    const inclusion = typeof frontmatter.inclusion === "string" ? frontmatter.inclusion : undefined;

    if (!inclusion) {
      return this.toRulesyncRuleDefault();
    }

    const rawPattern = frontmatter.fileMatchPattern;
    const fileMatchPattern: string | string[] | undefined = Array.isArray(rawPattern)
      ? rawPattern.filter((p): p is string => typeof p === "string")
      : typeof rawPattern === "string"
        ? rawPattern
        : undefined;
    const patternGlobs =
      fileMatchPattern === undefined
        ? []
        : Array.isArray(fileMatchPattern)
          ? fileMatchPattern
          : [fileMatchPattern];
    const globs = inclusion === "fileMatch" ? patternGlobs : [];

    // `auto` mode carries companion `name`/`description` fields that Kiro uses to
    // decide relevance; round-trip them so re-generating reproduces the file.
    const name = typeof frontmatter.name === "string" ? frontmatter.name : undefined;
    const description =
      typeof frontmatter.description === "string" ? frontmatter.description : undefined;

    return new RulesyncRule({
      outputRoot: process.cwd(),
      relativeDirPath: RulesyncRule.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: {
        root: false,
        targets: ["*"],
        globs,
        kiro: {
          inclusion,
          ...(fileMatchPattern !== undefined ? { fileMatchPattern } : {}),
          ...(inclusion === "auto" && name !== undefined ? { name } : {}),
          ...(inclusion === "auto" && description !== undefined ? { description } : {}),
        },
      },
      body,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  /**
   * Nested `AGENTS.md` files anywhere in the workspace tree, which Kiro loads as
   * steering context alongside `.kiro/steering/`. Import-only, like every other
   * nested scan: these are hand-authored files outside a rulesync-owned
   * directory, so enumerating them for `--delete` would sweep away work rulesync
   * never wrote.
   * @see https://kiro.dev/docs/steering/
   */
  static getNestedFilePatterns(): ToolRuleNestedFilePatterns {
    return {
      include: [`**/${KIRO_NESTED_STEERING_FILE_NAME}`],
      ignore: [
        // The workspace-root file is another target's root rule, not a nested one.
        KIRO_NESTED_STEERING_FILE_NAME,
        "**/.*/**",
        ...NESTED_SCAN_EXCLUDED_DIRS_ANY_DEPTH.map((dir) => `**/${dir}/**`),
        ...NESTED_SCAN_EXCLUDED_ROOT_DIRS.map((dir) => `${dir}/**`),
      ],
    };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): KiroRule {
    return new KiroRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: false,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "kiro",
    });
  }
}

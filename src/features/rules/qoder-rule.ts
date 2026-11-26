import { join, posix } from "node:path";

import { z } from "zod/mini";

import {
  QODER_DIR,
  QODER_OUTPUT_STYLES_DIR_PATH,
  QODER_RULE_FILE_NAME,
  QODER_RULES_DIR_PATH,
} from "../../constants/qoder-paths.js";
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { splitBraceAwareList } from "../../utils/brace-aware-list.js";
import { formatError } from "../../utils/error.js";
import { readFileContent, toPosixPath } from "../../utils/file.js";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  validateFrontmatterSchema,
} from "../../utils/frontmatter.js";
import { warnWithFallback } from "../../utils/logger.js";
import { nestedScanExclusionGlobs } from "./nested-scan-exclusions.js";
import {
  buildOutputStyleFrontmatter,
  getOutputStyleRuleOptionWarnings,
  isDirectMarkdownChild,
  isOutputStyleChannel,
  resolveTopLevelOutputStyleStem,
} from "./output-style-paths.js";
import { extractRulesDirSubprojectPath } from "./rules-dir-subproject-path.js";
import { RulesyncRule, RulesyncRuleFrontmatter } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleBuildLocalRootFileParams,
  ToolRuleExtraFixedFile,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleNestedFilePatterns,
  ToolRuleParams,
  ToolRuleSettablePaths,
} from "./tool-rule.js";

/**
 * Frontmatter of a Qoder topic rule (`.qoder/rules/*.md`). `trigger` accepts
 * the four documented activation modes; the schema stays loose (any string,
 * unknown keys kept) for forward compatibility. `alwaysApply` and `paths` are
 * the documented compatibility spellings of `trigger: always_on` / `manual`
 * and `trigger: glob` + `glob`; they are read on import but never written.
 *
 * @see https://docs.qoder.com/en/cli/04-extending-qoder-cli/memory
 */
const QoderRuleFrontmatterSchema = z.looseObject({
  trigger: z.optional(z.string()),
  alwaysApply: z.optional(z.boolean()),
  description: z.optional(z.string()),
  glob: z.optional(z.union([z.string(), z.array(z.string())])),
  paths: z.optional(z.union([z.string(), z.array(z.string())])),
});

export type QoderRuleFrontmatter = z.infer<typeof QoderRuleFrontmatterSchema>;

export type QoderRuleParams = Omit<ToolRuleParams, "fileContent"> & {
  frontmatter: QoderRuleFrontmatter;
  body: string;
  /**
   * Marks a custom output style (`.qoder/output-styles/<name>.md`, opted into
   * with `qoder.channel: output-style`) instead of a topic rule.
   */
  outputStyle?: boolean;
};

export type QoderRuleSettablePaths = Omit<ToolRuleSettablePaths, "root" | "nonRoot"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

/**
 * Globs that match every file. On a rule they mean "always on", which is the
 * default activation, so they never become a `trigger: glob` rule.
 */
const UNIVERSAL_GLOBS = new Set(["**/*", "*", "**"]);

/**
 * Activation modes that the trigger inference reproduces from `globs` alone.
 * Any other mode is kept in the `qoder` section so it survives a round trip.
 */
const INFERABLE_TRIGGERS = new Set(["always_on", "glob"]);

/**
 * The file-name glob `getExtraFixedFiles` returns for the output-styles
 * directory, so import enumerates every style in it (never deletion: the
 * directory also holds hand-written styles).
 */
const OUTPUT_STYLE_FILE_GLOB = "*.md";

/**
 * The subproject directory a nested rule is scoped to, as a POSIX path without
 * a leading `./` or trailing `/`, or `undefined` for the project root.
 */
function normalizeSubprojectPath(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = toPosixPath(value)
    .replace(/^(\.\/)+/, "")
    .replace(/\/+$/, "");
  return normalized === "" || normalized === "." ? undefined : normalized;
}

/**
 * Rewrite a project-relative glob to one relative to `subprojectPath`, which
 * is where Qoder matches the globs of a rule in `<subprojectPath>/.qoder/rules/`
 * ("relative to the project directory containing the `.qoder/` directory").
 * Returns `undefined` when the glob does not start with the subproject.
 */
function toSubprojectRelativeGlob({
  glob,
  subprojectPath,
}: {
  glob: string;
  subprojectPath: string;
}): string | undefined {
  const negated = glob.startsWith("!");
  const pattern = (negated ? glob.slice(1) : glob).replace(/^\.\//, "");
  const prefix = `${subprojectPath}/`;
  if (!pattern.startsWith(prefix) || pattern.length === prefix.length) {
    return undefined;
  }
  return `${negated ? "!" : ""}${pattern.slice(prefix.length)}`;
}

/** The inverse of {@link toSubprojectRelativeGlob}, used on import. */
function toProjectRelativeGlob({
  glob,
  subprojectPath,
}: {
  glob: string;
  subprojectPath: string;
}): string {
  const negated = glob.startsWith("!");
  const pattern = negated ? glob.slice(1) : glob;
  return `${negated ? "!" : ""}${posix.join(subprojectPath, pattern)}`;
}

function normalizeGlobList(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  const list = typeof value === "string" ? splitBraceAwareList(value) : value;
  return list.map((glob) => glob.trim()).filter((glob) => glob !== "");
}

/**
 * The activation mode a Qoder rule file declares, resolving the compatibility
 * spellings the way Qoder does: `trigger` wins over `alwaysApply`, and bare
 * `glob` / `paths` scope the rule to matching files. Qoder documents
 * `alwaysApply: false` as equivalent to `trigger: manual` (unlike Cursor, a
 * description or globs next to it do not change the mode).
 */
function resolveTrigger(frontmatter: QoderRuleFrontmatter): string {
  if (frontmatter.trigger !== undefined) {
    return frontmatter.trigger;
  }
  if (frontmatter.alwaysApply === true) {
    return "always_on";
  }
  if (frontmatter.alwaysApply === false) {
    return "manual";
  }
  if (normalizeGlobList(frontmatter.glob ?? frontmatter.paths).length > 0) {
    return "glob";
  }
  return "always_on";
}

/**
 * Rule generator for Qoder.
 *
 * - Project scope: the root rule is the project-root `AGENTS.md` (plain
 *   Markdown); non-root rules are one file per rule under `.qoder/rules/`
 *   with `trigger` frontmatter.
 * - Global scope: `~/.qoder/AGENTS.md` and `~/.qoder/rules/*.md`.
 *
 * Trigger inference, when the rule has no `qoder.trigger`:
 * - specific (non-universal) globs → `trigger: glob` + `glob: [...]`
 * - no globs or a universal glob → `trigger: always_on`
 *
 * A `qoder.trigger` (for example `model_decision` or `manual`) always takes
 * precedence and round-trips through import.
 *
 * Qoder also reads `.qoder/rules/` in any project subdirectory, on demand once
 * it reads a file under that directory, so a non-root rule carrying
 * `agentsmd.subprojectPath` is written to `<dir>/.qoder/rules/` instead
 * (project scope only) and imported back through `getNestedFilePatterns`.
 * Qoder matches such a rule's globs relative to that directory, so canonical
 * (project-relative) `globs` lose the `<dir>/` prefix on generate and get it
 * back on import.
 *
 * A non-root rule with `qoder.channel: output-style` becomes a custom output
 * style instead, `.qoder/output-styles/<rule file name>.md` (both scopes),
 * with the rule's `description` and optional `qoder.name` as the style's
 * `description` / `name` frontmatter.
 *
 * @see https://docs.qoder.com/en/cli/04-extending-qoder-cli/memory
 * @see https://docs.qoder.com/cli/output-styles
 */
export class QoderRule extends ToolRule {
  /**
   * Build this tool's separate personal local-root file (`localRootMode:
   * "separate-local-file"`), for generation and import. See
   * {@link ToolRuleBuildLocalRootFileParams}.
   */
  static buildLocalRootFile({
    outputRoot,
    fileName,
    body,
    relativeDirPath,
    localRoot,
  }: ToolRuleBuildLocalRootFileParams): ToolRule {
    // `AGENTS.local.md` sits next to the project-root `AGENTS.md` Qoder reads,
    // not under `.qoder/`, and is plain markdown with no trigger frontmatter.
    return new QoderRule({
      outputRoot,
      relativeDirPath: relativeDirPath ?? ".",
      relativeFilePath: fileName,
      frontmatter: {},
      body,
      validate: true,
      root: true,
      localRoot,
    });
  }

  private readonly frontmatter: QoderRuleFrontmatter;
  private readonly body: string;
  private readonly outputStyle: boolean;

  constructor({ frontmatter, body, outputStyle = false, ...rest }: QoderRuleParams) {
    if (rest.validate) {
      const result = QoderRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      // The root AGENTS.md is plain Markdown; topic rules carry frontmatter,
      // and so does an output style unless it has none to carry.
      fileContent:
        rest.root || (outputStyle && Object.keys(frontmatter).length === 0)
          ? body
          : stringifyFrontmatter(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
    this.outputStyle = outputStyle;
  }

  /**
   * Whether the given path is a custom output style: a direct `.md` child of
   * `.qoder/output-styles/`, at either scope.
   */
  private static isOutputStylePath({
    relativeDirPath,
    relativeFilePath,
  }: {
    relativeDirPath: string | undefined;
    relativeFilePath: string;
  }): boolean {
    return isDirectMarkdownChild({
      outputStylesDirPath: QODER_OUTPUT_STYLES_DIR_PATH,
      relativeDirPath,
      relativeFilePath,
    });
  }

  /** See {@link getOutputStyleRuleOptionWarnings}. */
  static getRuleOptionWarnings(rules: RulesyncRule[]): string[] {
    return getOutputStyleRuleOptionWarnings({
      rules,
      toolTarget: "qoder",
      isTargetedByRulesyncRule: (rule) => this.isTargetedByRulesyncRule(rule),
    });
  }

  /** Whether a rule opts into the `output-style` channel (non-root only). */
  private static isOutputStyleRule(rulesyncRule: RulesyncRule): boolean {
    const frontmatter = rulesyncRule.getFrontmatter();
    return isOutputStyleChannel({ root: frontmatter.root, channel: frontmatter.qoder?.channel });
  }

  /**
   * The output-styles directory, enumerated for import only: it also holds
   * styles users write by hand (including personal ones in
   * `~/.qoder/output-styles/`) that rulesync cannot tell from its own, so
   * `--delete` leaves it alone.
   */
  static getExtraFixedFiles(_params: { global?: boolean } = {}): ToolRuleExtraFixedFile[] {
    return [
      {
        relativeDirPath: QODER_OUTPUT_STYLES_DIR_PATH,
        relativeFilePath: OUTPUT_STYLE_FILE_GLOB,
        importOnly: true,
      },
    ];
  }

  /** Qoder loads output styles itself; they are not rules to reference. */
  override isExcludedFromRootReferences(): boolean {
    return this.outputStyle;
  }

  static getSettablePaths({
    global = false,
  }: {
    global?: boolean;
  } = {}): QoderRuleSettablePaths {
    return {
      root: {
        // The project file sits at the project root; the user file sits inside
        // `~/.qoder/`, which the processor reaches by supplying the home
        // directory as outputRoot.
        relativeDirPath: global ? join(QODER_DIR, ".") : ".",
        relativeFilePath: QODER_RULE_FILE_NAME,
      },
      nonRoot: {
        relativeDirPath: join(QODER_DIR, "rules"),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<QoderRule> {
    const paths = this.getSettablePaths({ global });
    if (this.isOutputStylePath({ relativeDirPath, relativeFilePath })) {
      const filePath = join(outputRoot, QODER_OUTPUT_STYLES_DIR_PATH, relativeFilePath);
      const { frontmatter, body } = parseFrontmatter(await readFileContent(filePath), filePath);
      return new QoderRule({
        outputRoot,
        relativeDirPath: QODER_OUTPUT_STYLES_DIR_PATH,
        relativeFilePath,
        frontmatter,
        body: body.trim(),
        validate,
        root: false,
        outputStyle: true,
      });
    }
    // A file discovered by `getNestedFilePatterns` arrives as its own directory
    // plus its basename; it is re-split into the subproject's rules directory
    // and the path inside it, matching how the root `.qoder/rules/` is read.
    // Checked first: the root dispatch below reads every other directory as a
    // root-file location.
    const nested =
      relativeDirPath === undefined || global
        ? undefined
        : extractRulesDirSubprojectPath({ relativeDirPath, toolDir: QODER_DIR });
    if (nested) {
      return this.fromTopicRuleFile({
        outputRoot,
        relativeDirPath: join(nested.subprojectPath, QODER_RULES_DIR_PATH),
        relativeFilePath: join(nested.innerDirPath, relativeFilePath),
        validate,
      });
    }

    // Dispatch on the directory the processor resolved, not on the file name:
    // a topic rule named `AGENTS.md` inside `.qoder/rules/` must not be misread
    // as the root file. Fall back to the file name when the caller omits it.
    const isRoot =
      relativeDirPath !== undefined
        ? relativeDirPath !== QODER_RULES_DIR_PATH
        : relativeFilePath === paths.root.relativeFilePath;

    if (isRoot) {
      const rootDirPath = relativeDirPath ?? paths.root.relativeDirPath;
      const fileContent = await readFileContent(
        join(outputRoot, rootDirPath, paths.root.relativeFilePath),
      );
      return new QoderRule({
        outputRoot,
        relativeDirPath: rootDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        frontmatter: {},
        body: fileContent.trim(),
        validate,
        root: true,
      });
    }

    return this.fromTopicRuleFile({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      validate,
    });
  }

  /** Read a topic rule from a `.qoder/rules/` directory (root or nested). */
  private static async fromTopicRuleFile({
    outputRoot,
    relativeDirPath,
    relativeFilePath,
    validate,
  }: {
    outputRoot: string;
    relativeDirPath: string;
    relativeFilePath: string;
    validate: boolean;
  }): Promise<QoderRule> {
    const filePath = join(outputRoot, relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);

    const result = QoderRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new QoderRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: body.trim(),
      validate,
      root: false,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): QoderRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const root = rulesyncFrontmatter.root ?? false;
    const paths = this.getSettablePaths({ global });
    const body = rulesyncRule.getBody();

    if (this.isOutputStyleRule(rulesyncRule)) {
      return this.buildOutputStyle({ outputRoot, rulesyncRule, validate });
    }

    if (root) {
      return new QoderRule({
        outputRoot,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        frontmatter: {},
        body,
        validate,
        root: true,
      });
    }

    // A directory-scoped rule goes to that directory's own `.qoder/rules/`,
    // which Qoder loads only once it reads a file under that directory. Project
    // scope only: there is no workspace tree to nest under in global scope.
    const subprojectPath = global
      ? undefined
      : normalizeSubprojectPath(rulesyncFrontmatter.agentsmd?.subprojectPath);
    const relativeDirPath =
      subprojectPath !== undefined
        ? join(subprojectPath, QODER_RULES_DIR_PATH)
        : paths.nonRoot.relativeDirPath;

    return new QoderRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      frontmatter: QoderRule.buildFrontmatter({
        rulesyncFrontmatter,
        relativeFilePath: rulesyncRule.getRelativeFilePath(),
        subprojectPath,
      }),
      body,
      validate,
      root: false,
    });
  }

  /**
   * Write an `output-style` rule as `.qoder/output-styles/<name>.md`. The file
   * name is the rule's own, so a rule nested under `.rulesync/rules/` is
   * refused: Qoder reads only the files directly in `output-styles/`.
   */
  private static buildOutputStyle({
    outputRoot,
    rulesyncRule,
    validate,
  }: {
    outputRoot: string;
    rulesyncRule: RulesyncRule;
    validate: boolean;
  }): QoderRule {
    const { description, qoder } = rulesyncRule.getFrontmatter();
    const sourcePath = rulesyncRule.getRelativeFilePath();
    const stem = resolveTopLevelOutputStyleStem({
      sourcePath,
      message: `Rule '${sourcePath}' sets qoder.channel: output-style but is nested in a subdirectory: Qoder reads only the files directly in .qoder/output-styles/, so move it to the top of ${RULESYNC_RULES_RELATIVE_DIR_PATH}.`,
    });
    return new QoderRule({
      outputRoot,
      relativeDirPath: QODER_OUTPUT_STYLES_DIR_PATH,
      relativeFilePath: `${stem}.md`,
      frontmatter: buildOutputStyleFrontmatter({ name: qoder?.name, description }),
      body: rulesyncRule.getBody(),
      validate,
      root: false,
      outputStyle: true,
    });
  }

  private static buildFrontmatter({
    rulesyncFrontmatter,
    relativeFilePath,
    subprojectPath,
  }: {
    rulesyncFrontmatter: RulesyncRuleFrontmatter;
    relativeFilePath: string;
    subprojectPath?: string;
  }): QoderRuleFrontmatter {
    const {
      trigger: storedTrigger,
      glob: storedGlob,
      // Output-style keys, never written to a topic rule.
      channel: _channel,
      name: _name,
      ...section
    } = rulesyncFrontmatter.qoder ?? {};
    // `qoder.glob` is Qoder's own value and is written verbatim; canonical
    // `globs` are project-relative and are rebased onto a nested rule's
    // directory, where Qoder matches them.
    const sourceGlobs =
      storedGlob !== undefined
        ? normalizeGlobList(storedGlob)
        : QoderRule.rebaseGlobs({
            globs: normalizeGlobList(rulesyncFrontmatter.globs),
            subprojectPath,
            relativeFilePath,
          });
    const specificGlobs = sourceGlobs.filter((glob) => !UNIVERSAL_GLOBS.has(glob));
    let trigger = storedTrigger ?? (specificGlobs.length > 0 ? "glob" : "always_on");
    const description = section.description ?? rulesyncFrontmatter.description;

    // Qoder never injects a `glob` rule without a valid `glob`, nor a
    // `model_decision` rule without a description.
    if (trigger === "glob" && specificGlobs.length === 0) {
      warnWithFallback(
        undefined,
        `Rule ${relativeFilePath} sets qoder.trigger "glob" without specific globs, which Qoder would never apply. Writing it as "always_on" instead; add specific globs (or qoder.glob) to scope it.`,
      );
      trigger = "always_on";
    }
    if (trigger === "model_decision" && (description === undefined || description === "")) {
      warnWithFallback(
        undefined,
        `Rule ${relativeFilePath} sets qoder.trigger "model_decision" without a description, so Qoder will not apply it. Add a description.`,
      );
    }

    return {
      ...section,
      trigger,
      ...(trigger === "glob" && specificGlobs.length > 0 && { glob: specificGlobs }),
      ...(description !== undefined && description !== "" && { description }),
    };
  }

  /**
   * Rebase project-relative globs onto `subprojectPath` for a rule written to
   * `<subprojectPath>/.qoder/rules/`. A glob outside the subproject cannot be
   * rebased and is written as is, with a warning, since Qoder then matches it
   * relative to the subproject.
   */
  private static rebaseGlobs({
    globs,
    subprojectPath,
    relativeFilePath,
  }: {
    globs: string[];
    subprojectPath: string | undefined;
    relativeFilePath: string;
  }): string[] {
    if (subprojectPath === undefined) {
      return globs;
    }
    const outside: string[] = [];
    const rebased = globs.map((glob) => {
      if (UNIVERSAL_GLOBS.has(glob)) {
        return glob;
      }
      const relative = toSubprojectRelativeGlob({ glob, subprojectPath });
      if (relative === undefined) {
        outside.push(glob);
        return glob;
      }
      return relative;
    });
    if (outside.length > 0) {
      warnWithFallback(
        undefined,
        `Rule ${relativeFilePath} is written to ${subprojectPath}/.qoder/rules/, where Qoder matches globs relative to ${subprojectPath}, but ${outside.map((glob) => `"${glob}"`).join(", ")} does not start with "${subprojectPath}/". It is written as is; make it start with "${subprojectPath}/" or move the rule out of the subproject.`,
      );
    }
    return rebased;
  }

  toRulesyncRule(): RulesyncRule {
    if (this.isRoot()) {
      return this.toRulesyncRuleDefault();
    }
    if (this.outputStyle) {
      // The style's `name` / `description` map back onto `qoder.name` /
      // `description`, and the file keeps its own name, so generate writes it
      // back to the same path.
      const { name, description } = this.frontmatter;
      return new RulesyncRule({
        outputRoot: this.getOutputRoot(),
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: this.getRelativeFilePath(),
        frontmatter: {
          root: false,
          targets: ["qoder"],
          ...(typeof description === "string" && { description }),
          qoder: {
            channel: "output-style",
            ...(typeof name === "string" && name.trim() !== "" && { name }),
          },
        },
        body: this.body,
        validate: true,
      });
    }

    const trigger = resolveTrigger(this.frontmatter);
    const {
      trigger: _trigger,
      alwaysApply: _alwaysApply,
      description,
      glob,
      paths,
      ...unmapped
    } = this.frontmatter;
    // A nested rule's globs are relative to its subproject; canonical `globs`
    // are project-relative, so the subproject is put back in front.
    const subprojectPath = extractRulesDirSubprojectPath({
      relativeDirPath: this.getRelativeDirPath(),
      toolDir: QODER_DIR,
    })?.subprojectPath;
    const fileGlobs = normalizeGlobList(glob ?? paths).map((fileGlob) =>
      subprojectPath === undefined
        ? fileGlob
        : toProjectRelativeGlob({ glob: fileGlob, subprojectPath }),
    );
    const globs = trigger === "glob" ? fileGlobs : trigger === "always_on" ? ["**/*"] : [];
    // Keep the mode when inference from `globs` would not reproduce it: a
    // non-inferable mode, or a `glob` rule whose glob list is empty.
    const keepTrigger =
      !INFERABLE_TRIGGERS.has(trigger) || (trigger === "glob" && fileGlobs.length === 0);
    const section = { ...unmapped, ...(keepTrigger && { trigger }) };
    if (trigger === "glob" && fileGlobs.length === 0) {
      warnWithFallback(
        undefined,
        `Qoder rule ${this.getRelativeFilePath()} has trigger "glob" without a glob list, so Qoder never applies it. It is imported with qoder.trigger "glob", which the next generate writes as "always_on"; add globs, or set qoder.trigger to "manual" to keep it inactive.`,
      );
    }

    // A nested rule carries its directory back through `agentsmd.subprojectPath`
    // and targets qoder only, so the next generate neither surprises other
    // tools with new nested files nor folds it into their root files. An
    // always-on rule keeps `**/*` rather than a directory glob, which would
    // turn it into a file-scoped one.

    const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
      targets: subprojectPath === undefined ? ["*"] : ["qoder"],
      root: false,
      description,
      globs,
      ...(subprojectPath !== undefined && { agentsmd: { subprojectPath } }),
      ...(Object.keys(section).length > 0 && { qoder: section }),
    };

    return new RulesyncRule({
      outputRoot: this.getOutputRoot(),
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    return validateFrontmatterSchema({
      schema: QoderRuleFrontmatterSchema,
      frontmatter: this.frontmatter,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
    });
  }

  getFrontmatter(): QoderRuleFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): QoderRule {
    const outputStyle = this.isOutputStylePath({ relativeDirPath, relativeFilePath });
    return new QoderRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
      root:
        !outputStyle &&
        relativeDirPath !== QODER_RULES_DIR_PATH &&
        relativeFilePath === QODER_RULE_FILE_NAME,
      outputStyle,
    });
  }

  /**
   * The `.qoder/rules/` folders of project subdirectories, which Qoder loads
   * on demand once it reads a file under that directory. The shared nested
   * scan ignores every hidden directory, which would skip `.qoder` itself, so
   * only a `.qoder/rules/` below another hidden directory is ignored here
   * (`extractRulesDirSubprojectPath` rejects one again on import). Import-only,
   * like every other nested scan: these files sit outside the rulesync-owned
   * root `.qoder/rules/`, so `--delete` never sweeps them.
   * @see https://docs.qoder.com/cli/memory
   */
  static getNestedFilePatterns(): ToolRuleNestedFilePatterns {
    const rulesDirPath = `${QODER_DIR}/rules`;
    return {
      include: [`**/${rulesDirPath}/**/*.md`],
      ignore: [
        // The project-root rules directory is read as the `nonRoot` one.
        `${rulesDirPath}/**`,
        `**/.*/**/${rulesDirPath}/**`,
        ...nestedScanExclusionGlobs(),
      ],
      // `rulesync gitignore` ignores `**/.qoder/rules/`, so the gitignore filter
      // stops at `<dir>/.qoder` instead of testing the rules directory itself.
      ownedDirPath: rulesDirPath,
    };
  }

  protected static override readonly toolTarget = "qoder";
}

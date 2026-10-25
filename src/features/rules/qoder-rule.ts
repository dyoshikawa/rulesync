import { basename, extname, join } from "node:path";

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
import { readFileContent } from "../../utils/file.js";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  validateFrontmatterSchema,
} from "../../utils/frontmatter.js";
import { warnWithFallback } from "../../utils/logger.js";
import { RulesyncRule, RulesyncRuleFrontmatter } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleExtraFixedFile,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
  buildToolPath,
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
 * A non-root rule with `qoder.channel: output-style` becomes a custom output
 * style instead, `.qoder/output-styles/<rule file name>.md` (both scopes),
 * with the rule's `description` and optional `qoder.name` as the style's
 * `description` / `name` frontmatter.
 *
 * @see https://docs.qoder.com/en/cli/04-extending-qoder-cli/memory
 * @see https://docs.qoder.com/cli/output-styles
 */
export class QoderRule extends ToolRule {
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
    return (
      relativeDirPath === QODER_OUTPUT_STYLES_DIR_PATH &&
      extname(relativeFilePath) === ".md" &&
      basename(relativeFilePath) === relativeFilePath
    );
  }

  /** Whether a rule opts into the `output-style` channel (non-root only). */
  private static isOutputStyleRule(rulesyncRule: RulesyncRule): boolean {
    const frontmatter = rulesyncRule.getFrontmatter();
    return !frontmatter.root && frontmatter.qoder?.channel === "output-style";
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
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): QoderRuleSettablePaths {
    return {
      root: {
        // The project file sits at the project root; the user file sits inside
        // `~/.qoder/`, which the processor reaches by supplying the home
        // directory as outputRoot.
        relativeDirPath: global ? buildToolPath(QODER_DIR, ".", excludeToolDir) : ".",
        relativeFilePath: QODER_RULE_FILE_NAME,
      },
      nonRoot: {
        relativeDirPath: buildToolPath(QODER_DIR, "rules", excludeToolDir),
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

    const filePath = join(outputRoot, paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);

    const result = QoderRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new QoderRule({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
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

    return new QoderRule({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      frontmatter: QoderRule.buildFrontmatter(
        rulesyncFrontmatter,
        rulesyncRule.getRelativeFilePath(),
      ),
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
    if (basename(sourcePath) !== sourcePath) {
      throw new Error(
        `Rule '${sourcePath}' sets qoder.channel: output-style but is nested in a subdirectory: Qoder reads only the files directly in .qoder/output-styles/, so move it to the top of ${RULESYNC_RULES_RELATIVE_DIR_PATH}.`,
      );
    }
    const name = qoder?.name;
    return new QoderRule({
      outputRoot,
      relativeDirPath: QODER_OUTPUT_STYLES_DIR_PATH,
      relativeFilePath: `${basename(sourcePath, extname(sourcePath))}.md`,
      frontmatter: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
      },
      body: rulesyncRule.getBody(),
      validate,
      root: false,
      outputStyle: true,
    });
  }

  private static buildFrontmatter(
    rulesyncFrontmatter: RulesyncRuleFrontmatter,
    relativeFilePath: string,
  ): QoderRuleFrontmatter {
    const {
      trigger: storedTrigger,
      glob: storedGlob,
      // Output-style keys, never written to a topic rule.
      channel: _channel,
      name: _name,
      ...section
    } = rulesyncFrontmatter.qoder ?? {};
    const specificGlobs = normalizeGlobList(storedGlob ?? rulesyncFrontmatter.globs).filter(
      (glob) => !UNIVERSAL_GLOBS.has(glob),
    );
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
    const fileGlobs = normalizeGlobList(glob ?? paths);
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

    const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
      targets: ["*"],
      root: false,
      description,
      globs,
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

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "qoder",
    });
  }
}

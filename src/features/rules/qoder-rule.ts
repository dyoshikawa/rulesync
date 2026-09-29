import { join } from "node:path";

import { z } from "zod/mini";

import {
  QODER_DIR,
  QODER_RULE_FILE_NAME,
  QODER_RULES_DIR_PATH,
} from "../../constants/qoder-paths.js";
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { splitBraceAwareList } from "../../utils/brace-aware-list.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncRule, RulesyncRuleFrontmatter } from "./rulesync-rule.js";
import {
  ToolRule,
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
export const QoderRuleFrontmatterSchema = z.looseObject({
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
 * `glob` / `paths` scope the rule to matching files.
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
 * @see https://docs.qoder.com/en/cli/04-extending-qoder-cli/memory
 */
export class QoderRule extends ToolRule {
  private readonly frontmatter: QoderRuleFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: QoderRuleParams) {
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
      // The root AGENTS.md is plain Markdown; topic rules carry frontmatter.
      fileContent: rest.root ? body : stringifyFrontmatter(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
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
      frontmatter: QoderRule.buildFrontmatter(rulesyncFrontmatter),
      body,
      validate,
      root: false,
    });
  }

  private static buildFrontmatter(
    rulesyncFrontmatter: RulesyncRuleFrontmatter,
  ): QoderRuleFrontmatter {
    const {
      trigger: storedTrigger,
      glob: storedGlob,
      ...section
    } = rulesyncFrontmatter.qoder ?? {};
    const specificGlobs = normalizeGlobList(storedGlob ?? rulesyncFrontmatter.globs).filter(
      (glob) => !UNIVERSAL_GLOBS.has(glob),
    );
    const trigger = storedTrigger ?? (specificGlobs.length > 0 ? "glob" : "always_on");
    const description = section.description ?? rulesyncFrontmatter.description;

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

    const trigger = resolveTrigger(this.frontmatter);
    const fileGlobs = normalizeGlobList(this.frontmatter.glob ?? this.frontmatter.paths);
    const globs = trigger === "glob" ? fileGlobs : trigger === "always_on" ? ["**/*"] : [];

    const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
      targets: ["*"],
      root: false,
      description: this.frontmatter.description,
      globs,
      ...(!INFERABLE_TRIGGERS.has(trigger) && { qoder: { trigger } }),
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
    const result = QoderRuleFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    }
    return {
      success: false,
      error: new Error(
        `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
      ),
    };
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
    return new QoderRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
      root: relativeDirPath !== QODER_RULES_DIR_PATH && relativeFilePath === QODER_RULE_FILE_NAME,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "qoder",
    });
  }
}

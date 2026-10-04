import { join } from "node:path";

import {
  ANTIGRAVITY_IDE_AGENTS_DIR,
  ANTIGRAVITY_IDE_GEMINI_DIR,
  ANTIGRAVITY_IDE_GLOBAL_RULE_FILE_NAME,
  ANTIGRAVITY_IDE_GLOBAL_RULES_SUBDIR,
  ANTIGRAVITY_IDE_RULE_FILE_NAME,
} from "../../constants/antigravity-ide-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent, toKebabCaseFilename } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import {
  AntigravityRuleFrontmatter,
  AntigravityRuleFrontmatterSchema,
  STRATEGIES,
  normalizeStoredAntigravity,
  parseGlobsString,
  toGlobalRuleFileName,
} from "./antigravity-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  buildToolPath,
} from "./tool-rule.js";

/**
 * Parameters for creating an AntigravityIdeRule instance.
 * Requires frontmatter and body separately instead of combined fileContent.
 */
export type AntigravityIdeRuleParams = Omit<ToolRuleParams, "fileContent"> & {
  frontmatter: AntigravityRuleFrontmatter;
  body: string;
};

export type AntigravityIdeRuleSettablePaths = {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

/**
 * Rule generator for the Google Antigravity IDE (Antigravity 2.0).
 *
 * It reuses the same trigger-strategy frontmatter logic (see
 * `antigravity-rule.ts`) but defaults to the new plural `.agents/rules/`
 * directory and adds global scope (`~/.gemini/GEMINI.md`).
 *
 * - Project scope: every rule is placed as a non-root file in
 *   `.agents/rules/` with Antigravity trigger frontmatter.
 * - Global scope: a plain `~/.gemini/GEMINI.md` root file without
 *   frontmatter, and non-root rules with trigger frontmatter in
 *   `~/.gemini/config/rules/`. Both are shared with the Antigravity CLI, which
 *   writes the same files for the same rules.
 *
 * @see https://antigravity.google/docs/rules
 */
export class AntigravityIdeRule extends ToolRule {
  private readonly frontmatter: AntigravityRuleFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: AntigravityIdeRuleParams) {
    if (rest.validate !== false) {
      const result = AntigravityRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      // Root rules are plain markdown (`AGENTS.md` / `GEMINI.md`); non-root
      // rules carry Antigravity trigger frontmatter.
      fileContent: rest.root ? body : stringifyFrontmatter(body, frontmatter),
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }

  protected static getGlobalRootPath(excludeToolDir?: boolean): {
    relativeDirPath: string;
    relativeFilePath: string;
  } {
    return {
      relativeDirPath: buildToolPath(ANTIGRAVITY_IDE_GEMINI_DIR, ".", excludeToolDir),
      relativeFilePath: ANTIGRAVITY_IDE_GLOBAL_RULE_FILE_NAME,
    };
  }

  protected static getProjectRootPath(): {
    relativeDirPath: string;
    relativeFilePath: string;
  } {
    return {
      relativeDirPath: ".",
      relativeFilePath: ANTIGRAVITY_IDE_RULE_FILE_NAME,
    };
  }

  static getSettablePaths({
    global = false,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): AntigravityIdeRuleSettablePaths {
    if (global) {
      return {
        root: this.getGlobalRootPath(excludeToolDir),
        nonRoot: {
          relativeDirPath: buildToolPath(
            ANTIGRAVITY_IDE_GEMINI_DIR,
            ANTIGRAVITY_IDE_GLOBAL_RULES_SUBDIR,
            excludeToolDir,
          ),
        },
      };
    }
    // Project scope: the root rule is emitted as a plain cross-tool `AGENTS.md`
    // at the project root (read by Antigravity IDE v1.20.3+ in addition to
    // GEMINI.md), and non-root rules go under `.agents/rules/` with trigger
    // frontmatter.
    return {
      root: this.getProjectRootPath(),
      nonRoot: {
        relativeDirPath: buildToolPath(ANTIGRAVITY_IDE_AGENTS_DIR, "rules", excludeToolDir),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<AntigravityIdeRule> {
    const paths = this.getSettablePaths({ global });
    // Root rules (project `AGENTS.md`, global `GEMINI.md`) are plain markdown
    // without Antigravity trigger frontmatter. A non-root file that happens to
    // share the root file's name (e.g. `~/.gemini/config/rules/GEMINI.md`) is
    // not the root rule.
    const isRoot =
      relativeFilePath === paths.root.relativeFilePath &&
      (relativeDirPath === undefined || relativeDirPath === paths.root.relativeDirPath);
    if (isRoot) {
      const rootPath = paths.root;
      const rootContent = await readFileContent(
        join(outputRoot, rootPath.relativeDirPath, rootPath.relativeFilePath),
      );
      return new this({
        outputRoot,
        relativeDirPath: rootPath.relativeDirPath,
        relativeFilePath: rootPath.relativeFilePath,
        frontmatter: {},
        body: rootContent,
        validate,
        root: true,
        global,
      });
    }

    const nonRootDirPath = paths.nonRoot.relativeDirPath;
    const filePath = join(outputRoot, nonRootDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);

    let parsedFrontmatter: AntigravityRuleFrontmatter;
    if (validate) {
      const result = AntigravityRuleFrontmatterSchema.safeParse(frontmatter);
      if (result.success) {
        parsedFrontmatter = result.data;
      } else {
        throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
      }
    } else {
      parsedFrontmatter = frontmatter as AntigravityRuleFrontmatter;
    }

    return new this({
      outputRoot,
      relativeDirPath: nonRootDirPath,
      relativeFilePath,
      body,
      frontmatter: parsedFrontmatter,
      validate,
      root: false,
      global,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): AntigravityIdeRule {
    const paths = this.getSettablePaths({ global });

    // Root rule: emit a plain project `AGENTS.md` or global `GEMINI.md` (no
    // Antigravity trigger frontmatter), mirroring the agentsmd adapter.
    // Non-root rules keep their trigger frontmatter.
    if (rulesyncRule.getFrontmatter().root) {
      const rootPath = paths.root;
      return new this({
        outputRoot,
        relativeDirPath: rootPath.relativeDirPath,
        relativeFilePath: rootPath.relativeFilePath,
        frontmatter: {},
        body: rulesyncRule.getBody(),
        validate,
        root: true,
        global,
      });
    }

    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

    const storedAntigravity = rulesyncFrontmatter.antigravity;
    const normalized = normalizeStoredAntigravity(storedAntigravity);
    const storedTrigger = storedAntigravity?.trigger;

    const strategy = STRATEGIES.find((s) => s.canHandle(storedTrigger));
    if (!strategy) {
      throw new Error(`No strategy found for trigger: ${storedTrigger}`);
    }

    const frontmatter = strategy.generateFrontmatter(normalized, rulesyncFrontmatter);

    // The global rules directory is shared with the CLI, so use its file name
    // there to keep both targets writing the same file.
    const relativeFilePath = global
      ? toGlobalRuleFileName(rulesyncRule.getRelativeFilePath())
      : toKebabCaseFilename(rulesyncRule.getRelativeFilePath());

    return new this({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      frontmatter,
      body: rulesyncRule.getBody(),
      validate,
      root: false,
      global,
    });
  }

  toRulesyncRule(): RulesyncRule {
    if (this.root) {
      // Global GEMINI.md round-trips as a plain root rule.
      return this.toRulesyncRuleDefault();
    }

    const strategy = STRATEGIES.find((s) => s.canHandle(this.frontmatter.trigger));

    let rulesyncData: {
      globs: string[];
      description?: string;
      antigravity: Record<string, unknown>;
    } = {
      globs: [],
      antigravity: this.frontmatter,
    };

    if (strategy) {
      rulesyncData = strategy.exportRulesyncData(this.frontmatter);
    }

    const antigravityForRulesync = {
      ...rulesyncData.antigravity,
      globs: this.frontmatter.globs ? parseGlobsString(this.frontmatter.globs) : undefined,
    };

    return new RulesyncRule({
      outputRoot: process.cwd(),
      relativeDirPath: RulesyncRule.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: {
        root: false,
        targets: ["*"],
        ...rulesyncData,
        antigravity: antigravityForRulesync,
      },
      body: this.body,
    });
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): AntigravityRuleFrontmatter {
    return this.frontmatter;
  }

  validate(): ValidationResult {
    const result = AntigravityRuleFrontmatterSchema.safeParse(this.frontmatter);
    if (!result.success) {
      return { success: false, error: new Error(formatError(result.error)) };
    }
    return { success: true, error: null };
  }

  /**
   * `~/.gemini/config/rules/` is shared with the Antigravity CLI and holds
   * global rules the user created outside rulesync, which cannot be told apart
   * from generated ones, so the orphan sweep never removes files there.
   */
  override isDeletable(): boolean {
    return !this.global || this.root;
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): AntigravityIdeRule {
    // The global GEMINI.md and the project-root AGENTS.md are both plain root
    // files; non-root rules live under `.agents/rules/` or
    // `~/.gemini/config/rules/`.
    const rootPath = this.getSettablePaths({ global }).root;
    const isRoot =
      relativeFilePath === rootPath.relativeFilePath &&
      relativeDirPath === rootPath.relativeDirPath;
    return new this({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
      root: isRoot,
      global,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "antigravity-ide",
    });
  }
}

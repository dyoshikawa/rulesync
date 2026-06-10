import { join } from "node:path";

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
} from "./antigravity-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePathsGlobal,
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
 * This is the v2 successor of {@link AntigravityRule}; it reuses the same
 * trigger-strategy frontmatter logic but defaults to the new plural
 * `.agents/rules/` directory and adds global scope (`~/.gemini/GEMINI.md`).
 *
 * - Project scope: every rule is placed as a non-root file in
 *   `.agents/rules/` with Antigravity trigger frontmatter.
 * - Global scope: a single plain `~/.gemini/GEMINI.md` root file (shared with
 *   the Antigravity CLI), without frontmatter.
 *
 * Back-compat reads of the singular `.agent/` tree are handled by the
 * deprecated `antigravity` alias target (see {@link AntigravityRule}).
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
      // Global root rules are plain markdown (GEMINI.md); project rules carry
      // Antigravity trigger frontmatter.
      fileContent: rest.root ? body : stringifyFrontmatter(body, frontmatter),
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }

  private static getGlobalRootPath(excludeToolDir?: boolean): {
    relativeDirPath: string;
    relativeFilePath: string;
  } {
    return {
      relativeDirPath: buildToolPath(".gemini", ".", excludeToolDir),
      relativeFilePath: "GEMINI.md",
    };
  }

  private static getProjectRootPath(): {
    relativeDirPath: string;
    relativeFilePath: string;
  } {
    return {
      relativeDirPath: ".",
      relativeFilePath: "AGENTS.md",
    };
  }

  static getSettablePaths({
    global = false,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): AntigravityIdeRuleSettablePaths | ToolRuleSettablePathsGlobal {
    if (global) {
      return {
        root: AntigravityIdeRule.getGlobalRootPath(excludeToolDir),
      };
    }
    // Project scope: the root rule is emitted as a plain cross-tool `AGENTS.md`
    // at the project root (read by Antigravity IDE v1.20.3+ in addition to
    // GEMINI.md), and non-root rules go under `.agents/rules/` with trigger
    // frontmatter.
    return {
      root: AntigravityIdeRule.getProjectRootPath(),
      nonRoot: {
        relativeDirPath: buildToolPath(".agents", "rules", excludeToolDir),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<AntigravityIdeRule> {
    if (global) {
      const rootPath = AntigravityIdeRule.getGlobalRootPath();
      const fileContent = await readFileContent(
        join(outputRoot, rootPath.relativeDirPath, rootPath.relativeFilePath),
      );
      // GEMINI.md is plain markdown without Antigravity frontmatter.
      return new AntigravityIdeRule({
        outputRoot,
        relativeDirPath: rootPath.relativeDirPath,
        relativeFilePath: rootPath.relativeFilePath,
        frontmatter: {},
        body: fileContent,
        validate,
        root: true,
      });
    }

    // Project root rule: a plain cross-tool `AGENTS.md` without Antigravity
    // trigger frontmatter.
    if (relativeFilePath === "AGENTS.md") {
      const rootPath = AntigravityIdeRule.getProjectRootPath();
      const rootContent = await readFileContent(
        join(outputRoot, rootPath.relativeDirPath, rootPath.relativeFilePath),
      );
      return new AntigravityIdeRule({
        outputRoot,
        relativeDirPath: rootPath.relativeDirPath,
        relativeFilePath: rootPath.relativeFilePath,
        frontmatter: {},
        body: rootContent,
        validate,
        root: true,
      });
    }

    const nonRootDirPath = buildToolPath(".agents", "rules");
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

    return new AntigravityIdeRule({
      outputRoot,
      relativeDirPath: nonRootDirPath,
      relativeFilePath,
      body,
      frontmatter: parsedFrontmatter,
      validate,
      root: false,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): AntigravityIdeRule {
    if (global) {
      // Global scope is a single plain GEMINI.md root file.
      const rootPath = AntigravityIdeRule.getGlobalRootPath();
      return new AntigravityIdeRule({
        outputRoot,
        relativeDirPath: rootPath.relativeDirPath,
        relativeFilePath: rootPath.relativeFilePath,
        frontmatter: {},
        body: rulesyncRule.getBody(),
        validate,
        root: true,
      });
    }

    // Project root rule: emit a plain cross-tool `AGENTS.md` (no Antigravity
    // trigger frontmatter), mirroring the agentsmd adapter. Non-root rules keep
    // their trigger frontmatter under `.agents/rules/`.
    if (rulesyncRule.getFrontmatter().root) {
      const rootPath = AntigravityIdeRule.getProjectRootPath();
      return new AntigravityIdeRule({
        outputRoot,
        relativeDirPath: rootPath.relativeDirPath,
        relativeFilePath: rootPath.relativeFilePath,
        frontmatter: {},
        body: rulesyncRule.getBody(),
        validate,
        root: true,
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

    // Both root and non-root rules are placed in the .agents/rules directory.
    const kebabCaseFilename = toKebabCaseFilename(rulesyncRule.getRelativeFilePath());

    return new AntigravityIdeRule({
      outputRoot,
      relativeDirPath: buildToolPath(".agents", "rules"),
      relativeFilePath: kebabCaseFilename,
      frontmatter,
      body: rulesyncRule.getBody(),
      validate,
      root: false,
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

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): AntigravityIdeRule {
    // The global GEMINI.md and the project-root AGENTS.md are both plain root
    // files; non-root rules live under `.agents/rules/`.
    const isRoot = global || (relativeFilePath === "AGENTS.md" && relativeDirPath === ".");
    return new AntigravityIdeRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
      root: isRoot,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "antigravity-ide",
    });
  }
}

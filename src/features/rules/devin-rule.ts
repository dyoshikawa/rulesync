import { join } from "node:path";

import {
  DEVIN_DIR,
  DEVIN_GLOBAL_AGENTS_FILE_NAME,
  DEVIN_GLOBAL_CONFIG_DIR_PATH,
} from "../../constants/devin-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent, toKebabCaseFilename } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
  buildToolPath,
} from "./tool-rule.js";
import {
  TriggerRuleFrontmatter,
  TriggerRuleFrontmatterSchema,
  createTriggerStrategies,
  normalizeStoredTriggerRule,
  parseGlobsString,
} from "./trigger-rule-strategies.js";

/**
 * Frontmatter schema for Devin project rules.
 *
 * Devin project rules live as one file per rule under `.devin/rules/*.md`
 * with YAML frontmatter. The `trigger` field accepts exactly the four documented
 * activation modes, but the schema stays loose (and accepts any string) for
 * forward compatibility.
 *
 * Since the Devin Desktop rebrand (Devin v3.0.12, 2026-06-02), `.devin/rules/`
 * is the preferred project rules directory; `.devin/rules/` is a legacy
 * fallback the tool still reads.
 *
 * @see https://docs.devin.ai/desktop/cascade/memories
 */
export const DevinRuleFrontmatterSchema = TriggerRuleFrontmatterSchema;

export type DevinRuleFrontmatter = TriggerRuleFrontmatter;

/**
 * Parameters for creating a DevinRule instance.
 * Requires frontmatter and body separately instead of combined fileContent.
 */
export type DevinRuleParams = Omit<ToolRuleParams, "fileContent"> & {
  frontmatter: DevinRuleFrontmatter;
  body: string;
};

export type DevinRuleSettablePaths = ToolRuleSettablePaths & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

/**
 * Trigger strategies for converting between RulesyncRule and DevinRule, which
 * stores its config under the `devin` key.
 */
const STRATEGIES = createTriggerStrategies("devin");

// ---------------------------------------------

/**
 * Rule generator for Devin (Cascade memories, now Devin Desktop).
 *
 * - Project scope: the root rule goes to the project-root `AGENTS.md` (plain
 *   markdown — the file Devin CLI / Devin Local reads); non-root rules are one
 *   file per rule under `.devin/rules/*.md` (Devin Desktop Cascade) with YAML
 *   frontmatter carrying a `trigger` (always_on | glob | manual | model_decision)
 *   plus companion `globs`/`description` fields.
 * - Global scope: mirrors the project layout. The root rule is a single
 *   plain-markdown, always-on file (no frontmatter) at
 *   `~/.config/devin/AGENTS.md`; non-root rules are one file per rule under
 *   `~/.devin/rules/*.md` with the same `trigger`/`globs` frontmatter as project
 *   scope. Note the directory split — the per-rule global directory is the home
 *   `~/.devin/`, not the `~/.config/devin/` tree every other Devin global
 *   surface uses. That is what the rules page documents.
 *
 * Trigger inference (when no explicit devin trigger is persisted):
 * - Specific globs (non wildcard) → glob
 * - Wildcard/all or no globs → always_on
 *
 * A persisted `devin.trigger` always takes precedence and round-trips.
 *
 * @see https://docs.devin.ai/desktop/cascade/memories
 */
export class DevinRule extends ToolRule {
  private readonly frontmatter: DevinRuleFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: DevinRuleParams) {
    if (rest.validate !== false) {
      const result = DevinRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      // The global AGENTS.md and the project-root AGENTS.md are plain
      // markdown (no frontmatter);
      // project rules carry Devin trigger frontmatter.
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
      relativeDirPath: buildToolPath(DEVIN_GLOBAL_CONFIG_DIR_PATH, ".", excludeToolDir),
      relativeFilePath: DEVIN_GLOBAL_AGENTS_FILE_NAME,
    };
  }

  /**
   * The always-on root rule file for a scope: the project-root `AGENTS.md`
   * Devin CLI / Devin Local reads, or `~/.config/devin/AGENTS.md` in global
   * scope. Single-sourced so `getSettablePaths`, `fromFile` and
   * `fromRulesyncRule` cannot disagree about it.
   */
  private static getRootPath(
    global: boolean,
    excludeToolDir?: boolean,
  ): { relativeDirPath: string; relativeFilePath: string } {
    return global
      ? DevinRule.getGlobalRootPath(excludeToolDir)
      : { relativeDirPath: ".", relativeFilePath: "AGENTS.md" };
  }

  /**
   * The directory holding non-root (triggered) rules in project scope, which
   * `fromFile` and `forDeletion` use to tell them from the root `AGENTS.md`.
   */
  protected static getNonRootDirPath(): string {
    return buildToolPath(DEVIN_DIR, "rules");
  }

  static getSettablePaths({
    global = false,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): DevinRuleSettablePaths | ToolRuleSettablePathsGlobal {
    if (global) {
      return {
        root: DevinRule.getRootPath(true, excludeToolDir),
        // Per-rule global rules live in the home `~/.devin/rules/` directory,
        // NOT under `~/.config/devin/` where every other Devin global surface
        // sits (`AGENTS.md`, `config.json`, `mcp_config.json`, `agents/`,
        // `skills/`). The rules page is explicit about the split: "You can also
        // place them in your home directory (`~/.devin/rules/*.md`,
        // `~/.devin/global_rules.md`) to apply them to every project."
        // @see https://docs.devin.ai/cli/extensibility/rules
        nonRoot: {
          relativeDirPath: buildToolPath(DEVIN_DIR, "rules", excludeToolDir),
        },
      };
    }
    return {
      // Devin CLI / Devin Local reads project rules from the root `AGENTS.md`
      // (its rules page does not list `.devin/rules/` among its sources);
      // `.devin/rules/*.md` remains the Devin Desktop Cascade directory for
      // non-root rules with activation modes.
      // @see https://docs.devin.ai/cli/extensibility/rules
      root: DevinRule.getRootPath(false, excludeToolDir),
      nonRoot: {
        relativeDirPath: buildToolPath(DEVIN_DIR, "rules", excludeToolDir),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<DevinRule> {
    const nonRootDirPath = this.getNonRootDirPath();
    // Dispatch on the directory the processor resolved, not on the file name: a
    // rule file legitimately named `AGENTS.md` inside the rules directory would
    // otherwise be misread as the always-on root file. `relativeDirPath` is
    // optional on the shared params type, so fall back to the file name when a
    // caller omits it.
    const isRootFile =
      relativeDirPath !== undefined
        ? relativeDirPath !== nonRootDirPath
        : relativeFilePath === DevinRule.getRootPath(global).relativeFilePath;

    if (isRootFile) {
      const rootPath = DevinRule.getRootPath(global);
      // Both the project and the global AGENTS.md are plain markdown without
      // Devin frontmatter.
      const fileContent = await readFileContent(
        join(outputRoot, rootPath.relativeDirPath, rootPath.relativeFilePath),
      );
      return new this({
        outputRoot,
        relativeDirPath: rootPath.relativeDirPath,
        relativeFilePath: rootPath.relativeFilePath,
        frontmatter: {},
        body: fileContent,
        validate,
        root: true,
      });
    }

    const filePath = join(outputRoot, nonRootDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);

    let parsedFrontmatter: DevinRuleFrontmatter;
    if (validate) {
      const result = DevinRuleFrontmatterSchema.safeParse(frontmatter);
      if (result.success) {
        parsedFrontmatter = result.data;
      } else {
        throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
      }
    } else {
      parsedFrontmatter = frontmatter as DevinRuleFrontmatter;
    }

    return new this({
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
  }: ToolRuleFromRulesyncRuleParams): DevinRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

    if (rulesyncFrontmatter.root) {
      // The root rule goes to the always-on AGENTS.md Devin reads as plain
      // markdown without Cascade frontmatter — the project root in project
      // scope, `~/.config/devin/AGENTS.md` in global scope.
      const rootPath = DevinRule.getRootPath(global);
      return new this({
        outputRoot,
        relativeDirPath: rootPath.relativeDirPath,
        relativeFilePath: rootPath.relativeFilePath,
        frontmatter: {},
        body: rulesyncRule.getBody(),
        validate,
        root: true,
      });
    }

    const storedDevin = rulesyncFrontmatter.devin;
    const normalized = normalizeStoredTriggerRule(storedDevin);
    const storedTrigger = storedDevin?.trigger;

    const strategy = STRATEGIES.find((s) => s.canHandle(storedTrigger));
    if (!strategy) {
      throw new Error(`No strategy found for trigger: ${storedTrigger}`);
    }

    const frontmatter = strategy.generateFrontmatter(normalized, rulesyncFrontmatter);

    // Non-root rules are placed in the `.devin/rules` directory — the project
    // one in project scope, the home `~/.devin/rules/` one in global scope (the
    // root rule returned above went to the always-on AGENTS.md instead).
    const kebabCaseFilename = toKebabCaseFilename(rulesyncRule.getRelativeFilePath());

    return new this({
      outputRoot,
      relativeDirPath: this.getNonRootDirPath(),
      relativeFilePath: kebabCaseFilename,
      frontmatter,
      body: rulesyncRule.getBody(),
      validate,
      root: false,
    });
  }

  toRulesyncRule(): RulesyncRule {
    if (this.root) {
      // The global and project-root AGENTS.md round-trip as a plain root rule.
      return this.toRulesyncRuleDefault();
    }

    const strategy = STRATEGIES.find((s) => s.canHandle(this.frontmatter.trigger));

    let rulesyncData: {
      globs: string[];
      description?: string;
      devin: Record<string, unknown>;
    } = {
      globs: [],
      devin: this.frontmatter,
    };

    if (strategy) {
      rulesyncData = strategy.exportRulesyncData(this.frontmatter);
    }

    // Convert devin.globs from string to array for the RulesyncRule schema.
    const devinForRulesync = {
      ...rulesyncData.devin,
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
        devin: devinForRulesync,
      },
      body: this.body,
    });
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): DevinRuleFrontmatter {
    return this.frontmatter;
  }

  validate(): ValidationResult {
    const result = DevinRuleFrontmatterSchema.safeParse(this.frontmatter);
    if (!result.success) {
      return { success: false, error: new Error(formatError(result.error)) };
    }
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): DevinRule {
    return new this({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
      // Derived from the directory rather than the scope: since global scope
      // gained `~/.devin/rules/`, `global` no longer implies the root file.
      root: relativeDirPath !== this.getNonRootDirPath(),
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "devin",
    });
  }
}

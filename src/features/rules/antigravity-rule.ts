import { join } from "node:path";

import { z } from "zod/mini";

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
  buildToolPath,
} from "./tool-rule.js";

export const AntigravityRuleFrontmatterSchema = z.looseObject({
  trigger: z.optional(
    z.union([
      z.literal("always_on"),
      z.literal("glob"),
      z.literal("manual"),
      z.literal("model_decision"),
      z.string(), // accepts any string for forward compatibility
    ]),
  ),
  globs: z.optional(z.string()),
  description: z.optional(z.string()),
});

export type AntigravityRuleFrontmatter = z.infer<typeof AntigravityRuleFrontmatterSchema>;

/**
 * Parameters for creating an AntigravityRule instance.
 * Requires frontmatter and body separately instead of combined fileContent.
 */
export type AntigravityRuleParams = Omit<ToolRuleParams, "fileContent"> & {
  frontmatter: AntigravityRuleFrontmatter;
  body: string;
};

export type AntigravityRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  nonRoot: {
    relativeDirPath: string;
  };
};

/**
 * Rule generator for Google Antigravity IDE
 *
 * Generates rule files for Antigravity's .agent/rules/ directory.
 * All rules (both root and non-root from RulesyncRule) are placed in .agent/rules.
 *
 * Filename requirements:
 * - Filenames must be lowercase, numbers, and hyphens only
 * - Automatically converts filenames to kebab-case during generation
 *   (e.g., "CodingGuidelines.md" → "coding-guidelines.md")
 *
 * Supports frontmatter configuration with different trigger types:
 * - always_on: Rule always applies (default)
 * - glob: Rule applies to files matching glob patterns
 * - manual: Rule must be manually activated
 * - model_decision: Model decides when to apply based on description
 */

// --- Helper Functions for Globs Conversion ---

/**
 * Converts a comma-separated globs string or array to an array of globs.
 * @param globs - Comma-separated globs string (e.g., "*.ts,*.js") or array of globs
 * @returns Array of glob patterns
 */
function parseGlobsString(globs: string | string[] | undefined): string[] {
  if (!globs) {
    return [];
  }
  if (Array.isArray(globs)) {
    return globs;
  }
  if (globs.trim() === "") {
    return [];
  }
  return globs.split(",").map((g) => g.trim());
}

/**
 * Converts an array of globs to a comma-separated string.
 * @param globs - Array of glob patterns
 * @returns Comma-separated globs string, or undefined if empty
 */
function stringifyGlobs(globs: string[] | undefined): string | undefined {
  if (!globs || globs.length === 0) {
    return undefined;
  }
  return globs.join(",");
}

/**
 * Normalizes StoredAntigravity to AntigravityRuleFrontmatter format.
 * Converts globs from array to string if needed.
 * @param stored - StoredAntigravity that may have globs as array
 * @returns Normalized AntigravityRuleFrontmatter with globs as string
 */
function normalizeStoredAntigravity(
  stored: StoredAntigravity,
): AntigravityRuleFrontmatter | undefined {
  if (!stored) {
    return undefined;
  }
  const { globs, ...rest } = stored;
  return {
    ...rest,
    globs: Array.isArray(globs) ? stringifyGlobs(globs) : globs,
  };
}

// --- Strategy Pattern for Frontmatter Conversion ---

/**
 * Represents Antigravity configuration stored in RulesyncRule frontmatter.
 * May be undefined if no Antigravity-specific config was previously stored.
 * Note: globs may be stored as array in RulesyncRule but should be string in AntigravityRule.
 */
type StoredAntigravity =
  | (Omit<AntigravityRuleFrontmatter, "globs"> & { globs?: string | string[] })
  | undefined;

/**
 * Strategy interface for handling different trigger types during conversion
 * between RulesyncRule and AntigravityRule.
 *
 * Each strategy handles:
 * 1. Recognizing when it should be used (canHandle)
 * 2. Generating Antigravity frontmatter from Rulesync data (generateFrontmatter)
 * 3. Exporting Antigravity data back to Rulesync format (exportRulesyncData)
 */
type TriggerStrategy = {
  canHandle(trigger: string | undefined): boolean;
  generateFrontmatter(
    normalized: AntigravityRuleFrontmatter | undefined,
    rulesyncFrontmatter: { description?: string; globs?: string[] },
  ): AntigravityRuleFrontmatter;
  exportRulesyncData(frontmatter: AntigravityRuleFrontmatter): {
    globs: string[];
    description: string;
    antigravity: Record<string, unknown>;
  };
};

const globStrategy: TriggerStrategy = {
  canHandle: (trigger) => trigger === "glob",
  generateFrontmatter: (normalized, rulesyncFrontmatter) => {
    const effectiveGlobsArray = normalized?.globs
      ? parseGlobsString(normalized.globs)
      : (rulesyncFrontmatter.globs ?? []);
    return {
      ...normalized,
      trigger: "glob",
      globs: stringifyGlobs(effectiveGlobsArray),
    };
  },
  exportRulesyncData: ({ description, ...frontmatter }) => ({
    globs: parseGlobsString(frontmatter.globs),
    description: description || "",
    antigravity: frontmatter,
  }),
};

const manualStrategy: TriggerStrategy = {
  canHandle: (trigger) => trigger === "manual",
  generateFrontmatter: (normalized) => ({
    ...normalized,
    trigger: "manual",
  }),
  exportRulesyncData: ({ description, ...frontmatter }) => ({
    globs: [],
    description: description || "",
    antigravity: frontmatter,
  }),
};

const alwaysOnStrategy: TriggerStrategy = {
  canHandle: (trigger) => trigger === "always_on",
  generateFrontmatter: (normalized) => ({
    ...normalized,
    trigger: "always_on",
  }),
  exportRulesyncData: ({ description, ...frontmatter }) => ({
    globs: ["**/*"],
    description: description || "",
    antigravity: frontmatter,
  }),
};

const modelDecisionStrategy: TriggerStrategy = {
  canHandle: (trigger) => trigger === "model_decision",
  generateFrontmatter: (normalized, rulesyncFrontmatter) => ({
    ...normalized,
    trigger: "model_decision",
    description: rulesyncFrontmatter.description,
  }),
  exportRulesyncData: ({ description, ...frontmatter }) => ({
    globs: [],
    description: description || "",
    antigravity: frontmatter,
  }),
};

/**
 * Handles unknown/custom triggers by passing them through (relaxed schema).
 * This strategy matches ANY defined trigger that isn't handled by specific strategies.
 * IMPORTANT: Must come after specific strategies in the STRATEGIES array.
 */
const unknownStrategy: TriggerStrategy = {
  canHandle: (trigger) => trigger !== undefined,
  generateFrontmatter: (normalized) => {
    const trigger = typeof normalized?.trigger === "string" ? normalized.trigger : "manual";
    return {
      ...normalized,
      trigger,
    };
  },
  exportRulesyncData: ({ description, ...frontmatter }) => ({
    globs: frontmatter.globs ? parseGlobsString(frontmatter.globs) : ["**/*"],
    description: description || "",
    antigravity: frontmatter,
  }),
};

/**
 * Fallback strategy when no specific trigger is stored in Antigravity config.
 * Infers the appropriate trigger based on glob patterns:
 * - Specific globs (not wildcards) → glob trigger
 * - No globs or wildcard globs → always_on trigger
 * IMPORTANT: Must be last in the STRATEGIES array as it handles undefined triggers.
 */
const inferenceStrategy: TriggerStrategy = {
  canHandle: (trigger) => trigger === undefined,
  generateFrontmatter: (normalized, rulesyncFrontmatter) => {
    const effectiveGlobsArray = normalized?.globs
      ? parseGlobsString(normalized.globs)
      : (rulesyncFrontmatter.globs ?? []);
    if (
      effectiveGlobsArray.length > 0 &&
      !effectiveGlobsArray.includes("**/*") &&
      !effectiveGlobsArray.includes("*")
    ) {
      return {
        ...normalized,
        trigger: "glob",
        globs: stringifyGlobs(effectiveGlobsArray),
      };
    }
    return {
      ...normalized,
      trigger: "always_on",
    };
  },
  exportRulesyncData: ({ description, ...frontmatter }) => ({
    globs: frontmatter.globs ? parseGlobsString(frontmatter.globs) : ["**/*"],
    description: description || "",
    antigravity: frontmatter,
  }),
};

/**
 * Array of trigger strategies in priority order.
 * CRITICAL: Order matters! Strategies are checked sequentially with Array.find():
 * 1. Specific trigger strategies (glob, manual, always_on, model_decision)
 * 2. unknownStrategy - matches ANY defined trigger (must come before inference)
 * 3. inferenceStrategy - matches undefined triggers (must be last)
 *
 * DO NOT reorder without understanding the matching logic.
 */
const STRATEGIES: TriggerStrategy[] = [
  globStrategy,
  manualStrategy,
  alwaysOnStrategy,
  modelDecisionStrategy,
  unknownStrategy,
  inferenceStrategy,
];

// ---------------------------------------------

export class AntigravityRule extends ToolRule {
  private readonly frontmatter: AntigravityRuleFrontmatter;
  private readonly body: string;

  /**
   * Creates an AntigravityRule instance.
   *
   * @param params - Rule parameters including frontmatter and body
   * @param params.frontmatter - Antigravity-specific frontmatter configuration
   * @param params.body - The markdown body content (without frontmatter)
   *
   * Note: Files without frontmatter will default to always_on trigger during fromFile().
   */
  constructor({ frontmatter, body, ...rest }: AntigravityRuleParams) {
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
      // Ensure fileContent includes frontmatter when constructed directly
      fileContent: stringifyFrontmatter(body, frontmatter),
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): AntigravityRuleSettablePaths {
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(".agent", "rules", _options.excludeToolDir),
      },
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<AntigravityRule> {
    const filePath = join(
      baseDir,
      this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath,
    );
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
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      parsedFrontmatter = frontmatter as AntigravityRuleFrontmatter;
    }

    return new AntigravityRule({
      baseDir,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: relativeFilePath,
      body,
      frontmatter: parsedFrontmatter,
      validate,
      root: false,
    });
  }

  /**
   * Converts a RulesyncRule to an AntigravityRule.
   *
   * Trigger inference:
   * - If antigravity.trigger is set, it's preserved
   * - If specific globs are set, infers "glob" trigger
   * - Otherwise, infers "always_on" trigger
   */
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): AntigravityRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

    // Normalize once before dispatching to strategy
    const storedAntigravity = rulesyncFrontmatter.antigravity;
    const normalized = normalizeStoredAntigravity(storedAntigravity);
    const storedTrigger = storedAntigravity?.trigger;

    const strategy = STRATEGIES.find((s) => s.canHandle(storedTrigger));

    if (!strategy) {
      // Should not happen with current strategies, but fallback safely
      throw new Error(`No strategy found for trigger: ${storedTrigger}`);
    }

    const frontmatter = strategy.generateFrontmatter(normalized, rulesyncFrontmatter);

    // Both root and non-root rules are placed in .agent/rules directory
    const paths = this.getSettablePaths();

    const kebabCaseFilename = toKebabCaseFilename(rulesyncRule.getRelativeFilePath());

    return new AntigravityRule({
      baseDir,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath: kebabCaseFilename,
      frontmatter,
      body: rulesyncRule.getBody(),
      validate,
      root: false,
    });
  }

  /**
   * Converts this AntigravityRule to a RulesyncRule.
   *
   * The Antigravity configuration is preserved in the RulesyncRule's
   * frontmatter.antigravity field for round-trip compatibility.
   *
   * Note: All Antigravity rules are treated as non-root (root: false),
   * as they are all placed in the .agent/rules directory.
   *
   * @returns RulesyncRule instance with Antigravity config preserved
   */
  toRulesyncRule(): RulesyncRule {
    // Determine appropriate strategy based on current trigger
    const strategy = STRATEGIES.find((s) => s.canHandle(this.frontmatter.trigger));

    // If no strategy found (e.g. unknown trigger and Inference handles undefined), use Unknown behavior?
    // Strategies with canHandle(trigger) usually cover all valid cases.
    // If trigger is custom string, UnknownStrategy handles it.
    // If trigger is undefined, InferenceStrategy handles it.
    // So we should find one. If not, fallback to empty array?
    let rulesyncData: {
      globs: string[];
      description: string;
      antigravity: Record<string, unknown>;
    } = {
      globs: [],
      description: "",
      antigravity: this.frontmatter,
    };

    if (strategy) {
      rulesyncData = strategy.exportRulesyncData(this.frontmatter);
    }

    // Convert antigravity.globs from string to array for RulesyncRule schema
    const antigravityForRulesync = {
      ...rulesyncData.antigravity,
      globs: this.frontmatter.globs ? parseGlobsString(this.frontmatter.globs) : undefined,
    };

    return new RulesyncRule({
      baseDir: process.cwd(),
      relativeDirPath: RulesyncRule.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: {
        root: false,
        targets: ["*"],
        ...rulesyncData,
        antigravity: antigravityForRulesync,
      },
      // When converting back, we only want the body content
      body: this.body,
    });
  }

  getBody(): string {
    return this.body;
  }

  // Helper to access raw file content including frontmatter is `this.fileContent` (from ToolFile)
  // But we might want `body` only for some operations?
  // ToolFile.getFileContent() returns the whole string.

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
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): AntigravityRule {
    return new AntigravityRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
      root: false,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "antigravity",
    });
  }
}

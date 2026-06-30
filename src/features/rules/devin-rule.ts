import { join } from "node:path";

import { z } from "zod/mini";

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
export const DevinRuleFrontmatterSchema = z.looseObject({
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

export type DevinRuleFrontmatter = z.infer<typeof DevinRuleFrontmatterSchema>;

/**
 * Parameters for creating a DevinRule instance.
 * Requires frontmatter and body separately instead of combined fileContent.
 */
export type DevinRuleParams = Omit<ToolRuleParams, "fileContent"> & {
  frontmatter: DevinRuleFrontmatter;
  body: string;
};

export type DevinRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  nonRoot: {
    relativeDirPath: string;
  };
};

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
 * Devin configuration as it may be stored in the RulesyncRule `devin`
 * frontmatter block. `globs` may be stored as an array there but is normalized
 * to a comma-separated string for the Devin rule file.
 */
type StoredDevin =
  | (Omit<DevinRuleFrontmatter, "globs"> & { globs?: string | string[] })
  | undefined;

/**
 * Normalizes a StoredDevin value to DevinRuleFrontmatter format by
 * converting globs from array to string if needed.
 */
function normalizeStoredDevin(stored: StoredDevin): DevinRuleFrontmatter | undefined {
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
 * Strategy interface for handling different trigger types during conversion
 * between RulesyncRule and DevinRule.
 */
type TriggerStrategy = {
  canHandle(trigger: string | undefined): boolean;
  generateFrontmatter(
    normalized: DevinRuleFrontmatter | undefined,
    rulesyncFrontmatter: { description?: string; globs?: string[] },
  ): DevinRuleFrontmatter;
  exportRulesyncData(frontmatter: DevinRuleFrontmatter): {
    globs: string[];
    description?: string;
    devin: Record<string, unknown>;
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
    description,
    devin: frontmatter,
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
    description,
    devin: frontmatter,
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
    description,
    devin: frontmatter,
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
    description,
    devin: frontmatter,
  }),
};

/**
 * Handles unknown/custom triggers by passing them through (relaxed schema).
 * This strategy matches ANY defined trigger that isn't handled by specific
 * strategies. It MUST come after the specific strategies in the STRATEGIES array.
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
    description,
    devin: frontmatter,
  }),
};

/**
 * Fallback strategy when no specific trigger is stored in Devin config.
 * Infers the appropriate trigger based on glob patterns:
 * - Specific globs (not wildcards) → glob trigger
 * - No globs or wildcard globs → always_on trigger
 * It MUST be last in the STRATEGIES array as it handles undefined triggers.
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
    description,
    devin: frontmatter,
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

/**
 * Rule generator for Devin (Cascade memories, now Devin Desktop).
 *
 * - Project scope: one file per rule under `.devin/rules/*.md` with YAML
 *   frontmatter carrying a `trigger` (always_on | glob | manual | model_decision)
 *   plus companion `globs`/`description` fields. (`.devin/rules/` is the
 *   pre-rebrand legacy location the tool still reads.)
 * - Global scope: a single plain-markdown, always-on file (no frontmatter) at
 *   `~/.config/devin/AGENTS.md` (Devin Local global always-on rules).
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
      // Global rules are a single plain-markdown file (no frontmatter);
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

  static getSettablePaths({
    global = false,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): DevinRuleSettablePaths | ToolRuleSettablePathsGlobal {
    if (global) {
      return {
        root: DevinRule.getGlobalRootPath(excludeToolDir),
      };
    }
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(DEVIN_DIR, "rules", excludeToolDir),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<DevinRule> {
    if (global) {
      const rootPath = DevinRule.getGlobalRootPath();
      const fileContent = await readFileContent(
        join(outputRoot, rootPath.relativeDirPath, rootPath.relativeFilePath),
      );
      // The global AGENTS.md is plain markdown without Devin frontmatter.
      return new DevinRule({
        outputRoot,
        relativeDirPath: rootPath.relativeDirPath,
        relativeFilePath: rootPath.relativeFilePath,
        frontmatter: {},
        body: fileContent,
        validate,
        root: true,
      });
    }

    const nonRootDirPath = buildToolPath(DEVIN_DIR, "rules");
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

    return new DevinRule({
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
    if (global) {
      // Global scope is a single plain ~/.config/devin/AGENTS.md root file.
      const rootPath = DevinRule.getGlobalRootPath();
      return new DevinRule({
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

    const storedDevin = rulesyncFrontmatter.devin;
    const normalized = normalizeStoredDevin(storedDevin);
    const storedTrigger = storedDevin?.trigger;

    const strategy = STRATEGIES.find((s) => s.canHandle(storedTrigger));
    if (!strategy) {
      throw new Error(`No strategy found for trigger: ${storedTrigger}`);
    }

    const frontmatter = strategy.generateFrontmatter(normalized, rulesyncFrontmatter);

    // Both root and non-root rules are placed in the .devin/rules directory.
    const kebabCaseFilename = toKebabCaseFilename(rulesyncRule.getRelativeFilePath());

    return new DevinRule({
      outputRoot,
      relativeDirPath: buildToolPath(DEVIN_DIR, "rules"),
      relativeFilePath: kebabCaseFilename,
      frontmatter,
      body: rulesyncRule.getBody(),
      validate,
      root: false,
    });
  }

  toRulesyncRule(): RulesyncRule {
    if (this.root) {
      // The global AGENTS.md round-trips as a plain root rule.
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
    global = false,
  }: ToolRuleForDeletionParams): DevinRule {
    return new DevinRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
      root: global,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "devin",
    });
  }
}

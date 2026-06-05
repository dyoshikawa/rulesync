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
  ToolRuleSettablePathsGlobal,
  buildToolPath,
} from "./tool-rule.js";

/**
 * Frontmatter schema for Windsurf project rules.
 *
 * Windsurf project rules live as one file per rule under `.windsurf/rules/*.md`
 * with YAML frontmatter. The `trigger` field accepts exactly the four documented
 * activation modes, but the schema stays loose (and accepts any string) for
 * forward compatibility.
 *
 * @see https://docs.windsurf.com/windsurf/cascade/memories#rules
 */
export const WindsurfRuleFrontmatterSchema = z.looseObject({
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

export type WindsurfRuleFrontmatter = z.infer<typeof WindsurfRuleFrontmatterSchema>;

/**
 * Parameters for creating a WindsurfRule instance.
 * Requires frontmatter and body separately instead of combined fileContent.
 */
export type WindsurfRuleParams = Omit<ToolRuleParams, "fileContent"> & {
  frontmatter: WindsurfRuleFrontmatter;
  body: string;
};

export type WindsurfRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
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
export function parseGlobsString(globs: string | string[] | undefined): string[] {
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
 * Windsurf configuration as it may be stored in the RulesyncRule `windsurf`
 * frontmatter block. `globs` may be stored as an array there but is normalized
 * to a comma-separated string for the Windsurf rule file.
 */
export type StoredWindsurf =
  | (Omit<WindsurfRuleFrontmatter, "globs"> & { globs?: string | string[] })
  | undefined;

/**
 * Normalizes a StoredWindsurf value to WindsurfRuleFrontmatter format by
 * converting globs from array to string if needed.
 */
export function normalizeStoredWindsurf(
  stored: StoredWindsurf,
): WindsurfRuleFrontmatter | undefined {
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
 * between RulesyncRule and WindsurfRule.
 */
type TriggerStrategy = {
  canHandle(trigger: string | undefined): boolean;
  generateFrontmatter(
    normalized: WindsurfRuleFrontmatter | undefined,
    rulesyncFrontmatter: { description?: string; globs?: string[] },
  ): WindsurfRuleFrontmatter;
  exportRulesyncData(frontmatter: WindsurfRuleFrontmatter): {
    globs: string[];
    description?: string;
    windsurf: Record<string, unknown>;
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
    windsurf: frontmatter,
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
    windsurf: frontmatter,
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
    windsurf: frontmatter,
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
    windsurf: frontmatter,
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
    windsurf: frontmatter,
  }),
};

/**
 * Fallback strategy when no specific trigger is stored in Windsurf config.
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
    windsurf: frontmatter,
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
export const STRATEGIES: TriggerStrategy[] = [
  globStrategy,
  manualStrategy,
  alwaysOnStrategy,
  modelDecisionStrategy,
  unknownStrategy,
  inferenceStrategy,
];

// ---------------------------------------------

/**
 * Rule generator for Windsurf (Cascade memories).
 *
 * - Project scope: one file per rule under `.windsurf/rules/*.md` with YAML
 *   frontmatter carrying a `trigger` (always_on | glob | manual | model_decision)
 *   plus companion `globs`/`description` fields.
 * - Global scope: a single plain-markdown, always-on file (no frontmatter) at
 *   `~/.codeium/windsurf/memories/global_rules.md`.
 *
 * Trigger inference (when no explicit windsurf trigger is persisted):
 * - Specific globs (non wildcard) → glob
 * - Wildcard/all or no globs → always_on
 *
 * A persisted `windsurf.trigger` always takes precedence and round-trips.
 *
 * @see https://docs.windsurf.com/windsurf/cascade/memories#rules
 */
export class WindsurfRule extends ToolRule {
  private readonly frontmatter: WindsurfRuleFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: WindsurfRuleParams) {
    if (rest.validate !== false) {
      const result = WindsurfRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      // Global rules are a single plain-markdown file (no frontmatter);
      // project rules carry Windsurf trigger frontmatter.
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
      relativeDirPath: buildToolPath(".codeium", join("windsurf", "memories"), excludeToolDir),
      relativeFilePath: "global_rules.md",
    };
  }

  static getSettablePaths({
    global = false,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): WindsurfRuleSettablePaths | ToolRuleSettablePathsGlobal {
    if (global) {
      return {
        root: WindsurfRule.getGlobalRootPath(excludeToolDir),
      };
    }
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(".windsurf", "rules", excludeToolDir),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<WindsurfRule> {
    if (global) {
      const rootPath = WindsurfRule.getGlobalRootPath();
      const fileContent = await readFileContent(
        join(outputRoot, rootPath.relativeDirPath, rootPath.relativeFilePath),
      );
      // global_rules.md is plain markdown without Windsurf frontmatter.
      return new WindsurfRule({
        outputRoot,
        relativeDirPath: rootPath.relativeDirPath,
        relativeFilePath: rootPath.relativeFilePath,
        frontmatter: {},
        body: fileContent,
        validate,
        root: true,
      });
    }

    const nonRootDirPath = buildToolPath(".windsurf", "rules");
    const filePath = join(outputRoot, nonRootDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);

    let parsedFrontmatter: WindsurfRuleFrontmatter;
    if (validate) {
      const result = WindsurfRuleFrontmatterSchema.safeParse(frontmatter);
      if (result.success) {
        parsedFrontmatter = result.data;
      } else {
        throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
      }
    } else {
      parsedFrontmatter = frontmatter as WindsurfRuleFrontmatter;
    }

    return new WindsurfRule({
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
  }: ToolRuleFromRulesyncRuleParams): WindsurfRule {
    if (global) {
      // Global scope is a single plain global_rules.md root file.
      const rootPath = WindsurfRule.getGlobalRootPath();
      return new WindsurfRule({
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

    const storedWindsurf = rulesyncFrontmatter.windsurf;
    const normalized = normalizeStoredWindsurf(storedWindsurf);
    const storedTrigger = storedWindsurf?.trigger;

    const strategy = STRATEGIES.find((s) => s.canHandle(storedTrigger));
    if (!strategy) {
      throw new Error(`No strategy found for trigger: ${storedTrigger}`);
    }

    const frontmatter = strategy.generateFrontmatter(normalized, rulesyncFrontmatter);

    // Both root and non-root rules are placed in the .windsurf/rules directory.
    const kebabCaseFilename = toKebabCaseFilename(rulesyncRule.getRelativeFilePath());

    return new WindsurfRule({
      outputRoot,
      relativeDirPath: buildToolPath(".windsurf", "rules"),
      relativeFilePath: kebabCaseFilename,
      frontmatter,
      body: rulesyncRule.getBody(),
      validate,
      root: false,
    });
  }

  toRulesyncRule(): RulesyncRule {
    if (this.root) {
      // Global global_rules.md round-trips as a plain root rule.
      return this.toRulesyncRuleDefault();
    }

    const strategy = STRATEGIES.find((s) => s.canHandle(this.frontmatter.trigger));

    let rulesyncData: {
      globs: string[];
      description?: string;
      windsurf: Record<string, unknown>;
    } = {
      globs: [],
      windsurf: this.frontmatter,
    };

    if (strategy) {
      rulesyncData = strategy.exportRulesyncData(this.frontmatter);
    }

    // Convert windsurf.globs from string to array for the RulesyncRule schema.
    const windsurfForRulesync = {
      ...rulesyncData.windsurf,
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
        windsurf: windsurfForRulesync,
      },
      body: this.body,
    });
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): WindsurfRuleFrontmatter {
    return this.frontmatter;
  }

  validate(): ValidationResult {
    const result = WindsurfRuleFrontmatterSchema.safeParse(this.frontmatter);
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
  }: ToolRuleForDeletionParams): WindsurfRule {
    return new WindsurfRule({
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
      toolTarget: "windsurf",
    });
  }
}

import { z } from "zod/mini";

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
 * Normalizes StoredAntigravity to AntigravityRuleFrontmatter format.
 * Converts globs from array to string if needed.
 * @param stored - StoredAntigravity that may have globs as array
 * @returns Normalized AntigravityRuleFrontmatter with globs as string
 */
export function normalizeStoredAntigravity(
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
export type StoredAntigravity =
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
    description?: string;
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
    description,
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
    description,
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
    description,
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
    description,
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
    description,
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
    description,
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
export const STRATEGIES: TriggerStrategy[] = [
  globStrategy,
  manualStrategy,
  alwaysOnStrategy,
  modelDecisionStrategy,
  unknownStrategy,
  inferenceStrategy,
];

import { z } from "zod/mini";

/**
 * Frontmatter schema shared by the rule formats that activate a rule through a
 * `trigger` field (Antigravity and Devin). The `trigger` field accepts exactly
 * the four documented activation modes, but the schema stays loose (and accepts
 * any string) for forward compatibility.
 */
export const TriggerRuleFrontmatterSchema = z.looseObject({
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

export type TriggerRuleFrontmatter = z.infer<typeof TriggerRuleFrontmatterSchema>;

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
export function stringifyGlobs(globs: string[] | undefined): string | undefined {
  if (!globs || globs.length === 0) {
    return undefined;
  }
  return globs.join(",");
}

/**
 * The tool configuration as it may be stored in the RulesyncRule frontmatter
 * block of a trigger-based tool (`antigravity`, `devin`). May be undefined if no
 * tool-specific config was previously stored. `globs` may be stored as an array
 * there but is normalized to a comma-separated string for the tool's rule file.
 */
export type StoredTriggerRule =
  | (Omit<TriggerRuleFrontmatter, "globs"> & { globs?: string | string[] })
  | undefined;

/**
 * Normalizes a StoredTriggerRule value to TriggerRuleFrontmatter format by
 * converting globs from array to string if needed.
 */
export function normalizeStoredTriggerRule(
  stored: StoredTriggerRule,
): TriggerRuleFrontmatter | undefined {
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
 * What a strategy exports back to the RulesyncRule frontmatter: the globs, the
 * description and the tool's own frontmatter under the tool's key.
 */
export type TriggerRuleRulesyncData<K extends string> = {
  globs: string[];
  description?: string;
} & Record<K, Record<string, unknown>>;

/**
 * Strategy interface for handling different trigger types during conversion
 * between RulesyncRule and a trigger-based tool rule.
 *
 * Each strategy handles:
 * 1. Recognizing when it should be used (canHandle)
 * 2. Generating the tool frontmatter from Rulesync data (generateFrontmatter)
 * 3. Exporting the tool data back to Rulesync format (exportRulesyncData)
 */
export type TriggerStrategy<K extends string> = {
  canHandle(trigger: string | undefined): boolean;
  generateFrontmatter(
    normalized: TriggerRuleFrontmatter | undefined,
    rulesyncFrontmatter: { description?: string; globs?: string[] },
  ): TriggerRuleFrontmatter;
  exportRulesyncData(frontmatter: TriggerRuleFrontmatter): TriggerRuleRulesyncData<K>;
};

/**
 * Build the trigger strategies of a tool whose rulesync frontmatter block is
 * named `key`, in priority order.
 * CRITICAL: Order matters! Strategies are checked sequentially with Array.find():
 * 1. Specific trigger strategies (glob, manual, always_on, model_decision)
 * 2. unknownStrategy - matches ANY defined trigger (must come before inference)
 * 3. inferenceStrategy - matches undefined triggers (must be last)
 *
 * DO NOT reorder without understanding the matching logic.
 */
export function createTriggerStrategies<K extends string>(key: K): TriggerStrategy<K>[] {
  const toRulesyncData = ({
    globs,
    description,
    frontmatter,
  }: {
    globs: string[];
    description: string | undefined;
    frontmatter: Record<string, unknown>;
  }): TriggerRuleRulesyncData<K> =>
    ({ globs, description, [key]: frontmatter }) as TriggerRuleRulesyncData<K>;

  const globStrategy: TriggerStrategy<K> = {
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
    exportRulesyncData: ({ description, ...frontmatter }) =>
      toRulesyncData({ globs: parseGlobsString(frontmatter.globs), description, frontmatter }),
  };

  const manualStrategy: TriggerStrategy<K> = {
    canHandle: (trigger) => trigger === "manual",
    generateFrontmatter: (normalized) => ({
      ...normalized,
      trigger: "manual",
    }),
    exportRulesyncData: ({ description, ...frontmatter }) =>
      toRulesyncData({ globs: [], description, frontmatter }),
  };

  const alwaysOnStrategy: TriggerStrategy<K> = {
    canHandle: (trigger) => trigger === "always_on",
    generateFrontmatter: (normalized) => ({
      ...normalized,
      trigger: "always_on",
    }),
    exportRulesyncData: ({ description, ...frontmatter }) =>
      toRulesyncData({ globs: ["**/*"], description, frontmatter }),
  };

  const modelDecisionStrategy: TriggerStrategy<K> = {
    canHandle: (trigger) => trigger === "model_decision",
    generateFrontmatter: (normalized, rulesyncFrontmatter) => ({
      ...normalized,
      trigger: "model_decision",
      description: rulesyncFrontmatter.description,
    }),
    exportRulesyncData: ({ description, ...frontmatter }) =>
      toRulesyncData({ globs: [], description, frontmatter }),
  };

  /**
   * Handles unknown/custom triggers by passing them through (relaxed schema).
   * This strategy matches ANY defined trigger that isn't handled by specific strategies.
   * IMPORTANT: Must come after specific strategies in the returned array.
   */
  const unknownStrategy: TriggerStrategy<K> = {
    canHandle: (trigger) => trigger !== undefined,
    generateFrontmatter: (normalized) => {
      const trigger = typeof normalized?.trigger === "string" ? normalized.trigger : "manual";
      return {
        ...normalized,
        trigger,
      };
    },
    exportRulesyncData: ({ description, ...frontmatter }) =>
      toRulesyncData({
        globs: frontmatter.globs ? parseGlobsString(frontmatter.globs) : ["**/*"],
        description,
        frontmatter,
      }),
  };

  /**
   * Fallback strategy when no specific trigger is stored in the tool config.
   * Infers the appropriate trigger based on glob patterns:
   * - Specific globs (not wildcards) → glob trigger
   * - No globs or wildcard globs → always_on trigger
   * IMPORTANT: Must be last in the returned array as it handles undefined triggers.
   */
  const inferenceStrategy: TriggerStrategy<K> = {
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
    exportRulesyncData: ({ description, ...frontmatter }) =>
      toRulesyncData({
        globs: frontmatter.globs ? parseGlobsString(frontmatter.globs) : ["**/*"],
        description,
        frontmatter,
      }),
  };

  return [
    globStrategy,
    manualStrategy,
    alwaysOnStrategy,
    modelDecisionStrategy,
    unknownStrategy,
    inferenceStrategy,
  ];
}

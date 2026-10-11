import { join } from "node:path";

import { z } from "zod/mini";

import { ANTIGRAVITY_IDE_AGENTS_DIR } from "../../constants/antigravity-ide-paths.js";
import { toPosixPath } from "../../utils/file.js";
import {
  NESTED_SCAN_EXCLUDED_DIRS_ANY_DEPTH,
  NESTED_SCAN_EXCLUDED_ROOT_DIRS,
} from "./nested-scan-exclusions.js";
import type { RulesyncRule } from "./rulesync-rule.js";
import type { ToolRuleNestedFilePatterns } from "./tool-rule.js";

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
 * File name of a non-root rule in the shared global `~/.gemini/config/rules/`
 * directory. Antigravity reads only its top level, so a nested rulesync rule
 * (`frontend/style.md`) is flattened into a single file name
 * (`frontend-style.md`). The IDE and the CLI both use it so they write the
 * same file for the same rule.
 */
export function toGlobalRuleFileName(relativeFilePath: string): string {
  return relativeFilePath.split(/[\\/]/).join("-");
}

// --- Directory-scoped (nested) project rules ---

/** The project rules directory both Antigravity targets share, as a POSIX path. */
const PROJECT_RULES_DIR = `${ANTIGRAVITY_IDE_AGENTS_DIR}/rules`;

/**
 * The subproject directory a rule is scoped to, or `undefined` when it goes to
 * the project-root `.agents/rules/`. Antigravity reads a `.agents/rules/`
 * directory in any subdirectory and loads it for files under that directory,
 * so a non-root rule carrying `agentsmd.subprojectPath` is written there. Project
 * scope only: there is no workspace tree to nest under in global scope.
 *
 * @see https://antigravity.google/docs/rules
 */
export function resolveAntigravitySubprojectPath({
  rulesyncRule,
  global,
}: {
  rulesyncRule: RulesyncRule;
  global: boolean;
}): string | undefined {
  const { root, agentsmd } = rulesyncRule.getFrontmatter();
  const subprojectPath = !global && root !== true ? agentsmd?.subprojectPath : undefined;
  // `""` and `.` name the project root, which is not a subproject.
  return subprojectPath && !["", ".", "./"].includes(subprojectPath) ? subprojectPath : undefined;
}

/**
 * File name of a rule in a subproject's `.agents/rules/`. Antigravity reads
 * only the direct children of a rules directory, so a nested rulesync rule
 * (`frontend/style.md`) is flattened (`frontend-style.md`), and the name keeps
 * its case so the IDE and the CLI write the same file and an imported
 * `codeStyle.md` is written back to the same place.
 */
export function toNestedRuleFileName(relativeFilePath: string): string {
  return toGlobalRuleFileName(relativeFilePath);
}

/** The `.agents/rules/` directory of a subproject. */
export function toAntigravityNestedRulesDirPath(subprojectPath: string): string {
  return join(subprojectPath, ANTIGRAVITY_IDE_AGENTS_DIR, "rules");
}

/**
 * Split a nested rule directory such as `packages/api/.agents/rules/sub` into
 * the subproject (`packages/api`) and the folder inside its rules directory
 * (`sub`). Returns `undefined` for the project-root `.agents/rules/`, for a
 * path with no `.agents/rules` segment, and for one under a hidden directory —
 * another tool's output or a worktree, not a subproject.
 */
export function extractAntigravitySubprojectPath(
  relativeDirPath: string,
): { subprojectPath: string; innerDirPath: string } | undefined {
  const segments = toPosixPath(relativeDirPath).split("/");
  const index = segments.findIndex(
    (segment, i) => segment === ANTIGRAVITY_IDE_AGENTS_DIR && segments[i + 1] === "rules",
  );
  if (index <= 0) {
    return undefined;
  }
  const subprojectSegments = segments.slice(0, index);
  if (subprojectSegments.some((segment) => segment === "" || segment.startsWith("."))) {
    return undefined;
  }
  return {
    subprojectPath: subprojectSegments.join("/"),
    innerDirPath: segments.slice(index + 2).join("/"),
  };
}

/**
 * The `.agents/rules/` folders of project subdirectories. Only their direct
 * `.md` children are read, because Antigravity ignores files nested in
 * subfolders of a rules directory. The shared nested
 * scan ignores every hidden directory, which would skip `.agents` itself, so
 * only a `.agents/rules/` below another hidden directory is ignored here
 * (`extractAntigravitySubprojectPath` rejects one again on import). Import-only,
 * like every other nested scan: these files sit outside the rulesync-owned root
 * `.agents/rules/`, so `--delete` never sweeps them.
 */
export function getAntigravityNestedFilePatterns(): ToolRuleNestedFilePatterns {
  return {
    include: [`**/${PROJECT_RULES_DIR}/*.md`],
    ignore: [
      // The project-root rules directory is read as the `nonRoot` one.
      `${PROJECT_RULES_DIR}/**`,
      `**/.*/**/${PROJECT_RULES_DIR}/**`,
      ...NESTED_SCAN_EXCLUDED_DIRS_ANY_DEPTH.map((dir) => `**/${dir}/**`),
      ...NESTED_SCAN_EXCLUDED_ROOT_DIRS.map((dir) => `${dir}/**`),
    ],
    // `rulesync gitignore` ignores `**/.agents/rules/`, so the gitignore filter
    // stops at `<dir>/.agents` instead of testing the rules directory itself.
    ownedDirPath: PROJECT_RULES_DIR,
  };
}

/**
 * Resolve where a non-root project rule file read from disk lives. A file
 * discovered by `getNestedFilePatterns` arrives as its own directory plus its
 * basename; it is re-split into the subproject's rules directory and the path
 * inside it, matching how the root `.agents/rules/` is read.
 */
export function resolveAntigravityNonRootFile({
  relativeDirPath,
  relativeFilePath,
  defaultDirPath,
}: {
  relativeDirPath: string | undefined;
  relativeFilePath: string;
  defaultDirPath: string;
}): { relativeDirPath: string; relativeFilePath: string } {
  const nested =
    relativeDirPath === undefined ? undefined : extractAntigravitySubprojectPath(relativeDirPath);
  if (nested === undefined) {
    return { relativeDirPath: defaultDirPath, relativeFilePath };
  }
  return {
    relativeDirPath: toAntigravityNestedRulesDirPath(nested.subprojectPath),
    relativeFilePath: join(nested.innerDirPath, relativeFilePath),
  };
}

/** The targets a nested rule is imported with: the two that read the shared tree. */
export const ANTIGRAVITY_NESTED_RULE_TARGETS = ["antigravity-ide", "antigravity-cli"] as const;

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

import { basename, join } from "node:path";

import { dump } from "js-yaml";
import { z } from "zod/mini";

import {
  AUGMENTCODE_CODE_REVIEW_GUIDELINES_FILE_NAME,
  AUGMENTCODE_DIR,
} from "../../constants/augmentcode-paths.js";
import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { fileExists, readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isPlainObject } from "../../utils/type-guards.js";
import { loadYaml } from "../../utils/yaml.js";
import { slugifyCheckName } from "./check-slug.js";
import { RulesyncCheck } from "./rulesync-check.js";
import {
  ToolCheck,
  type ToolCheckForDeletionParams,
  type ToolCheckFromFileParams,
  type ToolCheckFromRulesyncCheckParams,
  type ToolCheckFromRulesyncChecksParams,
  type ToolCheckSettablePaths,
} from "./tool-check.js";

/** Augment's severity scale. Narrower than the canonical one. */
const AUGMENTCODE_SEVERITIES = ["high", "medium", "low"] as const;
type AugmentcodeSeverity = (typeof AUGMENTCODE_SEVERITIES)[number];

/**
 * Canonical severity to Augment's scale. Augment has no band above `high`, so
 * canonical `critical` folds into it — the alternative, dropping the rule or
 * demoting it to `medium`, would either lose the check or understate the one
 * severity a reviewer most wants raised. The fold is one-way: a `critical`
 * check generates `high` and imports back as `high`, so the canonical value is
 * not recoverable from Augment's file alone.
 */
const CANONICAL_TO_AUGMENTCODE_SEVERITY: Record<string, AugmentcodeSeverity> = {
  low: "low",
  medium: "medium",
  high: "high",
  critical: "high",
};

/**
 * Every field of an `areas.<key>` entry is required upstream, so a check with no
 * `severity` still has to emit one. `medium` is the neutral middle of Augment's
 * three bands: defaulting to `high` would inflate every unannotated check past
 * the ones deliberately marked `medium`, and `low` would bury them.
 */
const DEFAULT_AUGMENTCODE_SEVERITY: AugmentcodeSeverity = "medium";

/** Augment's own example uses `["**"]`, and `globs` is required per area. */
const DEFAULT_AREA_GLOBS = ["**"];

/**
 * The `augmentcode` block of a check's frontmatter, carrying the two things the
 * canonical check model has no home for: which area a rule belongs to (so
 * several checks can share one), and the area's `globs`.
 */
const AugmentcodeCheckOverrideSchema = z.looseObject({
  /** Area key this check's rule is grouped under; defaults to the check's slug. */
  area: z.optional(z.string().check(z.minLength(1))),
  /** Human-readable `areas.<key>.description`; defaults to the check's own. */
  areaDescription: z.optional(z.string()),
  globs: z.optional(z.array(z.string().check(z.minLength(1)))),
  /** Rule `id`; defaults to the check's slug. */
  id: z.optional(z.string().check(z.minLength(1))),
});
type AugmentcodeCheckOverride = z.infer<typeof AugmentcodeCheckOverrideSchema>;

type AugmentcodeRule = { id: string; description: string; severity: AugmentcodeSeverity };

function parseOverride(raw: unknown, filePath: string, logger?: Logger): AugmentcodeCheckOverride {
  if (raw === undefined) {
    return {};
  }
  if (!isPlainObject(raw)) {
    logger?.warn(`Ignoring the \`augmentcode\` block in ${filePath}: expected a mapping.`);
    return {};
  }
  const result = AugmentcodeCheckOverrideSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid \`augmentcode\` block in ${filePath}: ${result.error.message}`, {
      cause: result.error,
    });
  }
  return result.data;
}

function stemOf(rulesyncCheck: RulesyncCheck): string {
  // basename, so a check in a subdirectory does not name its area `dir/name`.
  return basename(rulesyncCheck.getRelativeFilePath(), ".md");
}

/**
 * A rule's `description` is the whole instruction Augment acts on, so the check
 * body is preferred; the frontmatter `description` is a summary, used only when
 * there is no body. Both empty falls back to the check name, which at least
 * names the concern rather than emitting an empty required field.
 */
function toRuleDescription(rulesyncCheck: RulesyncCheck): string {
  const body = rulesyncCheck.getBody().trim();
  if (body.length > 0) {
    return body;
  }
  return rulesyncCheck.getFrontmatter().description?.trim() || stemOf(rulesyncCheck);
}

function toRule(rulesyncCheck: RulesyncCheck, override: AugmentcodeCheckOverride): AugmentcodeRule {
  const severity = rulesyncCheck.getFrontmatter().severity;
  return {
    id: override.id ?? slugifyCheckName(stemOf(rulesyncCheck)),
    description: toRuleDescription(rulesyncCheck),
    severity: severity
      ? (CANONICAL_TO_AUGMENTCODE_SEVERITY[severity] ?? DEFAULT_AUGMENTCODE_SEVERITY)
      : DEFAULT_AUGMENTCODE_SEVERITY,
  };
}

/**
 * Group the checks into `areas`. One area per check by default; checks naming
 * the same `augmentcode.area` share one, with the first check to name it
 * supplying the area's `description` and `globs`.
 */
function buildAreas(
  entries: { rulesyncCheck: RulesyncCheck; override: AugmentcodeCheckOverride }[],
): Record<string, unknown> {
  const areas = new Map<
    string,
    { description: string; globs: string[]; rules: AugmentcodeRule[] }
  >();

  for (const { rulesyncCheck, override } of entries) {
    const key = slugifyCheckName(override.area ?? stemOf(rulesyncCheck));
    const existing = areas.get(key);
    if (existing) {
      existing.rules.push(toRule(rulesyncCheck, override));
      continue;
    }
    areas.set(key, {
      description:
        override.areaDescription ??
        rulesyncCheck.getFrontmatter().description?.trim() ??
        stemOf(rulesyncCheck),
      globs: override.globs ?? DEFAULT_AREA_GLOBS,
      rules: [toRule(rulesyncCheck, override)],
    });
  }

  return Object.fromEntries(areas);
}

function parseGuidelines(fileContent: string, filePath: string): Record<string, unknown> {
  if (fileContent.trim().length === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = loadYaml(fileContent);
  } catch (error) {
    throw new Error(
      `Failed to parse AugmentCode code review guidelines at ${filePath}: ${formatError(error)}`,
      { cause: error },
    );
  }
  if (parsed === undefined || parsed === null) {
    return {};
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Failed to parse AugmentCode code review guidelines at ${filePath}: expected a mapping at the document root.`,
    );
  }
  return parsed;
}

/** An area's shared fields, read defensively out of hand-written YAML. */
function readArea(rawArea: Record<string, unknown>): {
  description?: string;
  globs?: string[];
  rules: unknown[];
} {
  const globs = Array.isArray(rawArea.globs)
    ? rawArea.globs.filter((glob): glob is string => typeof glob === "string")
    : undefined;
  return {
    ...(typeof rawArea.description === "string" && { description: rawArea.description }),
    ...(globs && globs.length > 0 && { globs }),
    rules: Array.isArray(rawArea.rules) ? rawArea.rules : [],
  };
}

/**
 * A rule missing `id` or `description` is not a shape Augment itself reads, so
 * it is skipped rather than imported as a check with an invented field.
 */
function readRule(
  rawRule: unknown,
): { id: string; description: string; severity?: AugmentcodeSeverity } | undefined {
  if (!isPlainObject(rawRule)) return undefined;
  const id = typeof rawRule.id === "string" ? rawRule.id : undefined;
  const description = typeof rawRule.description === "string" ? rawRule.description : undefined;
  if (!id || !description) return undefined;
  const severity = AUGMENTCODE_SEVERITIES.find((value) => value === rawRule.severity);
  return { id, description, ...(severity && { severity }) };
}

/**
 * A rule id repeated across two areas would otherwise have the second check
 * overwrite the first's file.
 */
function uniqueCheckName(preferred: string, usedNames: Set<string>): string {
  let name = preferred;
  let suffix = 2;
  while (usedNames.has(name)) {
    name = `${preferred}-${suffix}`;
    suffix += 1;
  }
  usedNames.add(name);
  return name;
}

/**
 * Checks adapter for Augment Code Review's custom guidelines
 * (`.augment/code_review_guidelines.yaml`).
 *
 * Augment groups review rules into named **areas**: each area carries a
 * `description`, the `globs` it applies to, and a list of `rules`, every rule
 * being an `id` / `description` / `severity` triple. Every one of those fields
 * is required upstream. Rulesync maps one `.rulesync/checks/*.md` onto one rule,
 * in an area of its own unless an `augmentcode.area` groups several together —
 * so the whole set collapses into this one file via {@link fromRulesyncChecks}
 * rather than a file per check.
 *
 * **Severity is lossy in one direction.** Augment's scale is `high` / `medium` /
 * `low` with no band above `high`, so canonical `critical` maps to `high` and
 * imports back as `high`. A check with no `severity` at all emits `medium`,
 * since the field cannot be omitted.
 *
 * **`file_paths_to_ignore`** is recognized and preserved verbatim, but never
 * authored or imported: the canonical check model has no ignore surface, and
 * inventing one here is a separate design question.
 *
 * **Generation merges rather than replaces.** Augment's own documentation tells
 * users to hand-write this file, so only the areas the current check set claims
 * are rewritten; every other area, `file_paths_to_ignore`, and any unknown
 * top-level key survive. The cost of that is that rulesync cannot tell its own
 * leftovers from a hand-written area: renaming a check strands the area under
 * the old key, and dropping the last Augment-targeting check leaves the areas in
 * place with a warning rather than guessing which of them to delete. Deleting
 * the file outright is likewise refused whenever it exists.
 *
 * Project scope only — the reviewer reads the file from the committed
 * repository, and Augment documents no user-level equivalent.
 *
 * @see https://docs.augmentcode.com/codereview/review-guidelines
 */
export class AugmentcodeCheck extends ToolCheck {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCheckSettablePaths {
    // Naming the file keeps consumers that would otherwise claim the whole
    // `.augment/` tree — the gitignore derivation, for one — narrowed to the one
    // file written, since every other AugmentCode feature writes there too.
    return {
      relativeDirPath: AUGMENTCODE_DIR,
      relativeFilePath: AUGMENTCODE_CODE_REVIEW_GUIDELINES_FILE_NAME,
    };
  }

  static isTargetedByRulesyncCheck(rulesyncCheck: RulesyncCheck): boolean {
    return this.isTargetedByRulesyncCheckDefault({ rulesyncCheck, toolTarget: "augmentcode" });
  }

  /**
   * Ownership guard the processor consults before it deletes anything for this
   * tool. Unlike the Markdown adapters, whose section markers say which text is
   * rulesync's, YAML carries no such marker — js-yaml drops comments on rewrite,
   * and an unknown top-level key risks Augment's own parser. So an existing file
   * is never rulesync's to delete: it may hold hand-written areas, and there is
   * no way to prove otherwise.
   */
  static async canDeleteAuxiliaryFiles({ outputRoot }: { outputRoot: string }): Promise<boolean> {
    const paths = AugmentcodeCheck.getSettablePaths();
    const filePath = join(
      outputRoot,
      paths.relativeDirPath,
      paths.relativeFilePath ?? AUGMENTCODE_CODE_REVIEW_GUIDELINES_FILE_NAME,
    );
    return !(await fileExists(filePath));
  }

  static override fromRulesyncCheck(_params: ToolCheckFromRulesyncCheckParams): AugmentcodeCheck {
    // Areas share one file, so they are only ever built as a set.
    throw new Error(
      "AugmentCode checks are built from all checks at once; use fromRulesyncChecks.",
    );
  }

  static async fromRulesyncChecks({
    outputRoot = process.cwd(),
    rulesyncChecks,
    global = false,
    logger,
  }: ToolCheckFromRulesyncChecksParams): Promise<AugmentcodeCheck[]> {
    const paths = AugmentcodeCheck.getSettablePaths({ global });
    const relativeFilePath = paths.relativeFilePath ?? AUGMENTCODE_CODE_REVIEW_GUIDELINES_FILE_NAME;
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    // Read without initializing so a dry-run does not create the user's
    // guidelines file as a side effect.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const existing = parseGuidelines(existingContent, filePath);
    const existingAreas = isPlainObject(existing.areas) ? existing.areas : {};

    if (rulesyncChecks.length === 0) {
      if (Object.keys(existingAreas).length > 0) {
        logger?.warn(
          `AugmentCode checks: no check targets AugmentCode, but ${filePath} still holds review ` +
            `areas. They are left in place — rulesync cannot tell the ones it generated from ones ` +
            `you wrote, so removing them is a manual edit.`,
        );
      }
      return [];
    }

    const entries = rulesyncChecks.map((rulesyncCheck) => ({
      rulesyncCheck,
      override: parseOverride(
        rulesyncCheck.getFrontmatter().augmentcode,
        join(RULESYNC_CHECKS_RELATIVE_DIR_PATH, rulesyncCheck.getRelativeFilePath()),
        logger,
      ),
    }));

    const generatedAreas = buildAreas(entries);
    // Only the areas this generate claims are rewritten; the rest of the file —
    // other areas, `file_paths_to_ignore`, anything Augment adds later — is
    // carried through untouched.
    const fileContent = dump(
      { ...existing, areas: { ...existingAreas, ...generatedAreas } },
      { lineWidth: -1 },
    );

    return [
      new AugmentcodeCheck({
        outputRoot,
        relativeDirPath: paths.relativeDirPath,
        relativeFilePath,
        fileContent,
        global,
      }),
    ];
  }

  static async fromFile({
    outputRoot = process.cwd(),
    global = false,
  }: ToolCheckFromFileParams): Promise<AugmentcodeCheck> {
    const paths = AugmentcodeCheck.getSettablePaths({ global });
    const relativeFilePath = paths.relativeFilePath ?? AUGMENTCODE_CODE_REVIEW_GUIDELINES_FILE_NAME;
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    return new AugmentcodeCheck({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      fileContent: (await readFileContentOrNull(filePath)) ?? "",
      global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolCheckForDeletionParams): AugmentcodeCheck {
    return new AugmentcodeCheck({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  toRulesyncCheck(): RulesyncCheck {
    const checks = this.toRulesyncChecks();
    const first = checks[0];
    if (!first) {
      throw new Error(
        `No review areas found in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}.`,
      );
    }
    return first;
  }

  /**
   * One check per rule, not per area: an area with three rules is three
   * independent review instructions, and collapsing them into one check would
   * make the next generate emit a single merged rule in their place. The area's
   * key, description and globs ride along in each check's `augmentcode` block,
   * so regenerating regroups the rules exactly where they were.
   */
  override toRulesyncChecks(): RulesyncCheck[] {
    const filePath = join(this.getRelativeDirPath(), this.getRelativeFilePath());
    const guidelines = parseGuidelines(this.getFileContent(), filePath);
    const areas = isPlainObject(guidelines.areas) ? guidelines.areas : {};

    const checks: RulesyncCheck[] = [];
    const usedNames = new Set<string>();

    for (const [areaKey, rawArea] of Object.entries(areas)) {
      if (!isPlainObject(rawArea)) continue;
      const { description: areaDescription, globs, rules } = readArea(rawArea);

      for (const rawRule of rules) {
        const rule = readRule(rawRule);
        if (!rule) continue;

        const name = uniqueCheckName(
          slugifyCheckName(rule.id) || slugifyCheckName(areaKey) || "check",
          usedNames,
        );

        checks.push(
          new RulesyncCheck({
            outputRoot: ".",
            relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
            relativeFilePath: `${name}.md`,
            frontmatter: {
              // The rule text is plain prose, so it applies to any checks target.
              targets: ["*"],
              ...(rule.severity && { severity: rule.severity }),
              augmentcode: {
                area: areaKey,
                ...(areaDescription !== undefined && { areaDescription }),
                ...(globs && { globs }),
                id: rule.id,
              },
            },
            body: rule.description,
          }),
        );
      }
    }

    return checks;
  }
}

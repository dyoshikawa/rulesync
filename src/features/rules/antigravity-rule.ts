import { join } from "node:path";

import { ANTIGRAVITY_IDE_AGENTS_DIR } from "../../constants/antigravity-ide-paths.js";
import { toKebabCaseFilename } from "../../utils/file.js";
import { warnOnceWithFallback } from "../../utils/logger.js";
import { nestedScanExclusionGlobs } from "./nested-scan-exclusions.js";
import { extractRulesDirSubprojectPath } from "./rules-dir-subproject-path.js";
import type { RulesyncRule } from "./rulesync-rule.js";
import type { ToolRuleNestedFilePatterns } from "./tool-rule.js";
import {
  TriggerRuleFrontmatter,
  TriggerRuleFrontmatterSchema,
  createTriggerStrategies,
} from "./trigger-rule-strategies.js";

export const AntigravityRuleFrontmatterSchema = TriggerRuleFrontmatterSchema;

export type AntigravityRuleFrontmatter = TriggerRuleFrontmatter;

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
 * The subproject directory a rule is scoped to, or `undefined` for an unscoped
 * rule. Project scope only: there is no workspace tree to scope to in global
 * scope.
 *
 * Antigravity loads rules from the workspace folder and its parents up to the
 * repository root, but not from subfolders below the workspace folder, so a
 * `<subprojectPath>/.agents/rules/` directory is ignored when the repository
 * root is opened. A subproject-scoped rule is therefore written to the
 * project-root `.agents/rules/` as a glob rule limited to that subproject (see
 * `scopeAntigravityFrontmatterToSubproject`).
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
  if (!subprojectPath) {
    return undefined;
  }
  const normalized = toPosixSubprojectPath(subprojectPath);
  // `""` and `.` name the project root, which is not a subproject.
  return normalized === "" || normalized === "." ? undefined : normalized;
}

/** A subproject path as POSIX segments without a leading `./` or `/` or a trailing `/`. */
function toPosixSubprojectPath(subprojectPath: string): string {
  return subprojectPath
    .replaceAll("\\", "/")
    .replace(/^(?:\.\/)+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

/**
 * File name of a subproject-scoped rule in the project-root `.agents/rules/`:
 * the subproject path and the rule path flattened into one kebab-case name
 * (`packages/api` + `frontend/codeStyle.md` →
 * `packages-api-frontend-code-style.md`), so rules of different subprojects
 * do not collide. The name is a fixed point of both targets' naming of
 * project-root rules (the IDE kebab-cases, the CLI keeps the name), so an
 * imported file is written back to the same place by either target.
 */
export function toSubprojectRuleFileName({
  subprojectPath,
  relativeFilePath,
}: {
  subprojectPath: string;
  relativeFilePath: string;
}): string {
  return toKebabCaseFilename(toGlobalRuleFileName(`${subprojectPath}/${relativeFilePath}`));
}

/**
 * Prefix one glob with a subproject directory. A glob that already starts
 * with the subproject (a project-root-relative glob, as a subproject derived
 * from `globs` always has) is not prefixed twice. The result starts with
 * `**\/` because Antigravity matches globs against the resolved file path
 * (a bare `dir/file.md` does not match), and so that the rule also applies
 * when it is loaded from a parent folder of a workspace opened inside the
 * repository.
 */
function prefixGlob({ glob, subprojectPath }: { glob: string; subprojectPath: string }): string {
  const negated = glob.startsWith("!");
  const pattern = (negated ? glob.slice(1) : glob).replace(/^(?:\.\/)+/, "").replace(/^\/+/, "");
  return `${negated ? "!" : ""}${anchorToSubproject({ pattern, subprojectPath })}`;
}

function anchorToSubproject({
  pattern,
  subprojectPath,
}: {
  pattern: string;
  subprojectPath: string;
}): string {
  if (pattern === `**/${subprojectPath}` || pattern.startsWith(`**/${subprojectPath}/`)) {
    return pattern;
  }
  if (pattern === subprojectPath || pattern.startsWith(`${subprojectPath}/`)) {
    return `**/${pattern}`;
  }
  return `**/${subprojectPath}/${pattern}`;
}

/**
 * Limit the trigger frontmatter of a subproject-scoped rule to that
 * subproject, for writing it to the project-root `.agents/rules/`:
 *
 * - a `glob` rule keeps its trigger, with every glob prefixed by the
 *   subproject (`src/**\/*.ts` → `**\/packages/api/src/**\/*.ts`);
 * - an `always_on` rule becomes a `glob` rule matching everything under the
 *   subproject (`**\/packages/api/**`);
 * - any other trigger (`model_decision`, `manual`, or an unknown one) cannot
 *   be limited to files, so it is kept as is and a warning says the rule now
 *   applies to the whole project.
 */
export function scopeAntigravityFrontmatterToSubproject({
  frontmatter,
  subprojectPath,
  rulePath,
}: {
  frontmatter: AntigravityRuleFrontmatter;
  subprojectPath: string;
  rulePath: string;
}): AntigravityRuleFrontmatter {
  if (frontmatter.trigger === "glob" || frontmatter.trigger === "always_on") {
    const globs =
      frontmatter.trigger === "glob" && frontmatter.globs
        ? frontmatter.globs
            .split(",")
            .map((glob) => glob.trim())
            .filter((glob) => glob !== "")
        : [];
    const scoped = (globs.length > 0 ? globs : ["**"]).map((glob) =>
      prefixGlob({ glob, subprojectPath }),
    );
    return { ...frontmatter, trigger: "glob", globs: scoped.join(",") };
  }
  warnOnceWithFallback(
    undefined,
    `${rulePath}: Antigravity does not load rules from <subprojectPath>/.agents/rules/, so the rule scoped to "${subprojectPath}" is written to .agents/rules/ instead, and its trigger "${String(frontmatter.trigger)}" cannot be limited to that subproject; it applies to the whole project. Use trigger "glob" or "always_on" to keep the scope.`,
  );
  return frontmatter;
}

/** The legacy `.agents/rules/` directory of a subproject, still read on import. */
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
  return extractRulesDirSubprojectPath({ relativeDirPath, toolDir: ANTIGRAVITY_IDE_AGENTS_DIR });
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
      ...nestedScanExclusionGlobs(),
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

/**
 * Trigger strategies for converting between RulesyncRule and the Antigravity
 * rule formats, which store their config under the `antigravity` key.
 */
export const STRATEGIES = createTriggerStrategies("antigravity");

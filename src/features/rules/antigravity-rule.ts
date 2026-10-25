import { join } from "node:path";

import { ANTIGRAVITY_IDE_AGENTS_DIR } from "../../constants/antigravity-ide-paths.js";
import { toPosixPath } from "../../utils/file.js";
import { nestedScanExclusionGlobs } from "./nested-scan-exclusions.js";
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

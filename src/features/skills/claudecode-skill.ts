import { join, relative } from "node:path";

import { z } from "zod/mini";

import {
  CLAUDECODE_SCHEDULED_TASKS_DIR_PATH,
  CLAUDECODE_SKILLS_DIR_PATH,
} from "../../constants/claudecode-paths.js";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import {
  filterOutPathsInGitIgnoredDirectories,
  findFilesByGlobs,
  toPosixPath,
} from "../../utils/file.js";
import {
  NESTED_SCAN_EXCLUDED_DIRS_ANY_DEPTH,
  NESTED_SCAN_EXCLUDED_ROOT_DIRS,
} from "../rules/nested-scan-exclusions.js";
import {
  RulesyncSkill,
  RulesyncSkillFrontmatter,
  RulesyncSkillFrontmatterInput,
  SkillFile,
} from "./rulesync-skill.js";
import { resolveDisableModelInvocation, resolveUserInvocable } from "./skills-utils.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

export const ClaudecodeSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  // Additional context for when Claude should invoke the skill (trigger phrases,
  // example requests). Appended to `description` in the skill listing.
  when_to_use: z.optional(z.string()),
  // Tools Claude may use without asking while the skill is active.
  // The docs accept a space/comma-separated string or a YAML list.
  "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
  // Removes the listed tools from the model while the skill is active.
  // Accepts the space/comma-separated string form or a YAML list, mirroring `allowed-tools`.
  "disallowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
  model: z.optional(z.string()),
  // Effort level while the skill is active (low | medium | high | xhigh | max).
  effort: z.optional(z.string()),
  // Hint shown during autocomplete to indicate expected arguments.
  "argument-hint": z.optional(z.string()),
  // Named positional arguments for `$name` substitution; string or YAML list.
  arguments: z.optional(z.union([z.string(), z.array(z.string())])),
  // `fork` runs the skill in a forked subagent context.
  context: z.optional(z.string()),
  // Which subagent type to use when `context: fork` is set.
  agent: z.optional(z.string()),
  // Only applies with `context: fork`. `false` waits for the forked subagent's
  // result in the invoking turn instead of running it in the background.
  // Defaults to `true`, so `false` is the meaningful value to write.
  // https://code.claude.com/docs/en/skills
  background: z.optional(z.boolean()),
  // Hooks scoped to the skill's lifecycle (free-form per the docs).
  hooks: z.optional(z.looseObject({})),
  // Shell for `!` command blocks in the skill (`bash` default or `powershell`).
  shell: z.optional(z.string()),
  "disable-model-invocation": z.optional(z.boolean()),
  "user-invocable": z.optional(z.boolean()),
  paths: z.optional(z.union([z.string(), z.array(z.string())])),
});

export type ClaudecodeSkillFrontmatter = z.infer<typeof ClaudecodeSkillFrontmatterSchema>;

/**
 * Builds the Claude Code SKILL.md frontmatter from a rulesync skill, carrying
 * the `claudecode:` section's fields through and folding in the resolved
 * model-invocation / user-invocable flags. Extracted to keep
 * `fromRulesyncSkill` under the cyclomatic-complexity cap.
 */
function buildClaudecodeSkillFrontmatter({
  rulesyncFrontmatter,
  resolvedDisableModelInvocation,
  resolvedUserInvocable,
}: {
  rulesyncFrontmatter: RulesyncSkillFrontmatter;
  resolvedDisableModelInvocation: boolean | undefined;
  resolvedUserInvocable: boolean | undefined;
}): ClaudecodeSkillFrontmatter {
  const section = rulesyncFrontmatter.claudecode ?? {};
  // Build the frontmatter data-driven so the function stays well under the
  // cyclomatic-complexity cap as fields are added. The two presence rules mirror
  // `toRulesyncSkill` exactly so the conversion is symmetric: most fields are
  // included only when truthy, while `arguments`/`hooks`/`paths` and the resolved
  // invocation flags are included whenever they are explicitly defined.
  const truthyFields: Record<string, unknown> = {
    when_to_use: section.when_to_use,
    "allowed-tools": section["allowed-tools"],
    "disallowed-tools": section["disallowed-tools"],
    model: section.model,
    effort: section.effort,
    "argument-hint": section["argument-hint"],
    context: section.context,
    agent: section.agent,
    shell: section.shell,
  };
  const definedFields: Record<string, unknown> = {
    // Defined rather than truthy: `background: false` is the whole point of the
    // field, and a truthy check would drop it.
    background: section.background,
    arguments: section.arguments,
    hooks: section.hooks,
    "disable-model-invocation": resolvedDisableModelInvocation,
    "user-invocable": resolvedUserInvocable,
    paths: section.paths,
  };

  const frontmatter: Record<string, unknown> = {
    name: rulesyncFrontmatter.name,
    description: rulesyncFrontmatter.description,
  };
  for (const [key, value] of Object.entries(truthyFields)) {
    if (value) {
      frontmatter[key] = value;
    }
  }
  for (const [key, value] of Object.entries(definedFields)) {
    if (value !== undefined) {
      frontmatter[key] = value;
    }
  }

  return frontmatter as ClaudecodeSkillFrontmatter;
}

/**
 * Claude Code scopes a nested skill by its location: a skill living in
 * `apps/web/.claude/skills/deploy` only activates while working under
 * `apps/web`. rulesync generates every imported skill into the project-root
 * `.claude/skills/`, so on import that location-based scoping has to be
 * re-expressed as an explicit `paths` glob — otherwise the round-trip silently
 * promotes a subtree skill to global activation.
 *
 * Returns the derived glob for a nested discovery root, or `undefined` for the
 * project-root `.claude/skills` (and for any root whose subtree cannot be
 * determined), where no scoping is implied.
 *
 * @see https://code.claude.com/docs/en/skills
 */
export function deriveNestedSkillPaths(relativeDirPath: string): string[] | undefined {
  const posixDirPath = toPosixPath(relativeDirPath);
  const skillsDirSuffix = `/${toPosixPath(CLAUDECODE_SKILLS_DIR_PATH)}`;
  if (!posixDirPath.endsWith(skillsDirSuffix)) {
    return undefined;
  }
  const subtree = posixDirPath.slice(0, -skillsDirSuffix.length);
  if (subtree === "" || subtree === ".") {
    return undefined;
  }
  return [`${subtree}/**`];
}

export type ClaudecodeSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: ClaudecodeSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Claude Code skill directory.
 * Unlike subagents and commands, skills are directories containing SKILL.md and other files.
 * Extends ToolSkill to inherit directory management and security features from AiDir.
 */
export class ClaudecodeSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = CLAUDECODE_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: ClaudecodeSkillParams) {
    super({
      outputRoot,
      relativeDirPath,
      dirName,
      mainFile: {
        name: SKILL_FILE_NAME,
        body,
        frontmatter: { ...frontmatter },
      },
      otherFiles,
      global,
    });

    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths({
    global: _global = false,
  }: {
    global?: boolean;
  } = {}): ToolSkillSettablePaths {
    return {
      relativeDirPath: CLAUDECODE_SKILLS_DIR_PATH,
      alternativeSkillRoots: [CLAUDECODE_SCHEDULED_TASKS_DIR_PATH],
    };
  }

  /**
   * Claude Code v2.1.178+ also loads skills from **nested** `.claude/skills/`
   * directories below the working directory (a skill in
   * `apps/web/.claude/skills/` becomes available when working on files
   * there). Discover those directories so `rulesync import` sees them —
   * import-only and lenient, like every configured root; the project-root
   * `.claude/skills/` stays the sole generation target. The scan reuses the
   * nested-rule-file exclusions (dependency trees at any depth, build/vendor
   * dirs at the root, hidden dirs other than the `.claude` being matched) and
   * never runs in global mode. On a name clash with a root skill, the root
   * one wins the import (Claude Code itself keeps both under a
   * directory-qualified name, which rulesync's flat skill namespace cannot
   * express).
   *
   * @see https://code.claude.com/docs/en/skills
   */
  static async getConfiguredImportRoots({
    outputRoot,
    global = false,
  }: {
    outputRoot: string;
    global?: boolean;
  }): Promise<Array<{ outputRoot: string; relativeDirPath: string }>> {
    if (global) {
      return [];
    }
    const root = toPosixPath(outputRoot);
    const dirPaths = await findFilesByGlobs(
      [`${root}/*/**/${toPosixPath(CLAUDECODE_SKILLS_DIR_PATH)}`],
      {
        type: "dir",
        followSymbolicLinks: false,
        ignore: [
          `${root}/**/.*/**/${toPosixPath(CLAUDECODE_SKILLS_DIR_PATH)}`,
          ...NESTED_SCAN_EXCLUDED_DIRS_ANY_DEPTH.map((dir) => `${root}/**/${dir}/**`),
          ...NESTED_SCAN_EXCLUDED_ROOT_DIRS.map((dir) => `${root}/${dir}/**`),
        ],
      },
    );
    // Honor the project's .gitignore like the nested AGENTS.md scan does: a
    // gitignored scratch checkout's skills are somebody else's project and
    // must not be pulled into the shared `.rulesync/skills/` namespace.
    // Sorted so a nested-vs-nested name clash resolves deterministically
    // (lexicographically first root wins).
    const filteredDirPaths = filterOutPathsInGitIgnoredDirectories({
      rootDir: outputRoot,
      filePaths: dirPaths,
    }).toSorted();
    return filteredDirPaths.map((dirPath) => ({
      outputRoot,
      relativeDirPath: relative(outputRoot, dirPath),
    }));
  }

  getFrontmatter(): ClaudecodeSkillFrontmatter {
    const result = ClaudecodeSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
    return result;
  }

  getBody(): string {
    return this.mainFile?.body ?? "";
  }

  validate(): ValidationResult {
    if (this.mainFile === undefined) {
      return {
        success: false,
        error: new Error(`${this.getDirPath()}: ${SKILL_FILE_NAME} file does not exist`),
      };
    }
    const result = ClaudecodeSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`,
        ),
      };
    }

    return { success: true, error: null };
  }

  toRulesyncSkill(): RulesyncSkill {
    const frontmatter = this.getFrontmatter();
    // An author-declared `paths` always wins; only a skill that says nothing
    // about scoping inherits the glob derived from its nested location.
    const resolvedPaths =
      frontmatter.paths !== undefined
        ? frontmatter.paths
        : deriveNestedSkillPaths(this.relativeDirPath);
    const claudecodeSection = {
      ...(frontmatter.when_to_use && { when_to_use: frontmatter.when_to_use }),
      ...(frontmatter["allowed-tools"] && { "allowed-tools": frontmatter["allowed-tools"] }),
      ...(frontmatter["disallowed-tools"] && {
        "disallowed-tools": frontmatter["disallowed-tools"],
      }),
      ...(frontmatter.model && { model: frontmatter.model }),
      ...(frontmatter.effort && { effort: frontmatter.effort }),
      ...(frontmatter["argument-hint"] && { "argument-hint": frontmatter["argument-hint"] }),
      ...(frontmatter.arguments !== undefined && { arguments: frontmatter.arguments }),
      ...(frontmatter.context && { context: frontmatter.context }),
      ...(frontmatter.agent && { agent: frontmatter.agent }),
      ...(frontmatter.background !== undefined && { background: frontmatter.background }),
      ...(frontmatter.hooks !== undefined && { hooks: frontmatter.hooks }),
      ...(frontmatter.shell && { shell: frontmatter.shell }),
      ...(frontmatter["disable-model-invocation"] !== undefined && {
        "disable-model-invocation": frontmatter["disable-model-invocation"],
      }),
      ...(frontmatter["user-invocable"] !== undefined && {
        "user-invocable": frontmatter["user-invocable"],
      }),
      ...(this.relativeDirPath === CLAUDECODE_SCHEDULED_TASKS_DIR_PATH && {
        "scheduled-task": true,
      }),
      ...(resolvedPaths !== undefined && { paths: resolvedPaths }),
    };
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...(Object.keys(claudecodeSection).length > 0 && { claudecode: claudecodeSection }),
    };

    return new RulesyncSkill({
      outputRoot: this.outputRoot,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: this.getDirName(),
      frontmatter: rulesyncFrontmatter,
      body: this.getBody(),
      otherFiles: this.getOtherFiles(),
      validate: true,
      global: this.global,
    });
  }

  static fromRulesyncSkill({
    outputRoot = process.cwd(),
    rulesyncSkill,
    validate = true,
    global = false,
  }: ToolSkillFromRulesyncSkillParams): ClaudecodeSkill {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    const resolvedDisableModelInvocation = resolveDisableModelInvocation({
      rootFrontmatter: rulesyncFrontmatter,
      section: rulesyncFrontmatter.claudecode,
    });
    const resolvedUserInvocable = resolveUserInvocable({
      rootFrontmatter: rulesyncFrontmatter,
      section: rulesyncFrontmatter.claudecode,
    });

    const claudecodeFrontmatter = buildClaudecodeSkillFrontmatter({
      rulesyncFrontmatter,
      resolvedDisableModelInvocation,
      resolvedUserInvocable,
    });

    const settablePaths = this.getSettablePaths({ global });
    const relativeDirPath = rulesyncFrontmatter.claudecode?.["scheduled-task"]
      ? CLAUDECODE_SCHEDULED_TASKS_DIR_PATH
      : settablePaths.relativeDirPath;

    return new this({
      outputRoot,
      relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: claudecodeFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const frontmatter = rulesyncSkill.getFrontmatter();
    const targets = frontmatter.targets;
    if (frontmatter.claudecode?.["scheduled-task"]) {
      return true;
    }
    return targets.includes("*") || targets.includes("claudecode");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<ClaudecodeSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: (options) => this.getSettablePaths(options),
    });

    const result = ClaudecodeSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new this({
      outputRoot: loaded.outputRoot,
      relativeDirPath: loaded.relativeDirPath,
      dirName: loaded.dirName,
      frontmatter: result.data,
      body: loaded.body,
      otherFiles: loaded.otherFiles,
      validate: true,
      global: loaded.global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    dirName,
    global = false,
  }: ToolSkillForDeletionParams): ClaudecodeSkill {
    return new this({
      outputRoot,
      relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global,
    });
  }
}

import { join, relative, resolve, sep } from "node:path";

import { z } from "zod/mini";

import {
  CLAUDECODE_SCHEDULED_TASKS_DIR_PATH,
  CLAUDECODE_SKILLS_DIR_PATH,
} from "../../constants/claudecode-paths.js";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { stripControlCharacters } from "../../utils/control-characters.js";
import { formatError } from "../../utils/error.js";
import {
  directoryExists,
  filterOutPathsInGitIgnoredDirectories,
  findFilesByGlobs,
  isHiddenPathSegment,
  posixRelativePathEscapesRoot,
  resolvedRelativePath,
  toPosixPath,
} from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
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
import {
  resolveCompatibility,
  resolveDisableModelInvocation,
  resolveLicense,
  resolveMetadata,
  resolveUserInvocable,
} from "./skills-utils.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

/**
 * The `.claude/skills` tail every scanned root is expected to end with, written
 * posix-separated so it can be compared against a resolved relative path, and
 * split into its segments so what sits above it can be taken apart.
 *
 * Split here rather than through the shared helper: this is evaluated as the
 * module loads, before a test that mocks the file utilities can supply one.
 */
const CLAUDECODE_SKILLS_DIR_SEGMENTS = CLAUDECODE_SKILLS_DIR_PATH.split(sep);
const CLAUDECODE_SKILLS_DIR_POSIX_PATH = CLAUDECODE_SKILLS_DIR_SEGMENTS.join("/");

/**
 * The segment that puts `relativeDirPath` inside a tree the nested scan
 * excludes, or `undefined` when none does. These are the same three rules the
 * scan states as glob `ignore` patterns below -- dependency trees at any depth,
 * build and vendoring directories at the project root, hidden directories other
 * than the `.claude` being matched -- and the two have to be kept in step.
 *
 * Saying them twice is what a second pass costs. globby matches its patterns
 * against the path it reports, before the `..` a rewritten directory name
 * carries is folded away and before a link in the path is resolved. A root
 * reported at `x/../node_modules/.claude/skills` matches none of the patterns
 * and then leads to the dependency tree they name, so the decision has to be
 * taken again on the path that is really read.
 *
 * The segments passed are the ones above the `.claude/skills` tail, taken from
 * the resolved path: a directory name may hold a backslash -- the whole reason a
 * path can arrive here misspelled -- so the split that produced them has to be on
 * `/`, the one separator no name can contain. The tail itself is the part the
 * glob matched and is not judged; `.claude` is hidden by definition and every
 * root the scan reports ends with it.
 */
function excludedNestedScanSegment(segments: string[]): string | undefined {
  return segments.find(
    (segment, index) =>
      NESTED_SCAN_EXCLUDED_DIRS_ANY_DEPTH.includes(segment) ||
      (index === 0 && NESTED_SCAN_EXCLUDED_ROOT_DIRS.includes(segment)) ||
      isHiddenPathSegment(segment),
  );
}

/**
 * Whether a nested skills directory the scan reported can be used as an import
 * root: either the reason it cannot, or the path it resolves to relative to the
 * project, which the caller uses to tell two spellings of one root apart.
 *
 * A recursive glob cannot be swapped for a walk the way a flat one can, so the
 * path it hands back is checked instead. globby reads a backslash as a path
 * separator and rewrites it, so a root below a directory really named
 * `back\\slash` is reported at `back/slash`. Where that leads decides what to
 * do with it, and the spelling alone does not say: `back/slash` usually answers
 * to nothing, but `x\\..\\..\\outside` is reported at `x/../../outside`, which
 * climbs out of the project through the real sibling `x/`, and `a\\b` at `a/b`,
 * which may be a symbolic link out of the project that the scan — it passes
 * `followSymbolicLinks: false` — never meant to reach. Both are refused by
 * resolving the path rather than reading it.
 *
 * What is deliberately not refused is a rewritten path that stays inside the
 * project, such as `x\\..\\y` reported at `x/../y`. It names a real directory
 * `y`, and the scan reports that directory under this spelling *instead of* its
 * own, so refusing it would lose `y`'s skills rather than protect anything. The
 * skills under the directory that was really named are unreachable either way:
 * no path the scan can report leads back to a name holding a backslash.
 *
 * That last shape is the one case the scan cannot warn about. `a\\b` reported
 * at `a/b`, where `a/b` is itself a real directory, is indistinguishable from
 * the ordinary root `a/b` -- both are spelled the same and both are there -- so
 * the skills under `a\\b` are dropped without a word. Nothing in the path says
 * a second directory was ever involved.
 */
async function checkNestedSkillsRoot({
  outputRoot,
  dirPath,
}: {
  outputRoot: string;
  dirPath: string;
}): Promise<{ reason: string } | { realRelativeDirPath: string }> {
  if (!(await directoryExists(dirPath))) {
    return {
      reason:
        "it could not be read under the path the scan reports, most often because a " +
        "directory name above it contains a backslash.",
    };
  }
  // Resolved once, and every question below asked of that one answer: a `..` the
  // rewrite left in can climb out through a real sibling, a name that carries no
  // `..` at all can still be a link that leads out, and a link inside an otherwise
  // ordinary name reaches an excluded tree without any `..` either. All three look
  // contained to a lexical test, and resolving separately per question would leave
  // each free to judge a different path.
  const realRelativeDirPath = await resolvedRelativePath({
    rootPath: outputRoot,
    targetPath: dirPath,
  });
  if (posixRelativePathEscapesRoot(realRelativeDirPath)) {
    return { reason: "it resolves outside the project." };
  }
  const segments = realRelativeDirPath.split("/");
  const aboveTailSegments = segments.slice(0, -CLAUDECODE_SKILLS_DIR_SEGMENTS.length);
  // The tail is what the glob matched, but only on the reported path: a root
  // reported below an ordinary name may resolve through a link to somewhere that
  // is no skills directory at all -- the project root itself, at the extreme,
  // whose relative path is empty and escapes nothing. Read as a skills tree, such
  // a directory hands every child under it to the importer as a skill. Nothing
  // legitimate is lost by refusing it: the scan does not follow symbolic links, so
  // a root whose own `.claude/skills` is a link is never reported to begin with.
  if (
    segments.slice(-CLAUDECODE_SKILLS_DIR_SEGMENTS.length).join("/") !==
    CLAUDECODE_SKILLS_DIR_POSIX_PATH
  ) {
    // Named rather than quoted when it is the project root, whose relative path is
    // the empty string and would otherwise be reported as a pair of quotes.
    const resolvedDescription =
      realRelativeDirPath === ""
        ? "the project root"
        : JSON.stringify(stripControlCharacters(realRelativeDirPath));
    return {
      reason: `it resolves to ${resolvedDescription}, which is not a ${CLAUDECODE_SKILLS_DIR_POSIX_PATH} directory.`,
    };
  }
  const excludedSegment = excludedNestedScanSegment(aboveTailSegments);
  if (excludedSegment !== undefined) {
    return {
      reason: `it resolves inside ${JSON.stringify(stripControlCharacters(excludedSegment))}, which the nested scan excludes.`,
    };
  }
  // The gitignore filter needs no such second pass, though it too runs on the
  // reported paths. The scan de-duplicates by real file, and a directory's own
  // name always beats an alias of it, so a link into a gitignored tree is folded
  // onto the name the filter already judged. That only fails where the scan never
  // reports the real name -- which is exactly the trees excluded above.
  return { realRelativeDirPath };
}

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
  // Agent Skills standard frontmatter. Claude Code accepts all three but acts
  // on none of them; they matter for claude.ai skill uploads, the Skills API,
  // and `package_skill.py`. https://code.claude.com/docs/en/skills
  license: z.optional(z.string()),
  // The spec defines `compatibility` as a free-form string (up to 500 chars).
  // The object form is also accepted to stay permissive for existing inputs
  // (mirrors AgentsSkillsSkillFrontmatterSchema).
  compatibility: z.optional(z.union([z.string(), z.looseObject({})])),
  // Free-form map for the author's own tooling; Claude Code drops a non-map.
  metadata: z.optional(z.looseObject({})),
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
  // `buildClaudecodeSkillSection` exactly so the conversion is symmetric: most
  // fields are included only when truthy, while the ones listed under
  // `definedFields` are included whenever they are explicitly defined.
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
    // The Agent Skills standard fields are defined rather than truthy, matching
    // how every other adapter carrying them treats them. Each falls back to the
    // root-level rulesync value when the section omits it.
    license: resolveLicense({ rootFrontmatter: rulesyncFrontmatter, section }),
    compatibility: resolveCompatibility({ rootFrontmatter: rulesyncFrontmatter, section }),
    metadata: resolveMetadata({ rootFrontmatter: rulesyncFrontmatter, section }),
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
 * Builds the `claudecode:` section of a rulesync skill from a Claude Code
 * SKILL.md frontmatter — the inverse of `buildClaudecodeSkillFrontmatter`, and
 * extracted for the same reason: to keep `toRulesyncSkill` under the
 * cyclomatic-complexity cap as fields are added. The truthy/defined split
 * mirrors that function exactly so the conversion stays symmetric.
 */
function buildClaudecodeSkillSection({
  frontmatter,
  resolvedPaths,
  scheduledTask,
}: {
  frontmatter: ClaudecodeSkillFrontmatter;
  resolvedPaths: string | string[] | undefined;
  scheduledTask: boolean;
}): Record<string, unknown> {
  // One ordered list rather than a truthy map plus a defined map, so the emitted
  // key order stays exactly what the inline literal produced and a re-import
  // does not reshuffle an existing `.rulesync/skills/*.md`.
  const fields: [key: string, value: unknown, presence: "truthy" | "defined"][] = [
    ["when_to_use", frontmatter.when_to_use, "truthy"],
    ["allowed-tools", frontmatter["allowed-tools"], "truthy"],
    ["disallowed-tools", frontmatter["disallowed-tools"], "truthy"],
    ["model", frontmatter.model, "truthy"],
    ["effort", frontmatter.effort, "truthy"],
    ["argument-hint", frontmatter["argument-hint"], "truthy"],
    ["arguments", frontmatter.arguments, "defined"],
    ["context", frontmatter.context, "truthy"],
    ["agent", frontmatter.agent, "truthy"],
    ["background", frontmatter.background, "defined"],
    ["hooks", frontmatter.hooks, "defined"],
    ["shell", frontmatter.shell, "truthy"],
    ["disable-model-invocation", frontmatter["disable-model-invocation"], "defined"],
    ["user-invocable", frontmatter["user-invocable"], "defined"],
    ["scheduled-task", scheduledTask || undefined, "defined"],
    ["paths", resolvedPaths, "defined"],
    ["license", frontmatter.license, "defined"],
    ["compatibility", frontmatter.compatibility, "defined"],
    ["metadata", frontmatter.metadata, "defined"],
  ];

  const section: Record<string, unknown> = {};
  for (const [key, value, presence] of fields) {
    if (presence === "truthy" ? Boolean(value) : value !== undefined) {
      section[key] = value;
    }
  }
  return section;
}

/**
 * Escapes the glob metacharacters in a directory path so it matches literally.
 * A real directory name may contain them — `app/[slug]` in a Next.js tree is
 * the common case, and unescaped `[slug]` reads as a bracket expression that
 * matches a different subtree (or nothing at all).
 *
 * @see https://code.claude.com/docs/en/memory
 */
function escapeGlobLiteral(dirPath: string): string {
  return dirPath.replaceAll(/[\\*?[\]{}()!]/g, "\\$&");
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
  return [`${escapeGlobLiteral(subtree)}/**`];
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
    logger,
  }: {
    outputRoot: string;
    global?: boolean;
    logger?: Logger;
  }): Promise<Array<{ outputRoot: string; relativeDirPath: string }>> {
    if (global) {
      return [];
    }
    // Patterns are relative and the root travels as `cwd`: spelled into the
    // pattern instead, a project directory named `project(a)` or `project{a,b}`
    // would be read as a glob and match nothing, and `project*x` would reach
    // into sibling projects.
    const skillsDirPath = toPosixPath(CLAUDECODE_SKILLS_DIR_PATH);
    const dirPaths = await findFilesByGlobs([`*/**/${skillsDirPath}`], {
      cwd: outputRoot,
      type: "dir",
      followSymbolicLinks: false,
      ignore: [
        `**/.*/**/${skillsDirPath}`,
        ...NESTED_SCAN_EXCLUDED_DIRS_ANY_DEPTH.map((dir) => `**/${dir}/**`),
        ...NESTED_SCAN_EXCLUDED_ROOT_DIRS.map((dir) => `${dir}/**`),
      ],
    });
    // Honor the project's .gitignore like the nested AGENTS.md scan does: a
    // gitignored scratch checkout's skills are somebody else's project and
    // must not be pulled into the shared `.rulesync/skills/` namespace.
    // Sorted so a nested-vs-nested name clash resolves deterministically
    // (lexicographically first root wins).
    const filteredDirPaths = filterOutPathsInGitIgnoredDirectories({
      rootDir: outputRoot,
      filePaths: dirPaths,
    }).toSorted();
    const roots: Array<{ outputRoot: string; relativeDirPath: string }> = [];
    // A rewritten spelling, the directory's own, and a link to it can all name the
    // same root, so the roots are told apart by where they resolve rather than by
    // how they are spelled -- otherwise one root is scanned several times and every
    // skill under it is reported as a duplicate name. The tool's own root is seeded
    // here for the same reason: the glob cannot match it -- it requires a segment
    // above the tail -- but a name like `x\..` resolves onto it, and a nested root
    // is imported leniently, which would turn an invalid skill of the project's own
    // into a warning instead of an error.
    const seenRealRelativeDirPaths = new Set<string>([CLAUDECODE_SKILLS_DIR_POSIX_PATH]);
    for (const dirPath of filteredDirPaths) {
      // Normalized before anything is asked of it, so the path that is checked is
      // the one that is later read. A `..` the rewrite left in has to be folded
      // away either way -- `relative` folds it silently when the root is recorded,
      // and `x/../y` answers to nothing when `x` itself does not exist, though the
      // `y` it names may be a real root the scan reports under no other spelling.
      const scannedDirPath = resolve(dirPath);
      const check = await checkNestedSkillsRoot({
        outputRoot,
        dirPath: scannedDirPath,
      });
      if ("reason" in check) {
        logger?.warn(
          `Skipping the nested Claude Code skills directory ${JSON.stringify(stripControlCharacters(scannedDirPath))}: ` +
            `${check.reason} Its skills are not imported.`,
        );
        continue;
      }
      if (seenRealRelativeDirPaths.has(check.realRelativeDirPath)) {
        continue;
      }
      seenRealRelativeDirPaths.add(check.realRelativeDirPath);
      roots.push({ outputRoot, relativeDirPath: relative(outputRoot, scannedDirPath) });
    }
    return roots;
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
    // about scoping inherits the glob derived from its nested location. A
    // declared value is carried through verbatim rather than intersected with
    // the subtree: Claude Code does not document whether a nested skill's
    // `paths` resolves against the project root or its own directory, so
    // rewriting the author's glob would be guessing. The caveat is documented
    // in docs/reference/file-formats.md.
    const resolvedPaths =
      frontmatter.paths !== undefined
        ? frontmatter.paths
        : deriveNestedSkillPaths(this.relativeDirPath);
    const claudecodeSection = buildClaudecodeSkillSection({
      frontmatter,
      resolvedPaths,
      scheduledTask: this.relativeDirPath === CLAUDECODE_SCHEDULED_TASKS_DIR_PATH,
    });
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

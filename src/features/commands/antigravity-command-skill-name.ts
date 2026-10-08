import { basename, join, relative } from "node:path";

import {
  COMMANDS_FEATURE_SUBDIR,
  CURATED_SKILLS_FEATURE_SUBDIR,
  SKILLS_FEATURE_SUBDIR,
} from "../../constants/rulesync-paths.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { directoryExists, findFilesByGlobs, toPosixPath } from "../../utils/file.js";
import { isRecord } from "../../utils/type-guards.js";
import { RulesyncSkill } from "../skills/rulesync-skill.js";
import { RulesyncCommand } from "./rulesync-command.js";

/**
 * The slash-command trigger an Antigravity command answers to: the
 * `antigravity.trigger` override, then a root-level `trigger`, then a
 * `trigger: /name` line in the body, then `/<filename>`.
 */
export function resolveAntigravityCommandTrigger(rulesyncCommand: RulesyncCommand): string {
  const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
  const antigravityConfig = isRecord(rulesyncFrontmatter.antigravity)
    ? rulesyncFrontmatter.antigravity
    : undefined;

  const antigravityTrigger =
    antigravityConfig && typeof antigravityConfig.trigger === "string"
      ? antigravityConfig.trigger
      : undefined;

  const rootTrigger =
    typeof rulesyncFrontmatter.trigger === "string" ? rulesyncFrontmatter.trigger : undefined;

  const bodyTriggerMatch = rulesyncCommand.getBody().match(/trigger:\s*(\/[\w-]+)/);

  const filenameTrigger = `/${basename(rulesyncCommand.getRelativeFilePath(), ".md")}`;

  return (
    antigravityTrigger ||
    rootTrigger ||
    (bodyTriggerMatch ? bodyTriggerMatch[1] : undefined) ||
    filenameTrigger
  );
}

/**
 * The skill directory name (and `/<name>` slash command) an Antigravity
 * command is emitted under: its resolved trigger, sanitized so it cannot
 * escape the skills directory (e.g. `/../evil`).
 */
export function resolveAntigravityCommandSkillName(rulesyncCommand: RulesyncCommand): string {
  const trigger = resolveAntigravityCommandTrigger(rulesyncCommand);
  const sanitized = trigger.replace(/[^a-zA-Z0-9-_]/g, "-").replace(/^-+|-+$/g, "");
  if (!sanitized) {
    throw new Error(`Invalid trigger: sanitization resulted in empty string from "${trigger}"`);
  }
  return sanitized;
}

/**
 * Whether a rulesync skill named `dirName` takes precedence over an
 * Antigravity command of the same name emitted into `skillsRelativeDirPath`.
 *
 * That is the case when the skill is written to the very same directory: it
 * targets every tool (`*`), or a tool whose skills tree is
 * `skillsRelativeDirPath` in this scope (in the project, `.agents/skills/` is
 * shared by both Antigravity targets and several other tools). A skill aimed
 * only at tools writing elsewhere leaves the command alone. When both the
 * local and the curated tree, or several input roots, hold the skill, the
 * last one wins, as in the skills feature. A skill that cannot be read is
 * assumed to take precedence, so the command never overwrites it.
 */
export async function rulesyncSkillTakesPrecedence({
  inputRoots,
  dirName,
  skillsRelativeDirPath,
  global,
}: {
  inputRoots: readonly string[];
  dirName: string;
  skillsRelativeDirPath: string;
  global: boolean;
}): Promise<boolean> {
  let found: { root: string; relativeDirPath: string } | undefined;
  for (const root of inputRoots) {
    for (const relativeDirPath of [CURATED_SKILLS_FEATURE_SUBDIR, SKILLS_FEATURE_SUBDIR]) {
      if (await directoryExists(join(root, relativeDirPath, dirName))) {
        found = { root, relativeDirPath };
      }
    }
  }
  if (!found) {
    return false;
  }

  let targets: readonly string[];
  try {
    const rulesyncSkill = await RulesyncSkill.fromDir({
      outputRoot: found.root,
      relativeDirPath: found.relativeDirPath,
      dirName,
      global,
    });
    targets = rulesyncSkill.getFrontmatter().targets;
  } catch {
    return true;
  }
  if (targets.includes("*")) {
    return true;
  }

  // Loaded lazily: the skills processor imports the Antigravity skill classes,
  // which import this module.
  const { toolSkillFactories } = await import("../skills/skills-processor.js");
  return targets.some((target) => {
    const factory = toolSkillFactories.get(target as never);
    if (!factory) {
      return false;
    }
    try {
      return factory.class.getSettablePaths({ global }).relativeDirPath === skillsRelativeDirPath;
    } catch {
      // The tool has no skills tree in this scope.
      return false;
    }
  });
}

/**
 * Whether the commands feature emits a skill directory named `dirName` into
 * `skillsRelativeDirPath` for one of `toolTargets`, i.e. a rulesync command
 * targeting them resolves to that name and no rulesync skill of the same name
 * takes precedence over it (see {@link rulesyncSkillTakesPrecedence}).
 *
 * Commands are merged across input roots by relative path with the last root
 * winning, as in the commands feature. Nested commands are flattened before
 * they are named, either to their basename or to their dash-joined path
 * depending on configuration, so both spellings are considered.
 */
export async function antigravityCommandSkillNameExists({
  inputRoots,
  dirName,
  toolTargets,
  skillsRelativeDirPath,
  global,
}: {
  inputRoots: readonly string[];
  dirName: string;
  toolTargets: readonly ToolTarget[];
  skillsRelativeDirPath: string;
  global: boolean;
}): Promise<boolean> {
  const commandsByPath = new Map<string, { root: string; relativeFilePath: string }>();
  for (const root of inputRoots) {
    const commandsDirPath = join(root, COMMANDS_FEATURE_SUBDIR);
    for (const commandPath of await findFilesByGlobs("**/*.md", { cwd: commandsDirPath })) {
      const relativeFilePath = toPosixPath(relative(commandsDirPath, commandPath));
      commandsByPath.set(relativeFilePath, { root, relativeFilePath });
    }
  }

  for (const { root, relativeFilePath } of commandsByPath.values()) {
    let rulesyncCommand: RulesyncCommand;
    try {
      rulesyncCommand = await RulesyncCommand.fromFile({
        outputRoot: root,
        relativeDirPath: COMMANDS_FEATURE_SUBDIR,
        relativeFilePath,
      });
    } catch {
      // An unreadable command is reported by the commands feature itself.
      continue;
    }
    const targets = rulesyncCommand.getFrontmatter().targets ?? ["*"];
    if (!targets.includes("*") && !toolTargets.some((target) => targets.includes(target))) {
      continue;
    }
    const flatSpellings = new Set([
      basename(relativeFilePath),
      relativeFilePath.split("/").join("-"),
    ]);
    const matches = [...flatSpellings].some((flat) => {
      try {
        return (
          resolveAntigravityCommandSkillName(rulesyncCommand.withRelativeFilePath(flat)) === dirName
        );
      } catch {
        return false;
      }
    });
    if (matches) {
      return !(await rulesyncSkillTakesPrecedence({
        inputRoots,
        dirName,
        skillsRelativeDirPath,
        global,
      }));
    }
  }
  return false;
}

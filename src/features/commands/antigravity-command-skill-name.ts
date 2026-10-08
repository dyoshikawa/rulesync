import { basename, join, relative } from "node:path";

import { COMMANDS_FEATURE_SUBDIR } from "../../constants/rulesync-paths.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { findFilesByGlobs, toPosixPath } from "../../utils/file.js";
import { isRecord } from "../../utils/type-guards.js";
import { rulesyncSkillNameExists } from "./command-skill-ownership.js";
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
 * Whether the commands feature emits a skill directory named `dirName` for one
 * of `toolTargets`, i.e. a rulesync command targeting them resolves to that
 * name and no rulesync skill of the same name takes precedence over it.
 *
 * Nested commands are flattened before they are named, either to their
 * basename or to their dash-joined path depending on configuration, so both
 * spellings are considered.
 */
export async function antigravityCommandSkillNameExists({
  inputRoots,
  dirName,
  toolTargets,
}: {
  inputRoots: readonly string[];
  dirName: string;
  toolTargets: readonly ToolTarget[];
}): Promise<boolean> {
  for (const root of inputRoots) {
    const commandsDirPath = join(root, COMMANDS_FEATURE_SUBDIR);
    const commandPaths = await findFilesByGlobs("**/*.md", { cwd: commandsDirPath });
    for (const commandPath of commandPaths) {
      const relativeFilePath = toPosixPath(relative(commandsDirPath, commandPath));
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
            resolveAntigravityCommandSkillName(rulesyncCommand.withRelativeFilePath(flat)) ===
            dirName
          );
        } catch {
          return false;
        }
      });
      if (matches) {
        return !(await rulesyncSkillNameExists({ inputRoots, dirName }));
      }
    }
  }
  return false;
}

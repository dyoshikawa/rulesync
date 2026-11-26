import { isDeepStrictEqual } from "node:util";

import { GITLABDUO_SUBAGENTS_DIR } from "../../constants/gitlabduo-paths.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { isPlainObject } from "../../utils/type-guards.js";
import {
  AGENTS_DIR_SHARED_SUBAGENT_SECTION_KEYS,
  AntigravitySharedSubagent,
} from "./antigravity-shared-subagent.js";
import type {
  ToolSubagent,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * The frontmatter keys the GitLab Duo workspace subagents page documents.
 *
 * @see https://docs.gitlab.com/user/duo_agent_platform/customize/workspace_subagents/
 */
const GITLABDUO_DOCUMENTED_FRONTMATTER_KEYS: ReadonlySet<string> = new Set([
  "name",
  "description",
  "tools",
]);

/**
 * Field limits past which a GitLab Duo session refuses to start (`name`,
 * `description`, prompt) or skips the file (file size).
 *
 * @see https://docs.gitlab.com/user/duo_agent_platform/customize/workspace_subagents/
 */
const GITLABDUO_MAX_NAME_LENGTH = 64;
const GITLABDUO_MAX_DESCRIPTION_LENGTH = 1024;
const GITLABDUO_MAX_PROMPT_LENGTH = 10_000;
const GITLABDUO_MAX_FILE_BYTES = 64 * 1024;

/**
 * GitLab Duo CLI sessions refuse to start when more than this many workspace
 * subagents are valid.
 *
 * @see https://docs.gitlab.com/user/duo_agent_platform/customize/workspace_subagents/
 */
export const GITLABDUO_MAX_SUBAGENTS = 10;

/**
 * GitLab Duo workspace subagent (Developer Flow, GA in GitLab 19.6): a
 * Markdown file with YAML frontmatter (`name`, a required `description`, and
 * `tools`) whose body is the subagent's prompt.
 *
 * Duo reads these only from the project's `.agents/agents/` directory, which
 * the Antigravity targets, Muse Code and the simulated `agentsmd` writer
 * already generate into. The file is therefore rendered exactly like theirs:
 * the `gitlabduo` section is part of the merge every writer of that file
 * performs (at the lowest precedence), so the file on disk does not depend on
 * which target ran last. Duo documents no user-level location, so this target
 * is project-scope only.
 *
 * @see https://docs.gitlab.com/user/duo_agent_platform/customize/workspace_subagents/
 */
export class GitlabduoSubagent extends AntigravitySharedSubagent {
  protected static override getToolTarget(): ToolTarget {
    return "gitlabduo";
  }

  static override getSettablePaths(): ToolSubagentSettablePaths {
    return { relativeDirPath: GITLABDUO_SUBAGENTS_DIR };
  }

  static override fromRulesyncSubagent(
    params: ToolSubagentFromRulesyncSubagentParams,
  ): ToolSubagent {
    const subagent = super.fromRulesyncSubagent(params);
    if (subagent instanceof AntigravitySharedSubagent) {
      this.warnAboutSharedProjectFile({ params, subagent });
      this.warnAboutLimits({ params, subagent });
    }
    return subagent;
  }

  /**
   * The file is shared with the Antigravity and Muse Code writers, so its
   * content cannot be narrowed to what Duo documents. Say so instead when the
   * merged file is likely to make a Duo session behave unexpectedly.
   */
  private static warnAboutSharedProjectFile({
    params,
    subagent,
  }: {
    params: ToolSubagentFromRulesyncSubagentParams;
    subagent: AntigravitySharedSubagent;
  }): void {
    const { logger, rulesyncSubagent } = params;
    const relativeFilePath = rulesyncSubagent.getRelativeFilePath();
    const frontmatter = subagent.getFrontmatter();
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();

    const undocumentedKeys = Object.keys(frontmatter).filter(
      (key) => !GITLABDUO_DOCUMENTED_FRONTMATTER_KEYS.has(key),
    );
    if (undocumentedKeys.length > 0) {
      logger?.warn(
        `GitLab Duo subagent ${relativeFilePath}: the shared .agents/agents/ file carries ` +
          `keys GitLab Duo does not document (${undocumentedKeys.join(", ")}), set in a ` +
          "gitlabduo, musecode or antigravity-* block.",
      );
    }

    const toolsSection = findWinningSection({ rulesyncFrontmatter, key: "tools" });
    if (frontmatter.tools === undefined) {
      logger?.warn(
        `GitLab Duo subagent ${relativeFilePath}: no 'tools' list is set, so GitLab Duo ` +
          "gives the subagent no tools; set 'tools' in the gitlabduo block.",
      );
    } else if (toolsSection !== undefined && toolsSection !== "gitlabduo") {
      logger?.warn(
        `GitLab Duo subagent ${relativeFilePath}: 'tools' in the shared .agents/agents/ file ` +
          `comes from the ${toolsSection} block; a GitLab Duo session fails to start when it ` +
          "names a tool that is not available in Developer Flow.",
      );
    }

    const gitlabduoSection = rulesyncFrontmatter.gitlabduo;
    if (!isPlainObject(gitlabduoSection)) {
      return;
    }
    for (const key of Object.keys(gitlabduoSection)) {
      if (key === "name" || key === "description") {
        continue;
      }
      const overridingSection = findWinningSection({ rulesyncFrontmatter, key });
      if (overridingSection === undefined || overridingSection === "gitlabduo") {
        continue;
      }
      const overridingValue = (rulesyncFrontmatter[overridingSection] as Record<string, unknown>)[
        key
      ];
      if (!isDeepStrictEqual(overridingValue, gitlabduoSection[key])) {
        logger?.warn(
          `GitLab Duo subagent ${relativeFilePath}: '${key}' from the gitlabduo block is ` +
            `overridden by the ${overridingSection} block in the shared .agents/agents/ file.`,
        );
      }
    }
  }

  /** Warn about the field and file limits a GitLab Duo session enforces. */
  private static warnAboutLimits({
    params,
    subagent,
  }: {
    params: ToolSubagentFromRulesyncSubagentParams;
    subagent: AntigravitySharedSubagent;
  }): void {
    const { logger, rulesyncSubagent } = params;
    const relativeFilePath = rulesyncSubagent.getRelativeFilePath();
    const { name, description } = subagent.getFrontmatter();

    const overLimit = [
      { field: "name", length: name.length, max: GITLABDUO_MAX_NAME_LENGTH },
      { field: "description", length: description.length, max: GITLABDUO_MAX_DESCRIPTION_LENGTH },
      { field: "prompt", length: subagent.getBody().length, max: GITLABDUO_MAX_PROMPT_LENGTH },
    ].filter(({ length, max }) => length > max);
    for (const { field, length, max } of overLimit) {
      logger?.warn(
        `GitLab Duo subagent ${relativeFilePath}: the ${field} is ${length} characters, over ` +
          `GitLab Duo's limit of ${max}; a GitLab Duo session fails to start with it.`,
      );
    }

    const fileBytes = Buffer.byteLength(subagent.getFileContent(), "utf8");
    if (fileBytes > GITLABDUO_MAX_FILE_BYTES) {
      logger?.warn(
        `GitLab Duo subagent ${relativeFilePath}: the file is ${fileBytes} bytes, over ` +
          `GitLab Duo's 64 KB limit; GitLab Duo skips it.`,
      );
    }
  }
}

/**
 * The section of the shared `.agents/agents/` merge whose value for `key` ends
 * up in the file: the highest-precedence section that sets it.
 */
function findWinningSection({
  rulesyncFrontmatter,
  key,
}: {
  rulesyncFrontmatter: Record<string, unknown>;
  key: string;
}): ToolTarget | undefined {
  return AGENTS_DIR_SHARED_SUBAGENT_SECTION_KEYS.toReversed().find((sectionKey) => {
    const section = rulesyncFrontmatter[sectionKey];
    return isPlainObject(section) && section[key] !== undefined;
  });
}

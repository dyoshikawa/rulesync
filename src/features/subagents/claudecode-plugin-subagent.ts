import { CLAUDECODE_PLUGIN_AGENTS_DIR } from "../../constants/plugin-paths.js";
import type { Logger } from "../../utils/logger.js";
import { ClaudecodeSubagent, type ClaudecodeSubagentFrontmatter } from "./claudecode-subagent.js";
import type { RulesyncSubagent } from "./rulesync-subagent.js";
import type { ToolSubagentSettablePaths } from "./tool-subagent.js";

/**
 * Claude Code refuses these for plugin-shipped agents "for security reasons",
 * so emitting them leaves the author believing the agent is constrained when it
 * is not. Only these three are dropped: the other fields upstream does not list
 * (e.g. `color`) are merely ignored, with no misleading security posture.
 *
 * @see https://code.claude.com/docs/en/plugins-reference
 */
const PLUGIN_FORBIDDEN_FIELDS = ["hooks", "mcpServers", "permissionMode"] as const;

/** The only `isolation` value plugin agents accept. */
const PLUGIN_ISOLATION_VALUE = "worktree";

export class ClaudecodePluginSubagent extends ClaudecodeSubagent {
  static override isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    const targets = rulesyncSubagent.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("claudecode-plugin");
  }

  static override getSettablePaths(): ToolSubagentSettablePaths {
    return { relativeDirPath: CLAUDECODE_PLUGIN_AGENTS_DIR };
  }

  protected static override sanitizeFrontmatter({
    frontmatter,
    relativeFilePath,
    logger,
  }: {
    frontmatter: ClaudecodeSubagentFrontmatter;
    relativeFilePath: string;
    logger?: Logger;
  }): ClaudecodeSubagentFrontmatter {
    const sanitized: ClaudecodeSubagentFrontmatter = {
      ...super.sanitizeFrontmatter({ frontmatter, relativeFilePath, logger }),
    };

    const dropped = PLUGIN_FORBIDDEN_FIELDS.filter((field) => sanitized[field] !== undefined);
    for (const field of PLUGIN_FORBIDDEN_FIELDS) {
      delete sanitized[field];
    }
    if (dropped.length > 0) {
      logger?.warn(
        `Dropping ${dropped.join(", ")} from claudecode-plugin subagent ${relativeFilePath}: ` +
          `Claude Code does not support these fields for plugin-shipped agents.`,
      );
    }

    if (sanitized.isolation !== undefined && sanitized.isolation !== PLUGIN_ISOLATION_VALUE) {
      logger?.warn(
        `Dropping isolation "${sanitized.isolation}" from claudecode-plugin subagent ${relativeFilePath}: ` +
          `"${PLUGIN_ISOLATION_VALUE}" is the only value Claude Code accepts for plugin-shipped agents.`,
      );
      delete sanitized.isolation;
    }

    return sanitized;
  }
}

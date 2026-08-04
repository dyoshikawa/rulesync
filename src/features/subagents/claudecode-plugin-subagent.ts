import { CLAUDECODE_PLUGIN_AGENTS_DIR } from "../../constants/plugin-paths.js";
import type { Logger } from "../../utils/logger.js";
import { ClaudecodeSubagent, type ClaudecodeSubagentFrontmatter } from "./claudecode-subagent.js";
import type { RulesyncSubagent } from "./rulesync-subagent.js";
import type { ToolSubagentSettablePaths } from "./tool-subagent.js";

/**
 * Claude Code refuses these for plugin-shipped agents "for security reasons",
 * so emitting them leaves the author believing the agent is constrained when it
 * is not.
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
    // Claude Code namespaces plugin agents as `<plugin>:<agent>`, so a colon in
    // the authored name makes the agent fail to load rather than merely look odd.
    if (frontmatter.name.includes(":")) {
      throw new Error(
        `Invalid claudecode-plugin subagent name "${frontmatter.name}" in ${relativeFilePath}: ` +
          `":" is reserved for plugin namespacing and Claude Code rejects agent names containing it.`,
      );
    }

    const {
      hooks: _hooks,
      mcpServers: _mcpServers,
      permissionMode: _permissionMode,
      isolation,
      ...rest
    } = frontmatter;

    const dropped = PLUGIN_FORBIDDEN_FIELDS.filter((field) => frontmatter[field] !== undefined);
    if (dropped.length > 0) {
      logger?.warn(
        `Dropping ${dropped.join(", ")} from claudecode-plugin subagent ${relativeFilePath}: ` +
          `Claude Code does not support these fields for plugin-shipped agents.`,
      );
    }

    if (isolation !== undefined && isolation !== PLUGIN_ISOLATION_VALUE) {
      logger?.warn(
        `Dropping isolation "${isolation}" from claudecode-plugin subagent ${relativeFilePath}: ` +
          `"${PLUGIN_ISOLATION_VALUE}" is the only value Claude Code accepts for plugin-shipped agents.`,
      );
    }

    return {
      ...rest,
      ...(isolation === PLUGIN_ISOLATION_VALUE && { isolation }),
    };
  }
}

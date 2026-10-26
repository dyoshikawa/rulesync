import { z } from "zod/mini";

import { COMMANDCODE_AGENTS_DIR_PATH } from "../../constants/commandcode-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import type { Logger } from "../../utils/logger.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { FrontmatterMarkdownToolSubagent } from "./frontmatter-markdown-subagent.js";
import type {
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

// Command Code custom agent frontmatter. `name` is required; the remaining
// keys are the documented optional fields. `tools` and `disallowedTools`
// accept either a comma/space-separated string or a YAML array (`"*"` grants
// every tool). Unknown keys pass through so newer Command Code releases keep
// round-tripping.
// @see https://commandcode.ai/docs/custom-agents
const CommandcodeSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
  tools: z.optional(z.union([z.string(), z.array(z.string())])),
  disallowedTools: z.optional(z.union([z.string(), z.array(z.string())])),
  model: z.optional(z.string()),
  reasoningEffort: z.optional(z.string()),
  maxTurns: z.optional(z.number()),
  permissionMode: z.optional(z.string()),
  background: z.optional(z.boolean()),
  showOutput: z.optional(z.boolean()),
});

type CommandcodeSubagentFrontmatter = z.infer<typeof CommandcodeSubagentFrontmatterSchema>;

/**
 * Names Command Code's built-in agents own. The loader runs the frontmatter
 * `name` (or the file stem when it has none) through `sanitizeAgentName`,
 * which rewrites every character outside `[a-zA-Z0-9_-]` to `_`, lowercases
 * it, and skips the file outright when the result is one of these
 * (`isReservedAgentName`) — with no message. Verified in the `command-code`
 * 1.54.2 bundle.
 * @see https://commandcode.ai/docs/agents
 */
const COMMANDCODE_RESERVED_AGENT_NAMES: ReadonlySet<string> = new Set([
  "explore",
  "plan",
  "review",
  "general",
]);

/** The name Command Code compares against its reserved list. */
function toCommandcodeAgentName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

/**
 * The subagent is still generated under the reserved name — the name is the
 * user's to change, and a rename here would make it diverge from the other
 * targets — but Command Code would drop it without a visible word, so say so
 * now (the same courtesy `VibeSkill` extends to its reserved skill names).
 */
function warnAboutReservedAgentName({
  name,
  relativeFilePath,
  logger,
}: {
  name: string;
  relativeFilePath: string;
  logger: Logger | undefined;
}): void {
  if (!COMMANDCODE_RESERVED_AGENT_NAMES.has(toCommandcodeAgentName(name))) {
    return;
  }
  logger?.warn(
    `Command Code subagent ${relativeFilePath}: the name ${quoteValueForWarning(name)} is ` +
      `reserved for a Command Code built-in agent, so Command Code ignores a custom agent ` +
      `by that name when it loads agents. Rename the subagent for it to be available in ` +
      `Command Code.`,
  );
}

/**
 * Command Code custom agent: a Markdown file with YAML frontmatter under
 * `.commandcode/agents/` (project) or `~/.commandcode/agents/` (user); the
 * body is the agent's system prompt.
 *
 * @see https://commandcode.ai/docs/custom-agents
 */
export class CommandcodeSubagent extends FrontmatterMarkdownToolSubagent<CommandcodeSubagentFrontmatter> {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    // Both scopes share the same relative path; the home-directory root is
    // applied by the generate pipeline in global mode.
    return {
      relativeDirPath: COMMANDCODE_AGENTS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "commandcode";
  }

  protected static override getFrontmatterSchema() {
    return CommandcodeSubagentFrontmatterSchema;
  }

  protected static override toToolFrontmatter({
    rulesyncSubagent,
    logger,
  }: Pick<
    ToolSubagentFromRulesyncSubagentParams,
    "rulesyncSubagent" | "logger"
  >): CommandcodeSubagentFrontmatter {
    const commandcodeSubagentFrontmatter = super.toToolFrontmatter({ rulesyncSubagent, logger });
    warnAboutReservedAgentName({
      name: commandcodeSubagentFrontmatter.name,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      logger,
    });
    return commandcodeSubagentFrontmatter;
  }
}

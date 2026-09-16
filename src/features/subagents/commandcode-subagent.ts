import { join } from "node:path";

import { z } from "zod/mini";

import { COMMANDCODE_AGENTS_DIR_PATH } from "../../constants/commandcode-paths.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import type { Logger } from "../../utils/logger.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
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

type CommandcodeSubagentParams = {
  frontmatter: CommandcodeSubagentFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent"> & { fileContent?: string };

/**
 * Command Code custom agent: a Markdown file with YAML frontmatter under
 * `.commandcode/agents/` (project) or `~/.commandcode/agents/` (user); the
 * body is the agent's system prompt.
 *
 * @see https://commandcode.ai/docs/custom-agents
 */
export class CommandcodeSubagent extends ToolSubagent {
  private readonly frontmatter: CommandcodeSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, fileContent, ...rest }: CommandcodeSubagentParams) {
    if (rest.validate !== false) {
      const result = CommandcodeSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      fileContent: fileContent ?? stringifyFrontmatter(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    // Both scopes share the same relative path; the home-directory root is
    // applied by the generate pipeline in global mode.
    return {
      relativeDirPath: COMMANDCODE_AGENTS_DIR_PATH,
    };
  }

  getFrontmatter(): CommandcodeSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, ...rest } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name,
      description,
      commandcode: {
        ...rest,
      },
    };

    return new RulesyncSubagent({
      outputRoot: ".",
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true,
    });
  }

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
    logger,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const commandcodeSection = rulesyncFrontmatter.commandcode ?? {};

    const commandcodeSubagentFrontmatter: CommandcodeSubagentFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...commandcodeSection,
    };
    warnAboutReservedAgentName({
      name: commandcodeSubagentFrontmatter.name,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      logger,
    });

    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, commandcodeSubagentFrontmatter, {
      avoidBlockScalars: true,
    });
    const paths = this.getSettablePaths({ global });

    return new CommandcodeSubagent({
      outputRoot,
      frontmatter: commandcodeSubagentFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent,
      validate,
      global,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = CommandcodeSubagentFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
        ),
      };
    }
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "commandcode",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<CommandcodeSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = CommandcodeSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new CommandcodeSubagent({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
      global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): CommandcodeSubagent {
    return new CommandcodeSubagent({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { name: "", description: "" },
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}

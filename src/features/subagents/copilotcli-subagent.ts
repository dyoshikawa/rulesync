import { join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * Schema for GitHub Copilot CLI custom-agent frontmatter.
 *
 * Reference: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli
 *            https://docs.github.com/en/copilot/reference/custom-agents-configuration
 *
 * Per the configuration docs:
 *  - `description` is required.
 *  - `name`, `target`, `tools`, `model`, `disable-model-invocation`,
 *    `user-invocable`, `mcp-servers`, and `metadata` are optional.
 *
 * `looseObject` is used so that future additional fields are passed through
 * unchanged (consistent with the rest of rulesync's frontmatter schemas).
 */
const CopilotCliSubagentFrontmatterSchema = z.looseObject({
  description: z.string(),
  name: z.optional(z.string()),
  target: z.optional(z.string()),
  tools: z.optional(z.union([z.string(), z.array(z.string())])),
  model: z.optional(z.string()),
  "disable-model-invocation": z.optional(z.boolean()),
  "user-invocable": z.optional(z.boolean()),
  "mcp-servers": z.optional(z.record(z.string(), z.unknown())),
  metadata: z.optional(z.record(z.string(), z.unknown())),
});

type CopilotCliSubagentFrontmatter = z.infer<typeof CopilotCliSubagentFrontmatterSchema>;

type CopilotCliSubagentParams = {
  frontmatter: CopilotCliSubagentFrontmatter;
  body: string;
} & AiFileParams;

/**
 * Translate a rulesync subagent filename (`<stem>.md`) into the Copilot CLI
 * convention `<stem>.agent.md`. If the input already uses the `.agent.md`
 * suffix, it is returned unchanged.
 */
const toCopilotCliAgentFilePath = (relativeFilePath: string): string => {
  if (relativeFilePath.endsWith(".agent.md")) {
    return relativeFilePath;
  }
  if (relativeFilePath.endsWith(".md")) {
    return relativeFilePath.replace(/\.md$/, ".agent.md");
  }
  return relativeFilePath;
};

/**
 * Reverse of {@link toCopilotCliAgentFilePath} — strip the `.agent.md`
 * suffix down to the plain `.md` rulesync uses internally.
 */
const toRulesyncFilePath = (relativeFilePath: string): string => {
  if (relativeFilePath.endsWith(".agent.md")) {
    return relativeFilePath.replace(/\.agent\.md$/, ".md");
  }
  return relativeFilePath;
};

/**
 * `copilotcli` is the GitHub Copilot CLI tool target (distinct from `copilot`,
 * which targets Copilot inside IDEs). Custom agents are stored at:
 *
 *   - Project scope:  `<project>/.github/agents/*.agent.md`
 *   - User/global:    `~/.copilot/agents/*.agent.md`
 *
 * "If you have custom agents with the same name in both locations, the one
 * in your home directory will be used." (GitHub docs)
 */
export class CopilotcliSubagent extends ToolSubagent {
  private readonly frontmatter: CopilotCliSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: CopilotCliSubagentParams) {
    if (rest.validate !== false) {
      const result = CopilotCliSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({ ...rest });
    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolSubagentSettablePaths {
    if (global) {
      // Global agents live under the home dir, in `.copilot/agents/`.
      // The harness sets `outputRoot` to the home dir for `--global`.
      return { relativeDirPath: join(".copilot", "agents") };
    }
    return { relativeDirPath: join(".github", "agents") };
  }

  getFrontmatter(): CopilotCliSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, ...rest } = this.frontmatter;

    // Rulesync's canonical subagent frontmatter requires `name` (which Copilot
    // CLI considers optional). When a Copilot CLI agent omits `name`, we fall
    // back to deriving it from the filename's stem so the round-trip stays
    // closed.
    const fallbackName = (() => {
      const filePath = this.getRelativeFilePath();
      const base = filePath.replace(/\.agent\.md$/, "").replace(/\.md$/, "");
      return base.split(/[\\/]/).pop() ?? "agent";
    })();

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name: name ?? fallbackName,
      description,
      copilotcli: {
        ...(name === undefined ? {} : { name }),
        ...rest,
      },
    };

    return new RulesyncSubagent({
      outputRoot: ".",
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: toRulesyncFilePath(this.getRelativeFilePath()),
      validate: true,
    });
  }

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const copilotCliSection = rulesyncFrontmatter.copilotcli ?? {};

    // Frontmatter precedence (per .claude/rules/feature-change-guidelines.md):
    //   tool-specific values override rulesync values.
    const rawFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description ?? "",
      ...copilotCliSection,
    };

    const result = CopilotCliSubagentFrontmatterSchema.safeParse(rawFrontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid copilotcli subagent frontmatter in ${rulesyncSubagent.getRelativeFilePath()}: ${formatError(result.error)}`,
      );
    }

    const copilotCliFrontmatter = result.data;

    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, copilotCliFrontmatter);
    const paths = this.getSettablePaths({ global });

    return new CopilotcliSubagent({
      outputRoot,
      frontmatter: copilotCliFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: toCopilotCliAgentFilePath(rulesyncSubagent.getRelativeFilePath()),
      fileContent,
      validate,
      global,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = CopilotCliSubagentFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    }
    return {
      success: false,
      error: new Error(
        `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
      ),
    };
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "copilotcli",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<CopilotcliSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = CopilotCliSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new CopilotcliSubagent({
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
  }: ToolSubagentForDeletionParams): CopilotcliSubagent {
    return new CopilotcliSubagent({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}

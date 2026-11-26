import { basename, dirname, extname, join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { THEIA_AGENT_FILE_NAME, THEIA_AGENTS_DIR_PATH } from "../../constants/theia-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  validateFrontmatterSchema,
} from "../../utils/frontmatter.js";
import { isRecord } from "../../utils/type-guards.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  parseGeneratedSubagentFrontmatter,
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * `agent.md` frontmatter. Theia skips an agent whose `name`, `description` or
 * `defaultLLM` is missing or not a string, so all three are required here;
 * `showInChat` is optional. Unknown keys are preserved.
 *
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/ai-core/src/browser/frontend-prompt-customization-service.ts
 */
const TheiaSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  defaultLLM: z.string(),
  showInChat: z.optional(z.boolean()),
});

export type TheiaSubagentFrontmatter = z.infer<typeof TheiaSubagentFrontmatterSchema>;

export type TheiaSubagentParams = {
  frontmatter: TheiaSubagentFrontmatter;
  body: string;
} & AiFileParams;

/**
 * The language model Theia's "Add Custom Agent" template writes, used when the
 * rulesync subagent does not choose one through `theia.defaultLLM`.
 */
export const THEIA_DEFAULT_LLM = "default/universal";

/**
 * Keys of the `theia:` section that do not reach `agent.md`: the folder name is
 * the agent id, and Theia skips an agent whose frontmatter `id` disagrees.
 */
const EXCLUDED_THEIA_SECTION_KEYS = ["id"];

/**
 * Subagent generator for Eclipse Theia AI custom agents.
 *
 * Each agent lives in its own folder, `.agents/agents/<id>/agent.md`; the
 * folder name is the agent id, the YAML frontmatter holds `name`,
 * `description` and `defaultLLM`, and the body is the agent's default prompt.
 * Theia reads only the immediate subfolders of `agents/`, so the flat
 * `<name>.md` files other targets write into the same `.agents/agents/` root
 * are not agents to Theia, and this target's `*\/agent.md` pattern leaves them
 * alone. Global agents live in the product-specific global prompt directory,
 * which is not documented, so only the project scope is supported.
 *
 * @see https://theia-ide.org/docs/user_ai/#custom-agents
 */
export class TheiaSubagent extends ToolSubagent {
  private readonly frontmatter: TheiaSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: TheiaSubagentParams) {
    if (rest.validate !== false) {
      const result = TheiaSubagentFrontmatterSchema.safeParse(frontmatter);
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
      throw new Error("TheiaSubagent does not support global mode.");
    }
    return { relativeDirPath: THEIA_AGENTS_DIR_PATH };
  }

  getFrontmatter(): TheiaSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, defaultLLM, ...rest } = this.frontmatter;

    const theiaSection: Record<string, unknown> = {
      // The default model is what generation writes anyway, so it is only
      // kept when the agent chose another one.
      ...(defaultLLM !== THEIA_DEFAULT_LLM && { defaultLLM }),
      ...TheiaSubagent.filterToolSpecificSection(rest, EXCLUDED_THEIA_SECTION_KEYS),
    };

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name,
      description,
      ...(Object.keys(theiaSection).length > 0 && { theia: theiaSection }),
    };

    return new RulesyncSubagent({
      outputRoot: ".",
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      // The tool-side path is `<id>/agent.md`; the rulesync file is a flat
      // `<id>.md`, so the file name comes from the parent directory.
      relativeFilePath: `${this.getAgentId()}.md`,
      validate: true,
    });
  }

  /** The agent id: the folder `agent.md` sits in. */
  private getAgentId(): string {
    const relativeFilePath = this.getRelativeFilePath();
    const dir = dirname(relativeFilePath);
    if (dir && dir !== ".") {
      return basename(dir);
    }
    return basename(relativeFilePath, extname(relativeFilePath));
  }

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const rawTheiaSection = rulesyncFrontmatter.theia;
    const theiaSection = this.filterToolSpecificSection(
      isRecord(rawTheiaSection) ? rawTheiaSection : {},
      EXCLUDED_THEIA_SECTION_KEYS,
    );

    const rawFrontmatter = {
      name: rulesyncFrontmatter.name,
      // Theia ignores an agent without a string `description`.
      description: rulesyncFrontmatter.description ?? "",
      defaultLLM: THEIA_DEFAULT_LLM,
      ...theiaSection,
    };

    const theiaFrontmatter = parseGeneratedSubagentFrontmatter({
      schema: TheiaSubagentFrontmatterSchema,
      frontmatter: rawFrontmatter,
      toolTarget: "theia",
      rulesyncSubagent,
    });

    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, theiaFrontmatter);
    const paths = this.getSettablePaths({ global });

    // The rulesync subagent is a flat `<name>.md`; Theia requires a
    // folder-per-agent layout, so emit `<name>/agent.md`.
    const agentId = basename(
      rulesyncSubagent.getRelativeFilePath(),
      extname(rulesyncSubagent.getRelativeFilePath()),
    );

    return new TheiaSubagent({
      outputRoot,
      frontmatter: theiaFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: join(agentId, THEIA_AGENT_FILE_NAME),
      fileContent,
      validate,
      global,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    return validateFrontmatterSchema({
      schema: TheiaSubagentFrontmatterSchema,
      frontmatter: this.frontmatter,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
    });
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "theia",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<TheiaSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = TheiaSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new TheiaSubagent({
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
  }: ToolSubagentForDeletionParams): TheiaSubagent {
    return new TheiaSubagent({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { name: "", description: "", defaultLLM: "" },
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}

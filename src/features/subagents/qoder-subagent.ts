import { join } from "node:path";

import { z } from "zod/mini";

import { QODER_AGENTS_DIR_PATH } from "../../constants/qoder-paths.js";
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
 * Frontmatter of a Qoder subagent. `name` and `description` are required by
 * Qoder; the other documented fields are typed loosely and unknown keys are
 * kept (looseObject) so a round trip never drops them.
 *
 * @see https://docs.qoder.com/en/cli/04-extending-qoder-cli/subagent
 */
export const QoderSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
  model: z.optional(z.string()),
  // A comma-separated string or a string array (inline or block list).
  tools: z.optional(z.union([z.string(), z.array(z.string())])),
  disallowedTools: z.optional(z.union([z.string(), z.array(z.string())])),
  permissionMode: z.optional(z.string()),
  maxTurns: z.optional(z.number()),
  timeoutMins: z.optional(z.number()),
  color: z.optional(z.string()),
  skills: z.optional(z.union([z.string(), z.array(z.string())])),
  isolation: z.optional(z.string()),
  mcpServers: z.optional(z.unknown()),
  hooks: z.optional(z.unknown()),
});

export type QoderSubagentFrontmatter = z.infer<typeof QoderSubagentFrontmatterSchema>;

export type QoderSubagentParams = {
  frontmatter: QoderSubagentFrontmatter;
  body: string;
} & AiFileParams;

/**
 * Subagent generator for Qoder.
 *
 * Qoder reads Markdown subagents with YAML frontmatter from `.qoder/agents/`
 * (project) and `~/.qoder/agents/` (user); the body is the system prompt.
 * The subagent's identity is the frontmatter `name`, not the file name.
 * rulesync writes `name` and `description` and spreads the `qoder` section
 * (model, tools, permissionMode, ...) on top.
 *
 * @see https://docs.qoder.com/en/cli/04-extending-qoder-cli/subagent
 */
export class QoderSubagent extends ToolSubagent {
  private readonly frontmatter: QoderSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: QoderSubagentParams) {
    if (rest.validate !== false) {
      const result = QoderSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  // Both scopes share the same relative path; the home-directory root is
  // applied by the processor in global mode.
  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: QODER_AGENTS_DIR_PATH,
    };
  }

  getFrontmatter(): QoderSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  override getImportIdentity(): string {
    return this.frontmatter.name;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, ...restFields } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"],
      name,
      description,
      ...(Object.keys(restFields).length > 0 && { qoder: restFields }),
    };

    return new RulesyncSubagent({
      outputRoot: ".", // RulesyncSubagent outputRoot is always the project root directory
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
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const qoderSection = this.filterToolSpecificSection(rulesyncFrontmatter.qoder ?? {}, [
      "name",
      "description",
    ]);

    const result = QoderSubagentFrontmatterSchema.safeParse({
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...qoderSection,
    });
    if (!result.success) {
      throw new Error(
        `Invalid qoder subagent frontmatter in ${rulesyncSubagent.getRelativeFilePath()}: ${formatError(result.error)}`,
      );
    }

    const body = rulesyncSubagent.getBody();

    return new QoderSubagent({
      outputRoot,
      frontmatter: result.data,
      body,
      relativeDirPath: this.getSettablePaths({ global }).relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent: stringifyFrontmatter(body, result.data),
      validate,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = QoderSubagentFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "qoder",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<QoderSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);

    const result = QoderSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new QoderSubagent({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: body.trim(),
      fileContent,
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): QoderSubagent {
    return new QoderSubagent({
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

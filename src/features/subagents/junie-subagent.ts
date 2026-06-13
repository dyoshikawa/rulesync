import { join } from "node:path";

import { z } from "zod/mini";

import { JUNIE_AGENTS_DIR_PATH } from "../../constants/junie-paths.js";
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
 * Frontmatter for Junie CLI custom subagents (`.junie/agents/*.md`). Junie
 * documents these fields; the schema stays loose (and the list fields accept a
 * single string or an array) for forward compatibility.
 *
 * @see https://junie.jetbrains.com/docs/junie-cli-subagents.html
 */
export const JunieSubagentFrontmatterSchema = z.looseObject({
  name: z.optional(z.string()),
  description: z.string(),
  // Tool access controls.
  tools: z.optional(z.union([z.string(), z.array(z.string())])),
  disallowedTools: z.optional(z.union([z.string(), z.array(z.string())])),
  // MCP servers the subagent may use.
  mcpServers: z.optional(z.union([z.string(), z.array(z.string())])),
  // Model and reasoning controls (`reasoningLevel`: low | medium | high).
  model: z.optional(z.string()),
  reasoningLevel: z.optional(z.string()),
  maxTurns: z.optional(z.number()),
  // Agent Skills the subagent should utilize.
  skills: z.optional(z.union([z.string(), z.array(z.string())])),
  // Whether the subagent accepts a prompt argument.
  allowPromptArgument: z.optional(z.boolean()),
});

export type JunieSubagentFrontmatter = z.infer<typeof JunieSubagentFrontmatterSchema>;

export type JunieSubagentParams = {
  frontmatter: JunieSubagentFrontmatter;
  body: string;
} & AiFileParams;

export class JunieSubagent extends ToolSubagent {
  private readonly frontmatter: JunieSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: JunieSubagentParams) {
    if (rest.validate !== false) {
      const result = JunieSubagentFrontmatterSchema.safeParse(frontmatter);
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

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    // Junie subagents use the same relative path for both project and global modes.
    // The actual location differs based on outputRoot:
    // - Project mode: {process.cwd()}/.junie/agents/
    // - Global mode: {getHomeDirectory()}/.junie/agents/
    return {
      relativeDirPath: JUNIE_AGENTS_DIR_PATH,
    };
  }

  getFrontmatter(): JunieSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, ...restFields } = this.frontmatter;

    const junieSection: Record<string, unknown> = {
      ...restFields,
    };

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name: name ?? this.getRelativeFilePath().replace(/\.md$/, ""),
      description,
      ...(Object.keys(junieSection).length > 0 && { junie: junieSection }),
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
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const junieSection = this.filterToolSpecificSection(rulesyncFrontmatter.junie ?? {}, [
      "name",
      "description",
    ]);

    const rawJunieFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...junieSection,
    };

    const result = JunieSubagentFrontmatterSchema.safeParse(rawJunieFrontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid junie subagent frontmatter in ${rulesyncSubagent.getRelativeFilePath()}: ${formatError(result.error)}`,
      );
    }

    const junieFrontmatter = result.data;
    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, junieFrontmatter);

    const paths = this.getSettablePaths({ global });

    return new JunieSubagent({
      outputRoot,
      frontmatter: junieFrontmatter,
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

    const result = JunieSubagentFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "junie",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<JunieSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = JunieSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new JunieSubagent({
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
  }: ToolSubagentForDeletionParams): JunieSubagent {
    return new JunieSubagent({
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

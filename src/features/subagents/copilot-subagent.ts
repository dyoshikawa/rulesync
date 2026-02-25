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

const REQUIRED_TOOL = "agent/runSubagent";

const CopilotSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  tools: z.optional(z.union([z.string(), z.array(z.string())])),
});

type CopilotSubagentFrontmatter = z.infer<typeof CopilotSubagentFrontmatterSchema>;

type CopilotSubagentParams = {
  frontmatter: CopilotSubagentFrontmatter;
  body: string;
} & AiFileParams;

const normalizeTools = (tools: string | string[] | undefined): string[] => {
  if (!tools) {
    return [];
  }

  return Array.isArray(tools) ? tools : [tools];
};

const ensureRequiredTool = (tools: string[]): string[] => {
  const mergedTools = new Set([REQUIRED_TOOL, ...tools]);
  return Array.from(mergedTools);
};

export class CopilotSubagent extends ToolSubagent {
  private readonly frontmatter: CopilotSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: CopilotSubagentParams) {
    if (rest.validate !== false) {
      const result = CopilotSubagentFrontmatterSchema.safeParse(frontmatter);
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
    return {
      relativeDirPath: join(".github", "agents"),
    };
  }

  getFrontmatter(): CopilotSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, tools, ...rest } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name,
      description,
      copilot: {
        ...(tools && { tools }),
        ...rest,
      },
    };

    return new RulesyncSubagent({
      baseDir: ".", // RulesyncCommand baseDir is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true,
    });
  }

  static fromRulesyncSubagent({
    baseDir = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const copilotSection = rulesyncFrontmatter.copilot ?? {};

    const toolsField = copilotSection.tools;
    const userTools = normalizeTools(
      Array.isArray(toolsField) || typeof toolsField === "string" ? toolsField : undefined,
    );
    const mergedTools = ensureRequiredTool(userTools);

    const copilotFrontmatter: CopilotSubagentFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...copilotSection,
      ...(mergedTools.length > 0 && { tools: mergedTools }),
    };

    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, copilotFrontmatter);
    const paths = this.getSettablePaths({ global });

    return new CopilotSubagent({
      baseDir: baseDir,
      frontmatter: copilotFrontmatter,
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

    const result = CopilotSubagentFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "copilot",
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<CopilotSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = CopilotSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new CopilotSubagent({
      baseDir: baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
      global,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): CopilotSubagent {
    return new CopilotSubagent({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { name: "", description: "" },
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}

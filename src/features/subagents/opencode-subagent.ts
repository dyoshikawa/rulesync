import { basename, join } from "node:path";

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

export const OpenCodeSubagentFrontmatterSchema = z.looseObject({
  description: z.string(),
  mode: z._default(z.string(), "subagent"),
  name: z.optional(z.string()),
});

export type OpenCodeSubagentFrontmatter = z.infer<typeof OpenCodeSubagentFrontmatterSchema>;

export type OpenCodeSubagentParams = {
  frontmatter: OpenCodeSubagentFrontmatter;
  body: string;
} & AiFileParams;

export class OpenCodeSubagent extends ToolSubagent {
  private readonly frontmatter: OpenCodeSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: OpenCodeSubagentParams) {
    if (rest.validate !== false) {
      const result = OpenCodeSubagentFrontmatterSchema.safeParse(frontmatter);
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

  static getSettablePaths({
    global = false,
  }: {
    global?: boolean;
  } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: global ? join(".config", "opencode", "agent") : join(".opencode", "agent"),
    };
  }

  getFrontmatter(): OpenCodeSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { description, mode, name, ...opencodeSection } = this.frontmatter;
    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name: name ?? basename(this.getRelativeFilePath(), ".md"),
      description,
      opencode: { mode, ...opencodeSection },
    };

    return new RulesyncSubagent({
      baseDir: ".", // RulesyncSubagent baseDir is always the project root directory
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
    const opencodeSection = rulesyncFrontmatter.opencode ?? {};

    const opencodeFrontmatter: OpenCodeSubagentFrontmatter = {
      ...opencodeSection,
      description: rulesyncFrontmatter.description,
      mode: typeof opencodeSection.mode === "string" ? opencodeSection.mode : "subagent",
      ...(rulesyncFrontmatter.name && { name: rulesyncFrontmatter.name }),
    };

    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, opencodeFrontmatter);
    const paths = this.getSettablePaths({ global });

    return new OpenCodeSubagent({
      baseDir,
      frontmatter: opencodeFrontmatter,
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

    const result = OpenCodeSubagentFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "opencode",
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<OpenCodeSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = OpenCodeSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new OpenCodeSubagent({
      baseDir,
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
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): OpenCodeSubagent {
    return new OpenCodeSubagent({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "", mode: "subagent" },
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}

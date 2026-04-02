import { basename, join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import { ToolSubagent } from "./tool-subagent.js";

export const OpenCodeStyleSubagentFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  mode: z._default(z.string(), "subagent"),
  name: z.optional(z.string()),
});

export type OpenCodeStyleSubagentFrontmatter = z.infer<
  typeof OpenCodeStyleSubagentFrontmatterSchema
>;

export type OpenCodeStyleSubagentParams = {
  frontmatter: OpenCodeStyleSubagentFrontmatter;
  body: string;
} & AiFileParams;

export abstract class OpenCodeStyleSubagent extends ToolSubagent {
  protected readonly frontmatter: OpenCodeStyleSubagentFrontmatter;
  protected readonly body: string;

  constructor({ frontmatter, body, ...rest }: OpenCodeStyleSubagentParams) {
    if (rest.validate !== false) {
      const result = OpenCodeStyleSubagentFrontmatterSchema.safeParse(frontmatter);
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

  protected abstract getToolTarget(): Extract<ToolTarget, "opencode" | "kilo">;

  getFrontmatter(): OpenCodeStyleSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { description, mode, name, ...toolSection } = this.frontmatter;
    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name: name ?? basename(this.getRelativeFilePath(), ".md"),
      description,
      [this.getToolTarget()]: { mode, ...toolSection },
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

  validate(): ValidationResult {
    const result = OpenCodeStyleSubagentFrontmatterSchema.safeParse(this.frontmatter);
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
}

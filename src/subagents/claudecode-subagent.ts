import { z } from "zod/mini";
import { AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { ToolSubagent } from "./tool-subagent.js";

export const ClaudecodeSubagentFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  model: z.optional(z.enum(["opus", "sonnet", "haiku", "inherit"])),
});

export type ClaudecodeSubagentFrontmatter = z.infer<typeof ClaudecodeSubagentFrontmatterSchema>;

export interface ClaudecodeSubagentParams extends AiFileParams {
  frontmatter: ClaudecodeSubagentFrontmatter;
  body: string;
}

export class ClaudecodeSubagent extends ToolSubagent {
  private readonly frontmatter: ClaudecodeSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: ClaudecodeSubagentParams) {
    super({
      ...rest,
    });

    if (rest.validate) {
      const result = ClaudecodeSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw result.error;
      }
    }

    this.frontmatter = frontmatter;
    this.body = body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    return new RulesyncSubagent({
      frontmatter: {
        targets: ["claudecode"],
        title: this.frontmatter.name,
        description: this.frontmatter.description,
      },
      body: this.body,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: this.fileContent,
    });
  }

  fromRulesyncSubagent(_rulesyncSubagent: RulesyncSubagent): ToolSubagent {
    throw new Error("Method not implemented.");
  }

  validate(): ValidationResult {
    const result = ClaudecodeSubagentFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return { success: false, error: result.error };
    }
  }
}

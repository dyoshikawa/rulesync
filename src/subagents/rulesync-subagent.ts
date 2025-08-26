import { z } from "zod/mini";
import { ValidationResult } from "../types/ai-file.js";
import { RulesyncFile, RulesyncFileParams } from "../types/rulesync-file.js";
import { ToolTargetsSchema } from "../types/tool-targets.js";

export const RulesyncSubagentFrontmatterSchema = z.object({
  targets: ToolTargetsSchema,
  title: z.string(),
  description: z.string(),
  claudecode: z.optional(
    z.object({
      model: z.optional(z.enum(["opus", "sonnet", "haiku", "inherit"])),
    }),
  ),
});

export type RulesyncSubagentFrontmatter = z.infer<typeof RulesyncSubagentFrontmatterSchema>;

export interface RulesyncSubagentParams extends RulesyncFileParams {
  frontmatter: RulesyncSubagentFrontmatter;
}

export class RulesyncSubagent extends RulesyncFile {
  private readonly frontmatter: RulesyncSubagentFrontmatter;

  constructor({ frontmatter, ...rest }: RulesyncSubagentParams) {
    super({
      ...rest,
    });

    if (rest.validate) {
      const result = RulesyncSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw result.error;
      }
    }

    this.frontmatter = frontmatter;
  }

  getFrontmatter(): RulesyncSubagentFrontmatter {
    return this.frontmatter;
  }

  validate(): ValidationResult {
    const result = RulesyncSubagentFrontmatterSchema.safeParse(this.frontmatter);

    if (result.success) {
      return { success: true, error: null };
    } else {
      return { success: false, error: result.error };
    }
  }
}

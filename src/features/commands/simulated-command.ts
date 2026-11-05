import { z } from "zod/mini";

import { FrontmatterMarkdownToolCommand } from "./frontmatter-markdown-command.js";
import type { RulesyncCommandFrontmatter } from "./rulesync-command.js";

const SimulatedCommandFrontmatterSchema = z.object({
  description: z.optional(z.string()),
});

export type SimulatedCommandFrontmatter = z.infer<typeof SimulatedCommandFrontmatterSchema>;

export abstract class SimulatedCommand extends FrontmatterMarkdownToolCommand<SimulatedCommandFrontmatter> {
  protected static override getFrontmatterSchema() {
    return SimulatedCommandFrontmatterSchema;
  }

  protected static override toToolFrontmatter(
    rulesyncFrontmatter: RulesyncCommandFrontmatter,
  ): SimulatedCommandFrontmatter {
    return {
      description: rulesyncFrontmatter.description,
    };
  }

  protected override toRulesyncFrontmatter(): RulesyncCommandFrontmatter {
    throw new Error("Not implemented because it is a SIMULATED file.");
  }
}

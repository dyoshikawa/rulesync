import { z } from "zod/mini";
import type { ToolTarget } from "./tool-targets.js";

export const CommandFrontmatterSchema = z.object({
  description: z.optional(z.string()),
});

export type CommandFrontmatter = z.infer<typeof CommandFrontmatterSchema>;

export interface ParsedCommand {
  frontmatter: CommandFrontmatter;
  content: string;
  filename: string;
  filepath: string;
}

export interface CommandOutput {
  tool: ToolTarget;
  filepath: string;
  content: string;
}

import { z } from "zod/mini";
import { BaseFrontmatterSchema, type Output, type ParsedContent } from "./shared.js";

export const CommandFrontmatterSchema = BaseFrontmatterSchema;

export type CommandFrontmatter = z.infer<typeof CommandFrontmatterSchema>;

export interface ParsedCommand extends ParsedContent {
  frontmatter: CommandFrontmatter;
}

export type CommandOutput = Output;

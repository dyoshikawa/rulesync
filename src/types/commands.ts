import { z } from "zod/mini";
import { BaseFrontmatterSchema, type Output, type ParsedContent } from "./shared.js";

export const CommandFrontmatterSchema = BaseFrontmatterSchema;

type CommandFrontmatter = z.infer<typeof CommandFrontmatterSchema>;

export type ParsedCommand = {
  frontmatter: CommandFrontmatter;
  type?: "rule" | "command";
} & ParsedContent;

export type CommandOutput = Output;

import { z } from "zod/mini";
import { BaseFrontmatterSchema, type Output, type ParsedContent } from "./shared.js";

export const SubagentFrontmatterSchema = BaseFrontmatterSchema;

type SubagentFrontmatter = z.infer<typeof SubagentFrontmatterSchema>;

export interface ParsedSubagent extends ParsedContent {
  frontmatter: SubagentFrontmatter;
}

export type SubagentOutput = Output;

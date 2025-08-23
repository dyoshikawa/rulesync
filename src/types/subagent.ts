import { z } from "zod/mini";

// Schema for subagent frontmatter
export const SubagentFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  model: z.optional(z.string()),
});

// Raw frontmatter type from the schema
export type RawSubagentFrontmatter = z.infer<typeof SubagentFrontmatterSchema>;

// Processed subagent type
export type ParsedSubagent = {
  frontmatter: RawSubagentFrontmatter;
  content: string;
  filename: string;
  filepath: string;
};

// Type for subagent output generation
export type SubagentOutput = {
  filename: string;
  content: string;
};

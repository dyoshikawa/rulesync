import { z } from "zod/mini";

// Tool-specific configuration schemas
export const ClaudeCodeConfigSchema = z.object({
  model: z.optional(z.string()),
});

// Schema for subagent frontmatter
export const SubagentFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  // Tool-specific configurations
  claudecode: z.optional(ClaudeCodeConfigSchema),
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

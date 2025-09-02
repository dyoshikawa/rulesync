import { z } from "zod/mini";
import { ToolTargetSchema } from "./tool-targets.js";

/**
 * Shared output type for generated files (used by both rules and commands)
 */
export const OutputSchema = z.object({
  tool: ToolTargetSchema,
  filepath: z.string(),
  content: z.string(),
});

export type Output = z.infer<typeof OutputSchema>;

/**
 * Common base interface for parsed content with frontmatter
 */
export type ParsedContent = {
  frontmatter: Record<string, unknown>;
  content: string;
  filename: string;
  filepath: string;
};

/**
 * Common base schema for frontmatter validation
 */
export const BaseFrontmatterSchema = z.object({
  description: z.optional(z.string()),
});

export type BaseFrontmatter = z.infer<typeof BaseFrontmatterSchema>;

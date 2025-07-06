import { z } from "zod/v4-mini";
import { RulesyncTargetsSchema, ToolTargetSchema, ToolTargetsSchema } from "./tool-targets.js";

export const RuleFrontmatterSchema = z.object({
  root: z.boolean(),
  targets: RulesyncTargetsSchema,
  description: z.string(),
  globs: z.array(z.string()),
  cursorRuleType: z.optional(z.enum(["always", "manual", "specificFiles", "intelligently"])),
});

export const ParsedRuleSchema = z.object({
  frontmatter: RuleFrontmatterSchema,
  content: z.string(),
  filename: z.string(),
  filepath: z.string(),
});

export const GeneratedOutputSchema = z.object({
  tool: ToolTargetSchema,
  filepath: z.string(),
  content: z.string(),
});

export const GenerateOptionsSchema = z.object({
  targetTools: z.optional(ToolTargetsSchema),
  outputDir: z.optional(z.string()),
  watch: z.optional(z.boolean()),
});

export type RuleFrontmatter = z.infer<typeof RuleFrontmatterSchema>;
export type ParsedRule = z.infer<typeof ParsedRuleSchema>;
export type GeneratedOutput = z.infer<typeof GeneratedOutputSchema>;
export type GenerateOptions = z.infer<typeof GenerateOptionsSchema>;

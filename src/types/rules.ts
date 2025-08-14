import { z } from "zod/mini";
import { RulesyncTargetsSchema, ToolTargetSchema, ToolTargetsSchema } from "./tool-targets.js";

export const RuleFrontmatterSchema = z.object({
  root: z.optional(z.boolean()),
  targets: z.optional(RulesyncTargetsSchema),
  description: z.optional(z.string()),
  globs: z.optional(z.array(z.string())),
  cursorRuleType: z.optional(z.enum(["always", "manual", "specificFiles", "intelligently"])),
  windsurfActivationMode: z.optional(z.enum(["always", "manual", "model-decision", "glob"])),
  windsurfOutputFormat: z.optional(z.enum(["single-file", "directory"])),
  tags: z.optional(z.array(z.string())),
});

// Type for processed rule (with defaults applied)
export type ProcessedRule = {
  frontmatter: RuleFrontmatter;
  content: string;
  filename: string;
  filepath: string;
  type?: "rule" | "command";
};

// Schemas for internal validation - not exported as they're unused externally
const GeneratedOutputSchema = z.object({
  tool: ToolTargetSchema,
  filepath: z.string(),
  content: z.string(),
});

const GenerateOptionsSchema = z.object({
  targetTools: z.optional(ToolTargetsSchema),
  outputDir: z.optional(z.string()),
  watch: z.optional(z.boolean()),
});

// Raw frontmatter type from the schema (with optional fields)
export type RawRuleFrontmatter = z.infer<typeof RuleFrontmatterSchema>;

// Processed frontmatter type with defaults applied (required fields)
export type RuleFrontmatter = {
  root: boolean;
  targets: z.infer<typeof RulesyncTargetsSchema>;
  description: string;
  globs: string[];
  cursorRuleType?: "always" | "manual" | "specificFiles" | "intelligently";
  windsurfActivationMode?: "always" | "manual" | "model-decision" | "glob";
  windsurfOutputFormat?: "single-file" | "directory";
  tags?: string[];
};

export type ParsedRule = ProcessedRule;
export type GeneratedOutput = z.infer<typeof GeneratedOutputSchema>;
export type GenerateOptions = z.infer<typeof GenerateOptionsSchema>;

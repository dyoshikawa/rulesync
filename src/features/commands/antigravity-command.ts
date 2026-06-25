import { z } from "zod/mini";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
const AntigravityWorkflowFrontmatterSchema = z.looseObject({
  trigger: z.optional(z.string()),
  turbo: z.optional(z.boolean()),
});

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
export const AntigravityCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  // Support for workflow-specific configuration
  ...AntigravityWorkflowFrontmatterSchema.shape,
});

export type AntigravityCommandFrontmatter = z.infer<typeof AntigravityCommandFrontmatterSchema>;

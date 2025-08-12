import { z } from "zod/mini";
import { ToolTargetSchema, ToolTargetsSchema } from "./tool-targets.js";

export const ConfigSchema = z.object({
  aiRulesDir: z.string(),
  outputPaths: z.record(ToolTargetSchema, z.string()),
  watchEnabled: z.boolean(),
  defaultTargets: ToolTargetsSchema,
  claudecodeCommands: z.optional(z.string()),
  geminicliCommands: z.optional(z.string()),
});

export type Config = z.infer<typeof ConfigSchema>;

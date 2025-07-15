import { z } from "zod/mini";
import { ToolTargetSchema, ToolTargetsSchema } from "./tool-targets.js";

export const ConfigSchema = z.object({
  aiRulesDir: z.string(),
  outputPaths: z.record(ToolTargetSchema, z.string()),
  watchEnabled: z.boolean(),
  defaultTargets: ToolTargetsSchema,
});

export type Config = z.infer<typeof ConfigSchema>;

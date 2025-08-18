import { z } from "zod/mini";
import { ToolTargetSchema, ToolTargetsSchema } from "./tool-targets.js";

export const OutputPathsSchema = z.object({
  augmentcode: z.optional(z.string()),
  "augmentcode-legacy": z.optional(z.string()),
  copilot: z.optional(z.string()),
  cursor: z.optional(z.string()),
  cline: z.optional(z.string()),
  claudecode: z.optional(z.string()),
  codexcli: z.optional(z.string()),
  roo: z.optional(z.string()),
  geminicli: z.optional(z.string()),
  kiro: z.optional(z.string()),
  junie: z.optional(z.string()),
  windsurf: z.optional(z.string()),
});

export const ConfigOptionsSchema = z.object({
  aiRulesDir: z.optional(z.string()),
  outputPaths: z.optional(OutputPathsSchema),
  watchEnabled: z.optional(z.boolean()),
  defaultTargets: z.optional(ToolTargetsSchema),

  targets: z.optional(z.array(ToolTargetSchema)),
  exclude: z.optional(z.array(ToolTargetSchema)),

  verbose: z.optional(z.boolean()),
  delete: z.optional(z.boolean()),
  baseDir: z.optional(z.union([z.string(), z.array(z.string())])),
  legacy: z.optional(z.boolean()),

  watch: z.optional(
    z.object({
      enabled: z.optional(z.boolean()),
      interval: z.optional(z.number()),
      ignore: z.optional(z.array(z.string())),
    }),
  ),
});

export type ConfigOptions = z.infer<typeof ConfigOptionsSchema>;

/**
 * Schema for the complete merged configuration
 *
 * This represents the final configuration after merging file config with CLI options.
 * While ConfigOptionsSchema allows partial configuration, MergedConfigSchema ensures
 * all required fields are present after merging with defaults.
 *
 * Key differences from ConfigOptionsSchema:
 * - outputPaths must be complete (all tools present)
 * - Required fields like aiRulesDir, watchEnabled, defaultTargets
 * - Includes runtime fields like configPath
 */
const MergedConfigSchema = z.object({
  aiRulesDir: z.string(),
  outputPaths: z.record(ToolTargetSchema, z.string()),
  watchEnabled: z.boolean(),
  defaultTargets: ToolTargetsSchema,

  targets: z.optional(z.array(ToolTargetSchema)),
  exclude: z.optional(z.array(ToolTargetSchema)),
  verbose: z.optional(z.boolean()),
  delete: z.optional(z.boolean()),
  baseDir: z.optional(z.union([z.string(), z.array(z.string())])),
  configPath: z.optional(z.string()),
  legacy: z.optional(z.boolean()),

  watch: z.optional(
    z.object({
      enabled: z.optional(z.boolean()),
      interval: z.optional(z.number()),
      ignore: z.optional(z.array(z.string())),
    }),
  ),
});

export type MergedConfig = z.infer<typeof MergedConfigSchema>;

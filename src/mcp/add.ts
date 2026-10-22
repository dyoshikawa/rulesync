import { z } from "zod/mini";

import { addCommand } from "../lib/add.js";
import { type McpCommandResult, runCommandForMcp, stringifyResult } from "./command-runner.js";
import { assertPathOptionWithinCwd } from "./path-options.js";

/**
 * Schema for add options
 * Excluded parameters:
 * - token: Secrets stay out of tool arguments; GITHUB_TOKEN / GH_TOKEN from the
 *   environment is used instead (npm tokens are named through tokenEnv)
 * - verbose/silent: Meaningless in MCP (no console output)
 * Without `force`, an existing scaffold file is never overwritten (there is no
 * prompt to confirm it).
 */
export const addOptionsSchema = z.object({
  source: z.string(),
  name: z.optional(z.string()),
  force: z.optional(z.boolean()),
  skills: z.optional(z.array(z.string())),
  rules: z.optional(z.array(z.string())),
  transport: z.optional(z.enum(["github", "git", "npm"])),
  ref: z.optional(z.string()),
  path: z.optional(z.string()),
  rulesPath: z.optional(z.string()),
  registry: z.optional(z.string()),
  tokenEnv: z.optional(z.string()),
  configPath: z.optional(z.string()),
});

export type AddOptions = z.infer<typeof addOptionsSchema>;

/**
 * Execute the rulesync add command via MCP: scaffold a feature file (when
 * `source` is a feature keyword such as `rule`) or declare and install a
 * source in rulesync.jsonc.
 */
export async function executeAdd(options: AddOptions): Promise<McpCommandResult> {
  return await runCommandForMcp({
    run: async (logger) => {
      if (!options.source) {
        throw new Error("source is required.");
      }
      if (options.configPath !== undefined) {
        await assertPathOptionWithinCwd({ path: options.configPath, label: "configPath" });
      }
      await addCommand(logger, { ...options, verbose: false, silent: true });
    },
  });
}

export const addTools = {
  executeAdd: {
    name: "executeAdd",
    description:
      "Execute the rulesync add command: scaffold a Rulesync feature file (source is a feature keyword such as 'rule', 'skill', 'mcp') or add a declarative skill/rule source to rulesync.jsonc and install it.",
    parameters: addOptionsSchema,
    execute: async (options: AddOptions): Promise<string> =>
      stringifyResult(await executeAdd(options)),
  },
};

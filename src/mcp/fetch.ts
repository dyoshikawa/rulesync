import { z } from "zod/mini";

import { RULESYNC_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { fetchCommand } from "../lib/fetch-command.js";
import { type Feature } from "../types/features.js";
import { FetchTargetSchema } from "../types/fetch-targets.js";
import { type McpCommandResult, runCommandForMcp, stringifyResult } from "./command-runner.js";
import { assertPathOptionWithinCwd } from "./path-options.js";

/**
 * Schema for fetch options
 * Excluded parameters:
 * - interactive: Needs a terminal prompt; select skills with `skills` instead
 * - token: Secrets stay out of tool arguments; GITHUB_TOKEN / GH_TOKEN from the
 *   environment is used instead
 * - verbose/silent: Meaningless in MCP (no console output)
 */
export const fetchOptionsSchema = z.object({
  source: z.string(),
  target: z.optional(z.string()),
  features: z.optional(z.array(z.string())),
  ref: z.optional(z.string()),
  path: z.optional(z.string()),
  output: z.optional(z.string()),
  conflict: z.optional(z.enum(["skip", "overwrite"])),
  prune: z.optional(z.boolean()),
  skills: z.optional(z.array(z.string())),
});

export type FetchOptions = z.infer<typeof fetchOptionsSchema>;

/**
 * Execute the rulesync fetch command via MCP. The output directory must stay
 * inside the project.
 */
export async function executeFetch(options: FetchOptions): Promise<McpCommandResult> {
  return await runCommandForMcp({
    run: async (logger) => {
      if (!options.source) {
        throw new Error("source is required.");
      }
      const target =
        options.target === undefined ? undefined : FetchTargetSchema.parse(options.target);
      await assertPathOptionWithinCwd({
        path: options.output ?? RULESYNC_RELATIVE_DIR_PATH,
        label: "output",
      });
      await fetchCommand(logger, {
        source: options.source,
        target,
        features: options.features as Array<Feature | "*"> | undefined,
        ref: options.ref,
        path: options.path,
        output: options.output,
        conflict: options.conflict,
        prune: options.prune,
        skills: options.skills,
        verbose: false,
        silent: true,
      });
    },
  });
}

export const fetchTools = {
  executeFetch: {
    name: "executeFetch",
    description:
      "Execute the rulesync fetch command to download rulesync (or tool-specific, converted) files from a GitHub repository into the project. Uses GITHUB_TOKEN / GH_TOKEN from the environment for private repositories.",
    parameters: fetchOptionsSchema,
    execute: async (options: FetchOptions): Promise<string> =>
      stringifyResult(await executeFetch(options)),
  },
};

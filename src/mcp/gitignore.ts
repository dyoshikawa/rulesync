import { z } from "zod/mini";

import { gitignoreCommand } from "../lib/gitignore.js";
import { resolveGitignoreTargets } from "../lib/resolve-gitignore-targets.js";
import { type RulesyncFeatures } from "../types/features.js";
import { type McpCommandResult, runCommandForMcp, stringifyResult } from "./command-runner.js";
import { assertPathOptionWithinCwd } from "./path-options.js";

/**
 * The project files gitignore writes. Checked before the run so a committed
 * symbolic link (dangling or not) cannot lead the write outside the project.
 * The `gitexclude` destination is Git's own `info/exclude`, located by Git.
 */
const GITIGNORE_WRITE_PATHS = [".gitignore", ".gitattributes"];

/**
 * Schema for gitignore options
 * Excluded parameters:
 * - verbose/silent: Meaningless in MCP (no console output)
 */
export const gitignoreOptionsSchema = z.object({
  targets: z.optional(z.array(z.string())),
  features: z.optional(z.array(z.string())),
});

export type GitignoreOptions = z.infer<typeof gitignoreOptionsSchema>;

/**
 * Execute the rulesync gitignore command via MCP. Targets are resolved the same
 * way as on the CLI: explicit targets win, otherwise rulesync.jsonc decides.
 */
export async function executeGitignore(options: GitignoreOptions = {}): Promise<McpCommandResult> {
  return await runCommandForMcp({
    run: async (logger) => {
      for (const path of GITIGNORE_WRITE_PATHS) {
        await assertPathOptionWithinCwd({ path, label: path });
      }
      const resolvedTargets = await resolveGitignoreTargets({ cliTargets: options.targets });
      await gitignoreCommand(logger, {
        targets: resolvedTargets ? [...resolvedTargets] : undefined,
        features: options.features as RulesyncFeatures | undefined,
        verbose: false,
        silent: true,
      });
    },
  });
}

export const gitignoreTools = {
  executeGitignore: {
    name: "executeGitignore",
    description:
      "Execute the rulesync gitignore command to add the files rulesync generates to .gitignore (and .gitattributes or .git/info/exclude when configured).",
    parameters: gitignoreOptionsSchema,
    execute: async (options: GitignoreOptions = {}): Promise<string> =>
      stringifyResult(await executeGitignore(options)),
  },
};

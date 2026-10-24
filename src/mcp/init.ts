import { initCommand } from "../lib/init-command.js";
import { type McpCommandResult, runCommandForMcp, stringifyResult } from "./command-runner.js";

/**
 * Execute the rulesync init command via MCP.
 * `init` has no options besides verbose/silent, which are meaningless here.
 * `result` carries the `created` and `skipped` file paths, and `seededFrom`
 * when the config file was seeded from a user-level config.
 *
 * `init` itself refuses to create a file through a committed symbolic link
 * (dangling or not) that leads outside the project, so the check is shared
 * with the CLI.
 */
export async function executeInit(): Promise<McpCommandResult> {
  return await runCommandForMcp({
    run: async (logger) => {
      await initCommand(logger);
    },
  });
}

export const initTools = {
  executeInit: {
    name: "executeInit",
    description:
      "Execute the rulesync init command to scaffold rulesync.jsonc and sample .rulesync/ files in the project. Existing files are kept.",
    execute: async (): Promise<string> => stringifyResult(await executeInit()),
  },
};

import { initCommand } from "../lib/init-command.js";
import { getInitWritePaths } from "../lib/init.js";
import {
  assertPathInsideCwd,
  type McpCommandResult,
  runCommandForMcp,
  stringifyResult,
} from "./command-runner.js";

/**
 * Execute the rulesync init command via MCP.
 * `init` has no options besides verbose/silent, which are meaningless here.
 * `result` carries the `created` and `skipped` file paths, and `seededFrom`
 * when the config file was seeded from a user-level config.
 *
 * Every path init may write is checked first, so a committed symbolic link
 * (dangling or not) cannot lead the write outside the project.
 */
export async function executeInit(): Promise<McpCommandResult> {
  return await runCommandForMcp({
    run: async (logger) => {
      for (const path of getInitWritePaths()) {
        await assertPathInsideCwd({ path, label: path });
      }
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

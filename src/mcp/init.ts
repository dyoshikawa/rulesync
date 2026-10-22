import { RULESYNC_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { init } from "../lib/init.js";
import { ensureDir } from "../utils/file.js";
import { type McpCommandResult, runCommandForMcp, stringifyResult } from "./command-runner.js";

/**
 * Execute the rulesync init command via MCP.
 * `init` has no options besides verbose/silent, which are meaningless here.
 * `result` carries the `created` and `skipped` file paths, and `seededFrom`
 * when the config file was seeded from an existing configuration.
 */
export async function executeInit(): Promise<McpCommandResult> {
  return await runCommandForMcp({
    run: async () => {
      await ensureDir(RULESYNC_RELATIVE_DIR_PATH);
      const { sampleFiles, configFile } = await init();
      const files = [...sampleFiles, configFile];
      return {
        created: files.filter((file) => file.created).map((file) => file.path),
        skipped: files.filter((file) => !file.created).map((file) => file.path),
        ...(configFile.seededFrom !== undefined ? { seededFrom: configFile.seededFrom } : {}),
      };
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

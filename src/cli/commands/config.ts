import { ConfigParams } from "../../config/config.js";
import { fileExists, writeFileContent } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";

type ConfigCommandOptions = {
  init?: boolean;
};

export async function configCommand(options: ConfigCommandOptions): Promise<void> {
  if (options.init) {
    await initConfig();
    return;
  }

  logger.info(`Please run \`rulesync config --init\` to create a new configuration file`);
}

async function initConfig(): Promise<void> {
  logger.info("Initializing configuration...");

  if (await fileExists("rulesync.jsonc")) {
    logger.error("rulesync.jsonc already exists");
    process.exit(1);
  }

  await writeFileContent(
    "rulesync.jsonc",
    JSON.stringify(
      {
        targets: ["copilot", "cursor", "claudecode", "codexcli"],
        features: ["rules", "ignore", "mcp", "commands", "subagents"],
        baseDirs: ["."],
        delete: true,
        verbose: false,
        experimentalSimulateCommands: false,
        experimentalSimulateSubagents: false,
      } satisfies ConfigParams,
      null,
      2,
    ),
  );

  logger.success("Configuration file created successfully!");
}

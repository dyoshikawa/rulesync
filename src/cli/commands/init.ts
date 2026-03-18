import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { init } from "../../lib/init.js";
import { ensureDir } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";

export async function initCommand(logger: Logger): Promise<void> {
  logger.debug("Initializing rulesync...");

  await ensureDir(RULESYNC_RELATIVE_DIR_PATH);

  const result = await init();

  // Log sample file results
  const createdFiles: string[] = [];
  const skippedFiles: string[] = [];

  for (const file of result.sampleFiles) {
    if (file.created) {
      createdFiles.push(file.path);
      logger.success(`Created ${file.path}`);
    } else {
      skippedFiles.push(file.path);
      logger.info(`Skipped ${file.path} (already exists)`);
    }
  }

  // Log config file result
  if (result.configFile.created) {
    createdFiles.push(result.configFile.path);
    logger.success(`Created ${result.configFile.path}`);
  } else {
    skippedFiles.push(result.configFile.path);
    logger.info(`Skipped ${result.configFile.path} (already exists)`);
  }

  // Capture JSON data if in JSON mode
  if (logger.jsonMode) {
    logger.captureData("created", createdFiles);
    logger.captureData("skipped", skippedFiles);
  }

  logger.success("rulesync initialized successfully!");
  logger.info("Next steps:");
  logger.info(
    `1. Edit ${RULESYNC_RELATIVE_DIR_PATH}/**/*.md, ${RULESYNC_RELATIVE_DIR_PATH}/skills/*/${SKILL_FILE_NAME}, ${RULESYNC_MCP_RELATIVE_FILE_PATH}, ${RULESYNC_HOOKS_RELATIVE_FILE_PATH} and ${RULESYNC_AIIGNORE_RELATIVE_FILE_PATH}`,
  );
  logger.info("2. Run 'rulesync generate' to create configuration files");
}

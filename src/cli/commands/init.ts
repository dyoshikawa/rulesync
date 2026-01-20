import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { init } from "../../core/init.js";
import { logger } from "../../utils/logger.js";

export async function initCommand(): Promise<void> {
  logger.info("Initializing rulesync...");

  await init();

  logger.success("rulesync initialized successfully!");
  logger.info("Next steps:");
  logger.info(
    `1. Edit ${RULESYNC_RELATIVE_DIR_PATH}/**/*.md, ${RULESYNC_RELATIVE_DIR_PATH}/skills/*/${SKILL_FILE_NAME}, ${RULESYNC_MCP_RELATIVE_FILE_PATH} and ${RULESYNC_AIIGNORE_RELATIVE_FILE_PATH}`,
  );
  logger.info("2. Run 'rulesync generate' to create configuration files");
}

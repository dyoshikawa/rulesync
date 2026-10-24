import { SKILL_FILE_NAME } from "../constants/general.js";
import {
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import type { Logger } from "../utils/logger.js";
import { init } from "./init.js";

export async function initCommand(logger: Logger): Promise<void> {
  logger.debug("Initializing rulesync...");

  // `init` creates `.rulesync/` along with the first sample file it writes,
  // after checking that the directory does not lead outside the project.
  const result = await init();

  // Log sample file results
  const createdFiles: string[] = [];
  const skippedFiles: string[] = [];

  for (const file of result.sampleFiles) {
    if (file.created) {
      createdFiles.push(file.path);
      logger.success(`Created ${file.path}`);
    } else if (file.outsideProject) {
      skippedFiles.push(file.path);
      logger.warn(
        `Skipped ${file.path}: it would be written through a symbolic link that leads outside the project or is dangling.`,
      );
    } else {
      skippedFiles.push(file.path);
      logger.info(`Skipped ${file.path} (already exists)`);
    }
  }

  // Log config file result
  if (result.configFile.created) {
    createdFiles.push(result.configFile.path);
    logger.success(`Created ${result.configFile.path}`);
    if (result.configFile.seededFrom !== undefined) {
      logger.info(`Seeded targets and features from ${result.configFile.seededFrom}`);
    }
  } else {
    skippedFiles.push(result.configFile.path);
    logger.info(`Skipped ${result.configFile.path} (already exists)`);
  }

  // Capture JSON data if in JSON mode
  if (logger.jsonMode) {
    logger.captureData("created", createdFiles);
    logger.captureData("skipped", skippedFiles);
    if (result.configFile.seededFrom !== undefined) {
      logger.captureData("seededFrom", result.configFile.seededFrom);
    }
  }

  logger.success("rulesync initialized successfully!");
  logger.info("Next steps:");
  logger.info(
    `1. Edit ${RULESYNC_RELATIVE_DIR_PATH}/**/*.md, ${RULESYNC_RELATIVE_DIR_PATH}/skills/*/${SKILL_FILE_NAME}, ${RULESYNC_MCP_RELATIVE_FILE_PATH}, ${RULESYNC_HOOKS_RELATIVE_FILE_PATH} and ${RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH}`,
  );
  logger.info("2. Run 'rulesync generate' to create configuration files");
}

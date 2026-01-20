import { gitignore } from "../../lib/gitignore.js";
import { logger } from "../../utils/logger.js";

export const gitignoreCommand = async (): Promise<void> => {
  await gitignore();
  logger.success("Updated .gitignore with rulesync entries");
};

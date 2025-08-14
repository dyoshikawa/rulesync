import { parseRulesFromDirectory, validateRules } from "../../core/index.js";
import { fileExists, getDefaultConfig } from "../../utils/index.js";
import { logger } from "../../utils/logger.js";

export async function validateCommand(): Promise<void> {
  const config = getDefaultConfig();

  logger.log("Validating rulesync configuration...");

  // Check if .rulesync directory exists
  if (!(await fileExists(config.aiRulesDir))) {
    logger.error(".rulesync directory not found. Run 'rulesync init' first.");
    process.exit(1);
  }

  try {
    // Parse rules
    const rules = await parseRulesFromDirectory(config.aiRulesDir);

    if (rules.length === 0) {
      logger.warn("No rules found in .rulesync directory");
      return;
    }

    logger.log(`Found ${rules.length} rule(s), validating...`);

    // Validate rules
    const validation = await validateRules(rules);

    // Display results
    if (validation.warnings.length > 0) {
      logger.log("\n⚠️  Warnings:");
      for (const warning of validation.warnings) {
        logger.log(`  - ${warning}`);
      }
    }

    if (validation.errors.length > 0) {
      logger.log("\n❌ Errors:");
      for (const error of validation.errors) {
        logger.log(`  - ${error}`);
      }
    }

    if (validation.isValid) {
      logger.success("\nAll rules are valid!");
    } else {
      logger.error(`\nValidation failed with ${validation.errors.length} error(s)`);
      process.exit(1);
    }
  } catch (error) {
    logger.error("Failed to validate rules:", error);
    process.exit(1);
  }
}

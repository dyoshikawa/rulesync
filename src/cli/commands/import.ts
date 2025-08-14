import { importConfiguration } from "../../core/importer.js";
import type { ToolTarget } from "../../types/index.js";
import { logger } from "../../utils/logger.js";

export interface ImportOptions {
  augmentcode?: boolean;
  "augmentcode-legacy"?: boolean;
  claudecode?: boolean;
  cursor?: boolean;
  copilot?: boolean;
  cline?: boolean;
  roo?: boolean;
  geminicli?: boolean;
  verbose?: boolean;
  legacy?: boolean;
}

export async function importCommand(options: ImportOptions = {}): Promise<void> {
  // Set logger verbosity based on options
  logger.setVerbose(options.verbose || false);

  const tools: ToolTarget[] = [];

  // Collect selected tools
  if (options.augmentcode) tools.push("augmentcode");
  if (options["augmentcode-legacy"]) tools.push("augmentcode-legacy");
  if (options.claudecode) tools.push("claudecode");
  if (options.cursor) tools.push("cursor");
  if (options.copilot) tools.push("copilot");
  if (options.cline) tools.push("cline");
  if (options.roo) tools.push("roo");
  if (options.geminicli) tools.push("geminicli");

  // Validate that exactly one tool is selected
  if (tools.length === 0) {
    logger.error(
      "❌ Please specify one tool to import from (--augmentcode, --augmentcode-legacy, --claudecode, --cursor, --copilot, --cline, --roo, --geminicli)",
    );
    process.exit(1);
  }

  if (tools.length > 1) {
    logger.error(
      "❌ Only one tool can be specified at a time. Please run the import command separately for each tool.",
    );
    process.exit(1);
  }

  const tool = tools[0];
  if (!tool) {
    logger.error("Error: No tool specified");
    process.exit(1);
  }

  logger.log(`Importing configuration files from ${tool}...`);

  try {
    const result = await importConfiguration({
      tool,
      verbose: options.verbose ?? false,
      useLegacyLocation: options.legacy ?? false,
    });

    if (result.success) {
      logger.success(`Imported ${result.rulesCreated} rule(s) from ${tool}`);
      if (result.ignoreFileCreated) {
        logger.success("Created .rulesyncignore file from ignore patterns");
      }
      if (result.mcpFileCreated) {
        logger.success("Created .rulesync/.mcp.json file from MCP configuration");
      }
      logger.log("You can now run 'rulesync generate' to create tool-specific configurations.");
    } else if (result.errors.length > 0) {
      logger.warn(`⚠️  Failed to import from ${tool}: ${result.errors[0]}`);
      if (result.errors.length > 1) {
        logger.info("\nDetailed errors:");
        for (const error of result.errors) {
          logger.info(`  - ${error}`);
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`❌ Error importing from ${tool}: ${errorMessage}`);
    process.exit(1);
  }
}

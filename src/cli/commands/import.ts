import { importConfiguration } from "../../core/importer.js";
import type { ToolTarget } from "../../types/index.js";
import { logger } from "../../utils/logger.js";

export interface ImportOptions {
  targets?: ToolTarget[];
  all?: boolean;
  agentsmd?: boolean;
  amazonqcli?: boolean;
  augmentcode?: boolean;
  "augmentcode-legacy"?: boolean;
  claudecode?: boolean;
  cursor?: boolean;
  copilot?: boolean;
  cline?: boolean;
  roo?: boolean;
  geminicli?: boolean;
  junie?: boolean;
  qwencode?: boolean;
  opencode?: boolean;
  verbose?: boolean;
  legacy?: boolean;
}

export async function importCommand(options: ImportOptions = {}): Promise<void> {
  // Set logger verbosity based on options
  logger.setVerbose(options.verbose || false);

  let tools: ToolTarget[] = [];

  // If targets are provided, use them directly
  if (options.targets && options.targets.length > 0) {
    tools = options.targets;
  } else {
    // Fallback to legacy individual flags for backwards compatibility
    if (options.agentsmd) tools.push("agentsmd");
    if (options.amazonqcli) tools.push("amazonqcli");
    if (options.augmentcode) tools.push("augmentcode");
    if (options["augmentcode-legacy"]) tools.push("augmentcode-legacy");
    if (options.claudecode) tools.push("claudecode");
    if (options.cursor) tools.push("cursor");
    if (options.copilot) tools.push("copilot");
    if (options.cline) tools.push("cline");
    if (options.roo) tools.push("roo");
    if (options.geminicli) tools.push("geminicli");
    if (options.junie) tools.push("junie");
    if (options.qwencode) tools.push("qwencode");
    if (options.opencode) tools.push("opencode");
  }

  // Validate that at least one tool is selected
  if (tools.length === 0) {
    logger.error(
      "❌ Please specify tools to import from using --targets <tool1,tool2> or --targets * for all supported tools.",
    );
    logger.info("Example: rulesync import --targets cursor,copilot");
    process.exit(1);
  }

  // Process each tool
  const results: Array<{ tool: ToolTarget; success: boolean; error?: string }> = [];

  for (const tool of tools) {
    logger.log(`Importing configuration files from ${tool}...`);

    try {
      const result = await importConfiguration({
        tool,
        verbose: options.verbose ?? false,
        useLegacyLocation: options.legacy ?? false,
      });

      if (result.success) {
        logger.success(`✅ Imported ${result.rulesCreated} rule(s) from ${tool}`);
        if (result.ignoreFileCreated) {
          logger.success("  Created .rulesyncignore file from ignore patterns");
        }
        if (result.mcpFileCreated) {
          logger.success("  Created .rulesync/.mcp.json file from MCP configuration");
        }
        results.push({ tool, success: true });
      } else if (result.errors.length > 0) {
        logger.warn(`⚠️  Failed to import from ${tool}: ${result.errors[0]}`);
        if (result.errors.length > 1) {
          logger.info("  Detailed errors:");
          for (const error of result.errors) {
            logger.info(`    - ${error}`);
          }
        }
        results.push({ tool, success: false, error: result.errors[0] || "Unknown error" });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Error importing from ${tool}: ${errorMessage}`);
      results.push({ tool, success: false, error: errorMessage });
    }
  }

  // Summary
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  if (successful.length > 0 && failed.length === 0) {
    logger.success(
      `\n🎉 Successfully imported from ${successful.length} tool(s): ${successful.map((r) => r.tool).join(", ")}`,
    );
    logger.log("You can now run 'rulesync generate' to create tool-specific configurations.");
  } else if (successful.length > 0 && failed.length > 0) {
    logger.success(
      `\n✅ Successfully imported from ${successful.length} tool(s): ${successful.map((r) => r.tool).join(", ")}`,
    );
    logger.warn(
      `❌ Failed to import from ${failed.length} tool(s): ${failed.map((r) => r.tool).join(", ")}`,
    );
    logger.log(
      "You can still run 'rulesync generate' to create configurations for successfully imported tools.",
    );
  } else {
    logger.error(`\n❌ Failed to import from all ${failed.length} tool(s).`);
    process.exit(1);
  }
}

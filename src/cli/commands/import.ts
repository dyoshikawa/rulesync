import { importConfiguration } from "../../core/importer.js";
import type { ToolTarget } from "../../types/index.js";

export interface ImportOptions {
  augmentcode?: boolean;
  claudecode?: boolean;
  cursor?: boolean;
  copilot?: boolean;
  cline?: boolean;
  roo?: boolean;
  geminicli?: boolean;
  verbose?: boolean;
}

export async function importCommand(options: ImportOptions = {}): Promise<void> {
  const tools: ToolTarget[] = [];

  // Collect selected tools
  if (options.augmentcode) tools.push("augmentcode");
  if (options.claudecode) tools.push("claudecode");
  if (options.cursor) tools.push("cursor");
  if (options.copilot) tools.push("copilot");
  if (options.cline) tools.push("cline");
  if (options.roo) tools.push("roo");
  if (options.geminicli) tools.push("geminicli");

  // Validate that exactly one tool is selected
  if (tools.length === 0) {
    console.error(
      "❌ Please specify one tool to import from (--augmentcode, --claudecode, --cursor, --copilot, --cline, --roo, --geminicli)",
    );
    process.exit(1);
  }

  if (tools.length > 1) {
    console.error(
      "❌ Only one tool can be specified at a time. Please run the import command separately for each tool.",
    );
    process.exit(1);
  }

  const tool = tools[0];
  if (!tool) {
    console.error("Error: No tool specified");
    process.exit(1);
  }

  console.log(`Importing configuration files from ${tool}...`);

  try {
    const result = await importConfiguration({
      tool,
      verbose: options.verbose ?? false,
    });

    if (result.success) {
      console.log(`✅ Imported ${result.rulesCreated} rule(s) from ${tool}`);
      if (result.ignoreFileCreated) {
        console.log("✅ Created .rulesyncignore file from ignore patterns");
      }
      if (result.mcpFileCreated) {
        console.log("✅ Created .rulesync/.mcp.json file from MCP configuration");
      }
      console.log("You can now run 'rulesync generate' to create tool-specific configurations.");
    } else if (result.errors.length > 0) {
      console.warn(`⚠️  Failed to import from ${tool}: ${result.errors[0]}`);
      if (options.verbose && result.errors.length > 1) {
        console.log("\nDetailed errors:");
        for (const error of result.errors) {
          console.log(`  - ${error}`);
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error importing from ${tool}: ${errorMessage}`);
    process.exit(1);
  }
}

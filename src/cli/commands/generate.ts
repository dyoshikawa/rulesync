import { join } from "node:path";
import { generateConfigurations, parseRulesFromDirectory } from "../../core/index.js";
import { generateMcpConfigs } from "../../core/mcp-generator.js";
import type { ToolTarget } from "../../types/index.js";
import type { ConfigLoaderOptions } from "../../utils/config-loader.js";
import {
  fileExists,
  loadConfig,
  mergeWithCliOptions,
  removeClaudeGeneratedFiles,
  removeDirectory,
  writeFileContent,
} from "../../utils/index.js";

export interface GenerateOptions {
  tools?: ToolTarget[];
  verbose?: boolean;
  delete?: boolean;
  baseDirs?: string[];
  config?: string;
  noConfig?: boolean;
}

interface CliOptions {
  tools?: ToolTarget[];
  verbose?: boolean;
  delete?: boolean;
  baseDirs?: string[];
}

export async function generateCommand(options: GenerateOptions = {}): Promise<void> {
  // Build config loader options with proper typing
  const configLoaderOptions: ConfigLoaderOptions = {
    ...(options.config !== undefined && { configPath: options.config }),
    ...(options.noConfig !== undefined && { noConfig: options.noConfig }),
  };

  const configResult = await loadConfig(configLoaderOptions);

  const cliOptions: CliOptions = {
    ...(options.tools !== undefined && { tools: options.tools }),
    ...(options.verbose !== undefined && { verbose: options.verbose }),
    ...(options.delete !== undefined && { delete: options.delete }),
    ...(options.baseDirs !== undefined && { baseDirs: options.baseDirs }),
  };

  const config = mergeWithCliOptions(configResult.config, cliOptions);

  if (options.tools && options.tools.length > 0) {
    const configTargets = config.defaultTargets;
    const cliTools = options.tools;

    const cliToolsSet = new Set(cliTools);
    const configTargetsSet = new Set(configTargets);

    const notInConfig = cliTools.filter((tool) => !configTargetsSet.has(tool));
    const notInCli = configTargets.filter((tool) => !cliToolsSet.has(tool));

    if (notInConfig.length > 0 || notInCli.length > 0) {
      console.warn("⚠️  Warning: CLI tool selection differs from configuration!");
      console.warn(`   Config targets: ${configTargets.join(", ")}`);
      console.warn(`   CLI specified: ${cliTools.join(", ")}`);

      if (notInConfig.length > 0) {
        console.warn(`   Tools specified but not in config: ${notInConfig.join(", ")}`);
      }
      if (notInCli.length > 0) {
        console.warn(`   Tools in config but not specified: ${notInCli.join(", ")}`);
      }

      console.warn("\n   The configuration file targets will be used.");
      console.warn("   To change targets, update your rulesync config file.");
      console.warn("");
    }
  }

  let baseDirs: string[];
  if (config.baseDir) {
    baseDirs = Array.isArray(config.baseDir) ? config.baseDir : [config.baseDir];
  } else if (options.baseDirs) {
    baseDirs = options.baseDirs;
  } else {
    baseDirs = [process.cwd()];
  }

  if (config.verbose && configResult.filepath) {
    console.log(`Loaded configuration from: ${configResult.filepath}`);
  }

  console.log("Generating configuration files...");

  // Check if .rulesync directory exists
  if (!(await fileExists(config.aiRulesDir))) {
    console.error("❌ .rulesync directory not found. Run 'rulesync init' first.");
    process.exit(1);
  }

  try {
    // Parse rules
    if (config.verbose) {
      console.log(`Parsing rules from ${config.aiRulesDir}...`);
    }
    const rules = await parseRulesFromDirectory(config.aiRulesDir);

    if (rules.length === 0) {
      console.warn("⚠️  No rules found in .rulesync directory");
      return;
    }

    if (config.verbose) {
      console.log(`Found ${rules.length} rule(s)`);
      console.log(`Base directories: ${baseDirs.join(", ")}`);
    }

    // Delete existing output directories if --delete option is specified
    if (config.delete) {
      if (config.verbose) {
        console.log("Deleting existing output directories...");
      }

      const targetTools = config.defaultTargets;
      const deleteTasks = [];

      for (const tool of targetTools) {
        switch (tool) {
          case "augmentcode":
            deleteTasks.push(removeDirectory(join(".augment", "rules")));
            deleteTasks.push(removeDirectory(join(".augment", "ignore")));
            break;
          case "augmentcode-legacy":
            // Legacy AugmentCode files are in the root directory
            deleteTasks.push(removeClaudeGeneratedFiles());
            deleteTasks.push(removeDirectory(join(".augment", "ignore")));
            break;
          case "copilot":
            deleteTasks.push(removeDirectory(config.outputPaths.copilot));
            break;
          case "cursor":
            deleteTasks.push(removeDirectory(config.outputPaths.cursor));
            break;
          case "cline":
            deleteTasks.push(removeDirectory(config.outputPaths.cline));
            break;
          case "claudecode":
            // Use safe deletion for Claude Code files only
            deleteTasks.push(removeClaudeGeneratedFiles());
            break;
          case "roo":
            deleteTasks.push(removeDirectory(config.outputPaths.roo));
            break;
          case "geminicli":
            deleteTasks.push(removeDirectory(config.outputPaths.geminicli));
            break;
          case "kiro":
            deleteTasks.push(removeDirectory(config.outputPaths.kiro));
            break;
        }
      }

      await Promise.all(deleteTasks);

      if (config.verbose) {
        console.log("Deleted existing output directories");
      }
    }

    // Generate configurations for each base directory
    let totalOutputs = 0;
    for (const baseDir of baseDirs) {
      if (config.verbose) {
        console.log(`\nGenerating configurations for base directory: ${baseDir}`);
      }

      const outputs = await generateConfigurations(rules, config, config.defaultTargets, baseDir);

      if (outputs.length === 0) {
        if (config.verbose) {
          console.warn(`⚠️  No configurations generated for ${baseDir}`);
        }
        continue;
      }

      // Write output files
      for (const output of outputs) {
        await writeFileContent(output.filepath, output.content);
        console.log(`✅ Generated ${output.tool} configuration: ${output.filepath}`);
      }

      totalOutputs += outputs.length;
    }

    if (totalOutputs === 0) {
      console.warn("⚠️  No configurations generated");
      return;
    }

    // Generate MCP configurations
    if (config.verbose) {
      console.log("\nGenerating MCP configurations...");
    }

    let totalMcpOutputs = 0;
    for (const baseDir of baseDirs) {
      const mcpResults = await generateMcpConfigs(
        process.cwd(),
        baseDir === process.cwd() ? undefined : baseDir,
        config.defaultTargets,
      );

      if (mcpResults.length === 0) {
        if (config.verbose) {
          console.log(`No MCP configuration found for ${baseDir}`);
        }
        continue;
      }

      for (const result of mcpResults) {
        if (result.status === "success") {
          console.log(`✅ Generated ${result.tool} MCP configuration: ${result.path}`);
          totalMcpOutputs++;
        } else if (result.status === "error") {
          console.error(`❌ Failed to generate ${result.tool} MCP configuration: ${result.error}`);
        } else if (config.verbose && result.status === "skipped") {
          console.log(`⏭️  Skipped ${result.tool} MCP configuration (no servers configured)`);
        }
      }
    }

    // Final success message
    const totalGenerated = totalOutputs + totalMcpOutputs;
    if (totalGenerated > 0) {
      console.log(
        `\n🎉 All done! Generated ${totalGenerated} file(s) total (${totalOutputs} configurations + ${totalMcpOutputs} MCP configurations)`,
      );
    }
  } catch (error) {
    console.error("❌ Failed to generate configurations:", error);
    process.exit(1);
  }
}

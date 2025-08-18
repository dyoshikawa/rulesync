import { join } from "node:path";
import { generateCommands } from "../../core/command-generator.js";
import { generateConfigurations, parseRulesFromDirectory } from "../../core/index.js";
import { generateMcpConfigurations } from "../../core/mcp-generator.js";
import { parseMcpConfig } from "../../core/mcp-parser.js";
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
import { logger } from "../../utils/logger.js";

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

  // Set logger verbosity based on config
  logger.setVerbose(config.verbose || false);

  if (options.tools && options.tools.length > 0) {
    const configTargets = config.defaultTargets;
    const cliTools = options.tools;

    const cliToolsSet = new Set(cliTools);
    const configTargetsSet = new Set(configTargets);

    const notInConfig = cliTools.filter((tool) => !configTargetsSet.has(tool));
    const notInCli = configTargets.filter((tool) => !cliToolsSet.has(tool));

    if (notInConfig.length > 0 || notInCli.length > 0) {
      logger.warn("⚠️  Warning: CLI tool selection differs from configuration!");
      logger.warn(`   Config targets: ${configTargets.join(", ")}`);
      logger.warn(`   CLI specified: ${cliTools.join(", ")}`);

      if (notInConfig.length > 0) {
        logger.warn(`   Tools specified but not in config: ${notInConfig.join(", ")}`);
      }
      if (notInCli.length > 0) {
        logger.warn(`   Tools in config but not specified: ${notInCli.join(", ")}`);
      }

      logger.warn("\n   The configuration file targets will be used.");
      logger.warn("   To change targets, update your rulesync config file.");
      logger.warn("");
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

  logger.info(`Loaded configuration from: ${configResult.filepath}`);

  logger.log("Generating configuration files...");

  // Check if .rulesync directory exists
  if (!(await fileExists(config.aiRulesDir))) {
    logger.error("❌ .rulesync directory not found. Run 'rulesync init' first.");
    process.exit(1);
  }

  try {
    // Parse rules
    logger.info(`Parsing rules from ${config.aiRulesDir}...`);
    const rules = await parseRulesFromDirectory(config.aiRulesDir);

    if (rules.length === 0) {
      logger.warn("⚠️  No rules found in .rulesync directory");
      return;
    }

    logger.info(`Found ${rules.length} rule(s)`);
    logger.info(`Base directories: ${baseDirs.join(", ")}`);

    // Delete existing output directories if --delete option is specified
    if (config.delete) {
      logger.info("Deleting existing output directories...");

      const targetTools = config.defaultTargets;
      const deleteTasks = [];

      // Check if .rulesync/commands directory has any command files
      const commandsDir = join(config.aiRulesDir, "commands");
      const hasCommands = await fileExists(commandsDir);
      let hasCommandFiles = false;
      if (hasCommands) {
        const { readdir } = await import("node:fs/promises");
        try {
          const files = await readdir(commandsDir);
          hasCommandFiles = files.some((file) => file.endsWith(".md"));
        } catch {
          hasCommandFiles = false;
        }
      }

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
            // Only delete commands directory if .rulesync/commands/*.md files exist
            if (hasCommandFiles) {
              deleteTasks.push(removeDirectory(join(".claude", "commands")));
            }
            break;
          case "roo":
            deleteTasks.push(removeDirectory(config.outputPaths.roo));
            // Only delete commands directory if .rulesync/commands/*.md files exist
            if (hasCommandFiles) {
              deleteTasks.push(removeDirectory(join(".roo", "commands")));
            }
            break;
          case "geminicli":
            deleteTasks.push(removeDirectory(config.outputPaths.geminicli));
            // Only delete commands directory if .rulesync/commands/*.md files exist
            if (hasCommandFiles) {
              deleteTasks.push(removeDirectory(join(".gemini", "commands")));
            }
            break;
          case "kiro":
            deleteTasks.push(removeDirectory(config.outputPaths.kiro));
            break;
          case "opencode":
            deleteTasks.push(removeDirectory(config.outputPaths.opencode));
            break;
          case "windsurf":
            deleteTasks.push(removeDirectory(config.outputPaths.windsurf));
            break;
        }
      }

      await Promise.all(deleteTasks);

      logger.info("Deleted existing output directories");
    }

    // Generate configurations for each base directory
    let totalOutputs = 0;
    for (const baseDir of baseDirs) {
      logger.info(`\nGenerating configurations for base directory: ${baseDir}`);

      const outputs = await generateConfigurations(rules, config, config.defaultTargets, baseDir);

      if (outputs.length === 0) {
        logger.warn(`⚠️  No configurations generated for ${baseDir}`);
        continue;
      }

      // Write output files
      for (const output of outputs) {
        await writeFileContent(output.filepath, output.content);
        logger.success(`Generated ${output.tool} configuration: ${output.filepath}`);
      }

      totalOutputs += outputs.length;
    }

    if (totalOutputs === 0) {
      logger.warn("⚠️  No configurations generated");
      return;
    }

    // Generate MCP configurations
    logger.info("\nGenerating MCP configurations...");

    let totalMcpOutputs = 0;
    for (const baseDir of baseDirs) {
      try {
        const mcpConfig = parseMcpConfig(process.cwd());

        if (!mcpConfig || !mcpConfig.mcpServers || Object.keys(mcpConfig.mcpServers).length === 0) {
          logger.info(`No MCP configuration found for ${baseDir}`);
          continue;
        }

        const mcpResults = await generateMcpConfigurations(
          mcpConfig,
          baseDir === process.cwd() ? "." : baseDir,
          config.defaultTargets,
        );

        if (mcpResults.length === 0) {
          logger.info(`No MCP configurations generated for ${baseDir}`);
          continue;
        }

        for (const result of mcpResults) {
          await writeFileContent(result.filepath, result.content);
          logger.success(`Generated ${result.tool} MCP configuration: ${result.filepath}`);
          totalMcpOutputs++;
        }
      } catch (error) {
        logger.error(
          `❌ Failed to generate MCP configurations: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Generate command files
    logger.info("\nGenerating command files...");

    let totalCommandOutputs = 0;
    for (const baseDir of baseDirs) {
      const commandResults = await generateCommands(
        process.cwd(),
        baseDir === process.cwd() ? undefined : baseDir,
        config.defaultTargets,
      );

      if (commandResults.length === 0) {
        logger.info(`No commands found for ${baseDir}`);
        continue;
      }

      for (const result of commandResults) {
        await writeFileContent(result.filepath, result.content);
        logger.success(`Generated ${result.tool} command: ${result.filepath}`);
        totalCommandOutputs++;
      }
    }

    // Final success message
    const totalGenerated = totalOutputs + totalMcpOutputs + totalCommandOutputs;
    if (totalGenerated > 0) {
      const parts = [];
      if (totalOutputs > 0) parts.push(`${totalOutputs} configurations`);
      if (totalMcpOutputs > 0) parts.push(`${totalMcpOutputs} MCP configurations`);
      if (totalCommandOutputs > 0) parts.push(`${totalCommandOutputs} commands`);

      logger.success(
        `\n🎉 All done! Generated ${totalGenerated} file(s) total (${parts.join(" + ")})`,
      );
    }
  } catch (error) {
    logger.error("❌ Failed to generate configurations:", error);
    process.exit(1);
  }
}

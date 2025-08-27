import { join } from "node:path";
import { generateCommands } from "../../core/command-generator.js";
import { type CliOptions, CliParser, ConfigResolver } from "../../core/config/index.js";
import { generateConfigurations, parseRulesFromDirectory } from "../../core/index.js";
import { generateMcpConfigurations } from "../../core/mcp-generator.js";
import { parseMcpConfig } from "../../core/mcp-parser.js";
import { SubagentsProcessor } from "../../subagents/subagents-processor.js";
import type { FeatureType } from "../../types/config-options.js";
import type { ToolTarget } from "../../types/index.js";
import { normalizeFeatures } from "../../utils/feature-validator.js";
import {
  fileExists,
  removeClaudeGeneratedFiles,
  removeDirectory,
  writeFileContent,
} from "../../utils/index.js";
import { logger } from "../../utils/logger.js";
import { showBackwardCompatibilityWarning } from "./shared-utils.js";

export interface GenerateOptions {
  tools?: ToolTarget[] | undefined;
  features?: FeatureType[] | "*" | undefined;
  verbose?: boolean;
  delete?: boolean;
  baseDirs?: string[];
  config?: string;
  noConfig?: boolean;
}

export async function generateCommand(options: GenerateOptions = {}): Promise<void> {
  try {
    // Parse CLI arguments (filter out undefined values)
    const cliParser = new CliParser();
    const cliInputs: Partial<CliOptions> = {};

    if (options.tools !== undefined) cliInputs.tools = options.tools;
    if (options.features !== undefined) cliInputs.features = options.features;
    if (options.verbose !== undefined) cliInputs.verbose = options.verbose;
    if (options.delete !== undefined) cliInputs.delete = options.delete;
    if (options.baseDirs !== undefined) cliInputs.baseDirs = options.baseDirs;
    if (options.config !== undefined) cliInputs.config = options.config;
    if (options.noConfig !== undefined) cliInputs.noConfig = options.noConfig;

    const cliOptions = cliParser.parse(cliInputs);

    // ConfigResolverを使用して設定を統合
    const configResolver = new ConfigResolver();
    const resolutionResult = await configResolver.resolve({
      cliOptions,
    });

    const config = resolutionResult.value;

    // Handle features option with backward compatibility
    let resolvedFeatures: FeatureType[] | "*" | undefined;
    let showWarning = false;

    // Priority: CLI options > config file > undefined
    if (cliOptions.features !== undefined) {
      resolvedFeatures = cliOptions.features;
    } else if (config.features !== undefined) {
      resolvedFeatures = config.features;
    } else {
      // No features specified in CLI or config
      resolvedFeatures = "*"; // Default to all features for backward compatibility
      showWarning = true;
    }

    // Show backward compatibility warning if features are not specified anywhere
    if (showWarning) {
      showBackwardCompatibilityWarning(
        "generating",
        "rulesync generate --features rules,commands,mcp,ignore",
      );
    }

    // Normalize features for processing
    const normalizedFeatures = normalizeFeatures(resolvedFeatures);

    // Ensure tools are specified (either from CLI or config)
    if (!config.defaultTargets || config.defaultTargets.length === 0) {
      const errorMessage = `❌ Error: At least one tool must be specified.

You can specify tools in three ways:

1. Use the --targets flag:
   rulesync generate --targets copilot,cursor

2. Use the --all flag to generate for all tools:
   rulesync generate --all

3. Set targets in rulesync.jsonc:
   {
     "targets": ["copilot", "cursor"]
   }

Available tools:
  agentsmd, amazonqcli, augmentcode, augmentcode-legacy, copilot, cursor, cline,
  claudecode, codexcli, opencode, qwencode, roo, geminicli, kiro, junie, windsurf`;

      logger.error(errorMessage);
      process.exit(1);
    }

    // Set logger verbosity based on config
    logger.setVerbose(config.verbose || false);

    let baseDirs: string[];
    if (config.baseDir) {
      baseDirs = Array.isArray(config.baseDir) ? config.baseDir : [config.baseDir];
    } else if (options.baseDirs) {
      baseDirs = options.baseDirs;
    } else {
      baseDirs = [process.cwd()];
    }

    // 設定ソースの情報をログ出力
    logger.info(`Configuration resolved from: ${resolutionResult.source}`);

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
              if (normalizedFeatures.includes("rules")) {
                deleteTasks.push(removeDirectory(join(".augment", "rules")));
              }
              if (normalizedFeatures.includes("ignore")) {
                deleteTasks.push(removeDirectory(join(".augment", "ignore")));
              }
              break;
            case "augmentcode-legacy":
              // Legacy AugmentCode files are in the root directory
              if (normalizedFeatures.includes("rules")) {
                deleteTasks.push(removeClaudeGeneratedFiles());
              }
              if (normalizedFeatures.includes("ignore")) {
                deleteTasks.push(removeDirectory(join(".augment", "ignore")));
              }
              break;
            case "copilot":
              if (normalizedFeatures.includes("rules")) {
                deleteTasks.push(removeDirectory(config.outputPaths.copilot));
              }
              break;
            case "cursor":
              if (normalizedFeatures.includes("rules")) {
                deleteTasks.push(removeDirectory(config.outputPaths.cursor));
              }
              break;
            case "cline":
              if (normalizedFeatures.includes("rules")) {
                deleteTasks.push(removeDirectory(config.outputPaths.cline));
              }
              break;
            case "claudecode":
              // Delete only the features that are being regenerated
              if (normalizedFeatures.includes("rules")) {
                deleteTasks.push(removeClaudeGeneratedFiles());
              }
              if (normalizedFeatures.includes("commands") && hasCommandFiles) {
                deleteTasks.push(removeDirectory(join(".claude", "commands")));
              }
              if (normalizedFeatures.includes("subagents")) {
                deleteTasks.push(removeDirectory(join(".claude", "agents")));
              }
              break;
            case "roo":
              if (normalizedFeatures.includes("rules")) {
                deleteTasks.push(removeDirectory(config.outputPaths.roo));
              }
              if (normalizedFeatures.includes("commands") && hasCommandFiles) {
                deleteTasks.push(removeDirectory(join(".roo", "commands")));
              }
              break;
            case "geminicli":
              if (normalizedFeatures.includes("rules")) {
                deleteTasks.push(removeDirectory(config.outputPaths.geminicli));
              }
              if (normalizedFeatures.includes("commands") && hasCommandFiles) {
                deleteTasks.push(removeDirectory(join(".gemini", "commands")));
              }
              break;
            case "kiro":
              if (normalizedFeatures.includes("rules")) {
                deleteTasks.push(removeDirectory(config.outputPaths.kiro));
              }
              break;
            case "opencode":
              if (normalizedFeatures.includes("rules")) {
                deleteTasks.push(removeDirectory(config.outputPaths.opencode));
              }
              break;
            case "qwencode":
              if (normalizedFeatures.includes("rules")) {
                deleteTasks.push(removeDirectory(config.outputPaths.qwencode));
              }
              break;
            case "windsurf":
              if (normalizedFeatures.includes("rules")) {
                deleteTasks.push(removeDirectory(config.outputPaths.windsurf));
              }
              break;
          }
        }

        await Promise.all(deleteTasks);

        logger.info("Deleted existing output directories");
      }

      // Generate configurations for each base directory (rules feature)
      let totalOutputs = 0;
      if (normalizedFeatures.includes("rules")) {
        for (const baseDir of baseDirs) {
          logger.info(`\nGenerating rule configurations for base directory: ${baseDir}`);

          const outputs = await generateConfigurations(
            rules,
            config,
            config.defaultTargets,
            baseDir,
          );

          if (outputs.length === 0) {
            logger.warn(`⚠️  No rule configurations generated for ${baseDir}`);
            continue;
          }

          // Write output files
          for (const output of outputs) {
            await writeFileContent(output.filepath, output.content);
            logger.success(`Generated ${output.tool} rule configuration: ${output.filepath}`);
          }

          totalOutputs += outputs.length;
        }
      } else {
        logger.info("\nSkipping rule generation (not in --features)");
      }

      // Generate MCP configurations (mcp feature)
      let totalMcpOutputs = 0;
      if (normalizedFeatures.includes("mcp")) {
        logger.info("\nGenerating MCP configurations...");

        for (const baseDir of baseDirs) {
          try {
            const mcpConfig = parseMcpConfig(process.cwd());

            if (
              !mcpConfig ||
              !mcpConfig.mcpServers ||
              Object.keys(mcpConfig.mcpServers).length === 0
            ) {
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
      } else {
        logger.info("\nSkipping MCP configuration generation (not in --features)");
      }

      // Generate command files (commands feature)
      let totalCommandOutputs = 0;
      if (normalizedFeatures.includes("commands")) {
        logger.info("\nGenerating command files...");

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
      } else {
        logger.info("\nSkipping command file generation (not in --features)");
      }

      // Generate ignore files (ignore feature) - placeholder for future implementation
      const totalIgnoreOutputs = 0;
      if (normalizedFeatures.includes("ignore")) {
        logger.info("\nGenerating ignore files...");
        logger.info("Ignore file generation is not yet implemented");
        // TODO: Implement ignore file generation
        // This would generate .cursorignore, .cline-ignore, etc.
      } else {
        logger.info("\nSkipping ignore file generation (not in --features)");
      }

      // Generate subagent files (subagents feature)
      let totalSubagentOutputs = 0;
      if (normalizedFeatures.includes("subagents")) {
        logger.info("\nGenerating subagent files...");

        // Check if claudecode is in the target tools
        if (config.defaultTargets.includes("claudecode")) {
          for (const baseDir of baseDirs) {
            try {
              // Check if rulesync subagent source directory exists
              const rulesyncSubagentsDir = join(".rulesync", "subagents");
              // The rulesync dir can not be influenced by baseDir
              const fullPath = join(process.cwd(), rulesyncSubagentsDir);

              if (!(await fileExists(fullPath))) {
                logger.info(`No rulesync subagents directory found at ${fullPath}`);
                continue;
              }

              // Use SubagentsProcessor to generate subagent files
              const processor = new SubagentsProcessor({
                baseDir: baseDir === process.cwd() ? "." : baseDir,
                toolTarget: "claudecode",
              });

              const rulesyncSubagents = await processor.loadRulesyncSubagents();
              await processor.writeToolSubagentsFromRulesyncSubagents(rulesyncSubagents);

              // Count the generated files
              const outputDir = join(
                baseDir === process.cwd() ? "." : baseDir,
                ".claude",
                "agents",
              );
              if (await fileExists(outputDir)) {
                const { readdir } = await import("node:fs/promises");
                const files = await readdir(outputDir);
                const generatedCount = files.filter((file) => file.endsWith(".md")).length;
                totalSubagentOutputs += generatedCount;

                if (generatedCount > 0) {
                  logger.success(
                    `Generated ${generatedCount} Claude Code subagent(s) in ${outputDir}`,
                  );
                }
              }
            } catch (error) {
              logger.warn(
                `Failed to generate subagents for ${baseDir}: ${error instanceof Error ? error.message : String(error)}`,
              );
              continue;
            }
          }
        } else {
          logger.info("Skipping subagent generation (claudecode not in target tools)");
        }
      } else {
        logger.info("\nSkipping subagent file generation (not in --features)");
      }

      // Check if any features generated content
      const totalGenerated =
        totalOutputs +
        totalMcpOutputs +
        totalCommandOutputs +
        totalIgnoreOutputs +
        totalSubagentOutputs;
      if (totalGenerated === 0) {
        const enabledFeatures = normalizedFeatures.join(", ");
        logger.warn(`⚠️  No files generated for enabled features: ${enabledFeatures}`);
        return;
      }

      // Final success message
      if (totalGenerated > 0) {
        const parts = [];
        if (totalOutputs > 0) parts.push(`${totalOutputs} configurations`);
        if (totalMcpOutputs > 0) parts.push(`${totalMcpOutputs} MCP configurations`);
        if (totalCommandOutputs > 0) parts.push(`${totalCommandOutputs} commands`);
        if (totalSubagentOutputs > 0) parts.push(`${totalSubagentOutputs} subagents`);

        logger.success(
          `\n🎉 All done! Generated ${totalGenerated} file(s) total (${parts.join(" + ")})`,
        );
      }
    } catch (error) {
      logger.error("❌ Failed to generate configurations:", error);
      process.exit(1);
    }
  } catch (error) {
    logger.error("❌ Failed to resolve configuration:", error);
    process.exit(1);
  }
}

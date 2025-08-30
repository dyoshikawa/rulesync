import { intersection } from "es-toolkit";
import {
  CommandsProcessor,
  type CommandsProcessorToolTarget,
} from "../../commands/commands-processor.js";
import { type CliOptions, CliParser, ConfigResolver } from "../../core/config/index.js";
import { IgnoreProcessor } from "../../ignore/ignore-processor.js";
import { McpProcessor, type McpProcessorToolTarget } from "../../mcp/mcp-processor.js";
import { RulesProcessor } from "../../rules/rules-processor.js";
import { SubagentsProcessor } from "../../subagents/subagents-processor.js";
import type { FeatureType } from "../../types/config-options.js";
import type { ToolTarget } from "../../types/index.js";
import { normalizeFeatures } from "../../utils/feature-validator.js";
import { fileExists } from "../../utils/index.js";
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
      logger.info(`Base directories: ${baseDirs.join(", ")}`);
      // Generate rule files (rules feature)
      let totalOutputs = 0;
      if (normalizedFeatures.includes("rules")) {
        logger.info("\nGenerating rule files...");
        for (const baseDir of baseDirs) {
          for (const toolTarget of intersection(
            config.defaultTargets,
            RulesProcessor.getToolTargets(),
          )) {
            const processor = new RulesProcessor({
              baseDir: baseDir,
              toolTarget: toolTarget,
            });

            const rulesyncFiles = await processor.loadRulesyncFiles();
            const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
            const writtenCount = await processor.writeAiFiles(toolFiles);
            totalOutputs += writtenCount;
            logger.success(`Generated ${writtenCount} ${toolTarget} rule(s) in ${baseDir}`);
          }
        }
      } else {
        logger.info("\nSkipping rule generation (not in --features)");
      }

      // Generate MCP configurations (mcp feature)
      let totalMcpOutputs = 0;
      if (normalizedFeatures.includes("mcp")) {
        logger.info("\nGenerating MCP files...");

        // Check which targets support MCP
        const supportedMcpTargets: McpProcessorToolTarget[] = [
          "amazonqcli",
          "claudecode", 
          "cline",
          "copilot",
          "cursor",
          "roo",
        ];
        const mcpSupportedTargets = config.defaultTargets.filter(
          (target): target is McpProcessorToolTarget => {
            return supportedMcpTargets.some((supportedTarget) => supportedTarget === target);
          },
        );

        for (const baseDir of baseDirs) {
          for (const toolTarget of intersection(
            mcpSupportedTargets,
            McpProcessor.getToolTargets(),
          )) {
            const processor = new McpProcessor({
              baseDir: baseDir,
              toolTarget: toolTarget,
            });

            const rulesyncFiles = await processor.loadRulesyncFiles();
            const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
            const writtenCount = await processor.writeAiFiles(toolFiles);
            totalMcpOutputs += writtenCount;
            logger.success(`Generated ${writtenCount} ${toolTarget} MCP configuration(s) in ${baseDir}`);
          }
        }
      } else {
        logger.info("\nSkipping MCP configuration generation (not in --features)");
      }

      // Generate command files (commands feature)
      let totalCommandOutputs = 0;
      if (normalizedFeatures.includes("commands")) {
        logger.info("\nGenerating command files...");

        // Check which targets support commands
        const supportedCommandTargets: CommandsProcessorToolTarget[] = [
          "claudecode",
          "geminicli",
          "roo",
        ];
        const commandSupportedTargets = config.defaultTargets.filter(
          (target): target is CommandsProcessorToolTarget => {
            return supportedCommandTargets.some((supportedTarget) => supportedTarget === target);
          },
        );

        for (const baseDir of baseDirs) {
          for (const toolTarget of intersection(
            commandSupportedTargets,
            CommandsProcessor.getToolTargets(),
          )) {
            const processor = new CommandsProcessor({
              baseDir: baseDir,
              toolTarget: toolTarget,
            });

            const rulesyncFiles = await processor.loadRulesyncFiles();
            const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
            const writtenCount = await processor.writeAiFiles(toolFiles);
            totalCommandOutputs += writtenCount;
            logger.success(`Generated ${writtenCount} ${toolTarget} command(s) in ${baseDir}`);
          }
        }
      } else {
        logger.info("\nSkipping command file generation (not in --features)");
      }

      // Generate ignore files (ignore feature)
      let totalIgnoreOutputs = 0;
      if (normalizedFeatures.includes("ignore")) {
        logger.info("\nGenerating ignore files...");

        for (const toolTarget of intersection(
          config.defaultTargets,
          IgnoreProcessor.getToolTargets(),
        )) {
          for (const baseDir of baseDirs) {
            try {
              const processor = new IgnoreProcessor({
                baseDir: baseDir === process.cwd() ? "." : baseDir,
                toolTarget,
              });

              const rulesyncFiles = await processor.loadRulesyncFiles();
              if (rulesyncFiles.length > 0) {
                const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
                const writtenCount = await processor.writeAiFiles(toolFiles);
                totalIgnoreOutputs += writtenCount;
                logger.success(
                  `Generated ${writtenCount} ${toolTarget} ignore file(s) in ${baseDir}`,
                );
              }
            } catch (error) {
              logger.warn(
                `Failed to generate ${toolTarget} ignore files for ${baseDir}:`,
                error instanceof Error ? error.message : String(error),
              );
              continue;
            }
          }
        }
      }

      // Generate subagent files (subagents feature)
      let totalSubagentOutputs = 0;
      if (normalizedFeatures.includes("subagents")) {
        logger.info("\nGenerating subagent files...");
        for (const baseDir of baseDirs) {
          for (const toolTarget of intersection(
            config.defaultTargets,
            SubagentsProcessor.getToolTargets(),
          )) {
            const processor = new SubagentsProcessor({
              baseDir: baseDir,
              toolTarget: toolTarget,
            });

            const rulesyncFiles = await processor.loadRulesyncFiles();
            const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
            const writtenCount = await processor.writeAiFiles(toolFiles);
            totalSubagentOutputs += writtenCount;
            logger.success(`Generated ${writtenCount} ${toolTarget} subagent(s) in ${baseDir}`);
          }
        }
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

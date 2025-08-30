import { intersection } from "es-toolkit";
import {
  CommandsProcessor,
  type CommandsProcessorToolTarget,
} from "../../commands/commands-processor.js";
import { ConfigResolver, type ConfigResolverResolveParams } from "../../config/config-resolver.js";
import { IgnoreProcessor } from "../../ignore/ignore-processor.js";
import { McpProcessor, type McpProcessorToolTarget } from "../../mcp/mcp-processor.js";
import { RulesProcessor } from "../../rules/rules-processor.js";
import { SubagentsProcessor } from "../../subagents/subagents-processor.js";
import { fileExists } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";

export type GenerateOptions = ConfigResolverResolveParams;

export async function generateCommand(options: GenerateOptions): Promise<void> {
  try {
    const config = await ConfigResolver.resolve(options);

    // Set logger verbosity based on config
    logger.setVerbose(config.getVerbose() || false);

    logger.log("Generating configuration files...");

    // Check if .rulesync directory exists
    if (!(await fileExists(".rulesync"))) {
      logger.error("❌ .rulesync directory not found. Run 'rulesync init' first.");
      process.exit(1);
    }

    try {
      logger.info(`Base directories: ${config.getBaseDirs().join(", ")}`);
      // Generate rule files (rules feature)
      let totalOutputs = 0;
      if (config.getFeatures().includes("rules")) {
        logger.info("\nGenerating rule files...");
        for (const baseDir of config.getBaseDirs()) {
          for (const toolTarget of intersection(
            config.getTargets(),
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
      if (config.getFeatures().includes("mcp")) {
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
        const mcpSupportedTargets = config
          .getTargets()
          .filter((target): target is McpProcessorToolTarget => {
            return supportedMcpTargets.some((supportedTarget) => supportedTarget === target);
          });

        for (const baseDir of config.getBaseDirs()) {
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
            logger.success(
              `Generated ${writtenCount} ${toolTarget} MCP configuration(s) in ${baseDir}`,
            );
          }
        }
      } else {
        logger.info("\nSkipping MCP configuration generation (not in --features)");
      }

      // Generate command files (commands feature)
      let totalCommandOutputs = 0;
      if (config.getFeatures().includes("commands")) {
        logger.info("\nGenerating command files...");

        // Check which targets support commands
        const supportedCommandTargets: CommandsProcessorToolTarget[] = [
          "claudecode",
          "geminicli",
          "roo",
        ];
        const commandSupportedTargets = config
          .getTargets()
          .filter((target): target is CommandsProcessorToolTarget => {
            return supportedCommandTargets.some((supportedTarget) => supportedTarget === target);
          });

        for (const baseDir of config.getBaseDirs()) {
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
      if (config.getFeatures().includes("ignore")) {
        logger.info("\nGenerating ignore files...");

        for (const toolTarget of intersection(
          config.getTargets(),
          IgnoreProcessor.getToolTargets(),
        )) {
          for (const baseDir of config.getBaseDirs()) {
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
      if (config.getFeatures().includes("subagents")) {
        logger.info("\nGenerating subagent files...");
        for (const baseDir of config.getBaseDirs()) {
          for (const toolTarget of intersection(
            config.getTargets(),
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
        const enabledFeatures = config.getFeatures().join(", ");
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

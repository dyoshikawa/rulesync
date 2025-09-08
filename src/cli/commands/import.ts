import { CommandsProcessor } from "../../commands/commands-processor.js";
import { ConfigResolver, ConfigResolverResolveParams } from "../../config/config-resolver.js";
import { IgnoreProcessor } from "../../ignore/ignore-processor.js";
import { McpProcessor } from "../../mcp/mcp-processor.js";
import { RulesProcessor } from "../../rules/rules-processor.js";
import { SubagentsProcessor } from "../../subagents/subagents-processor.js";
import { logger } from "../../utils/logger.js";

export type ImportOptions = Omit<ConfigResolverResolveParams, "delete" | "baseDirs">;

export async function importCommand(options: ImportOptions): Promise<void> {
  if (!options.targets) {
    logger.error("No tools found in --targets");
    process.exit(1);
  }

  if (options.targets.length > 1) {
    logger.error("Only one tool can be imported at a time");
    process.exit(1);
  }

  const config = await ConfigResolver.resolve(options);

  // Set logger verbosity based on options
  logger.setVerbose(config.getVerbose());

  // eslint-disable-next-line no-type-assertion/no-type-assertion
  const tool = config.getTargets()[0]!;

  // Import rule files using RulesProcessor if rules feature is enabled
  let rulesCreated = 0;
  if (config.getFeatures().includes("rules")) {
    if (RulesProcessor.getToolTargets().includes(tool)) {
      const rulesProcessor = new RulesProcessor({
        baseDir: ".",
        toolTarget: tool,
      });

      const toolFiles = await rulesProcessor.loadToolFiles();
      if (toolFiles.length > 0) {
        const rulesyncFiles = await rulesProcessor.convertToolFilesToRulesyncFiles(toolFiles);
        const writtenCount = await rulesProcessor.writeAiFiles(rulesyncFiles);
        rulesCreated = writtenCount;
      }

      if (config.getVerbose() && rulesCreated > 0) {
        logger.success(`Created ${rulesCreated} rule files`);
      }
    }
  }

  // Process ignore files if ignore feature is enabled
  let ignoreFileCreated = 0;
  if (config.getFeatures().includes("ignore")) {
    if (IgnoreProcessor.getToolTargets().includes(tool)) {
      const ignoreProcessor = new IgnoreProcessor({
        baseDir: ".",
        toolTarget: tool,
      });

      const toolFiles = await ignoreProcessor.loadToolFiles();
      if (toolFiles.length > 0) {
        const rulesyncFiles = await ignoreProcessor.convertToolFilesToRulesyncFiles(toolFiles);
        const writtenCount = await ignoreProcessor.writeAiFiles(rulesyncFiles);
        ignoreFileCreated = writtenCount;
        if (config.getVerbose()) {
          logger.success(
            `Created ignore files from ${toolFiles.length} tool ignore configurations`,
          );
        }
      }
    }

    if (config.getVerbose() && ignoreFileCreated > 0) {
      logger.success(`Created ${ignoreFileCreated} ignore files`);
    }
  }

  // Create MCP files if mcp feature is enabled
  let mcpCreated = 0;
  if (config.getFeatures().includes("mcp")) {
    if (McpProcessor.getToolTargets().includes(tool)) {
      const mcpProcessor = new McpProcessor({
        baseDir: ".",
        toolTarget: tool,
      });

      const toolFiles = await mcpProcessor.loadToolFiles();
      if (toolFiles.length > 0) {
        const rulesyncFiles = await mcpProcessor.convertToolFilesToRulesyncFiles(toolFiles);
        const writtenCount = await mcpProcessor.writeAiFiles(rulesyncFiles);
        mcpCreated = writtenCount;
      }
    }
  }

  if (config.getVerbose() && mcpCreated > 0) {
    logger.success(`Created ${mcpCreated} MCP files`);
  }

  // Create subagent files if subagents feature is enabled
  let subagentsCreated = 0;
  if (config.getFeatures().includes("subagents")) {
    // Use SubagentsProcessor for supported tools, excluding simulated ones
    const supportedTargets = SubagentsProcessor.getToolTargets({ includeSimulated: false });
    if (supportedTargets.includes(tool)) {
      const subagentsProcessor = new SubagentsProcessor({
        baseDir: ".",
        toolTarget: tool,
      });

      const toolFiles = await subagentsProcessor.loadToolFiles();
      if (toolFiles.length > 0) {
        const rulesyncFiles = await subagentsProcessor.convertToolFilesToRulesyncFiles(toolFiles);
        const writtenCount = await subagentsProcessor.writeAiFiles(rulesyncFiles);
        subagentsCreated += writtenCount;
      }
    }

    if (config.getVerbose() && subagentsCreated > 0) {
      logger.success(`Created ${subagentsCreated} subagent files`);
    }
  }

  // Create command files using CommandsProcessor if commands feature is enabled
  let commandsCreated = 0;
  if (config.getFeatures().includes("commands")) {
    // Use CommandsProcessor for supported tools, excluding simulated ones
    const supportedTargets = CommandsProcessor.getToolTargets({ includeSimulated: false });
    if (supportedTargets.includes(tool)) {
      const commandsProcessor = new CommandsProcessor({
        baseDir: ".",
        toolTarget: tool,
      });

      const toolFiles = await commandsProcessor.loadToolFiles();
      if (toolFiles.length > 0) {
        const rulesyncFiles = await commandsProcessor.convertToolFilesToRulesyncFiles(toolFiles);
        const writtenCount = await commandsProcessor.writeAiFiles(rulesyncFiles);
        commandsCreated = writtenCount;
      }
    }

    if (config.getVerbose() && commandsCreated > 0) {
      logger.success(`Created ${commandsCreated} command files`);
    }
  }
}

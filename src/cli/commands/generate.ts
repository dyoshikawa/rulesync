import { intersection } from "es-toolkit";

import { ConfigResolver, type ConfigResolverResolveParams } from "../../config/config-resolver.js";
import { Config } from "../../config/config.js";
import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { CommandsProcessor } from "../../features/commands/commands-processor.js";
import { IgnoreProcessor } from "../../features/ignore/ignore-processor.js";
import { McpProcessor } from "../../features/mcp/mcp-processor.js";
import { RulesProcessor } from "../../features/rules/rules-processor.js";
import { RulesyncSkill } from "../../features/skills/rulesync-skill.js";
import { SkillsProcessor } from "../../features/skills/skills-processor.js";
import { SubagentsProcessor } from "../../features/subagents/subagents-processor.js";
import { fileExists } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";

export type GenerateOptions = ConfigResolverResolveParams;

export async function generateCommand(options: GenerateOptions): Promise<void> {
  const config = await ConfigResolver.resolve(options);

  // Set logger verbosity and silent mode based on config
  logger.setVerbose(config.getVerbose());
  logger.setSilent(config.getSilent());

  logger.info("Generating files...");

  // Check if .rulesync directory exists
  if (!(await fileExists(RULESYNC_RELATIVE_DIR_PATH))) {
    logger.error("❌ .rulesync directory not found. Run 'rulesync init' first.");
    process.exit(1);
  }

  logger.info(`Base directories: ${config.getBaseDirs().join(", ")}`);

  // Generate ignore files (ignore feature)
  const totalIgnoreOutputs = await generateIgnore(config);

  // Generate MCP configurations (mcp feature)
  const totalMcpOutputs = await generateMcp(config);

  // Generate command files (commands feature)
  const totalCommandOutputs = await generateCommands(config);

  // Generate subagent files (subagents feature)
  const totalSubagentOutputs = await generateSubagents(config);

  // Generate skill files (skills feature)
  const skillsResult = await generateSkills(config);

  // Generate rule files (rules feature)
  const totalRulesOutputs = await generateRules(config, {
    skills: skillsResult.skills,
  });

  // Check if any features generated content
  const totalGenerated =
    totalRulesOutputs +
    totalMcpOutputs +
    totalCommandOutputs +
    totalIgnoreOutputs +
    totalSubagentOutputs +
    skillsResult.totalOutputs;
  if (totalGenerated === 0) {
    const enabledFeatures = config.getFeatures().join(", ");
    logger.warn(`⚠️  No files generated for enabled features: ${enabledFeatures}`);
    return;
  }

  // Final success message
  if (totalGenerated > 0) {
    const parts = [];
    if (totalRulesOutputs > 0) parts.push(`${totalRulesOutputs} rules`);
    if (totalIgnoreOutputs > 0) parts.push(`${totalIgnoreOutputs} ignore files`);
    if (totalMcpOutputs > 0) parts.push(`${totalMcpOutputs} MCP files`);
    if (totalCommandOutputs > 0) parts.push(`${totalCommandOutputs} commands`);
    if (totalSubagentOutputs > 0) parts.push(`${totalSubagentOutputs} subagents`);
    if (skillsResult.totalOutputs > 0) parts.push(`${skillsResult.totalOutputs} skills`);

    logger.success(`🎉 All done! Generated ${totalGenerated} file(s) total (${parts.join(" + ")})`);
  }
}

async function generateRules(
  config: Config,
  options?: { skills?: RulesyncSkill[] },
): Promise<number> {
  if (!config.getFeatures().includes("rules")) {
    logger.debug("Skipping rule generation (not in --features)");
    return 0;
  }

  let totalRulesOutputs = 0;
  logger.info("Generating rule files...");

  const toolTargets = intersection(
    config.getTargets(),
    RulesProcessor.getToolTargets({ global: config.getGlobal() }),
  );
  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      const processor = new RulesProcessor({
        baseDir: baseDir,
        toolTarget: toolTarget,
        global: config.getGlobal(),
        simulateCommands: config.getSimulateCommands(),
        simulateSubagents: config.getSimulateSubagents(),
        simulateSkills: config.getSimulateSkills(),
        skills: options?.skills,
      });

      if (config.getDelete()) {
        const oldToolFiles = await processor.loadToolFiles({ forDeletion: true });
        await processor.removeAiFiles(oldToolFiles);
      }

      const rulesyncFiles = await processor.loadRulesyncFiles();

      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      const writtenCount = await processor.writeAiFiles(toolFiles);
      totalRulesOutputs += writtenCount;
      logger.success(`Generated ${writtenCount} ${toolTarget} rule(s) in ${baseDir}`);
    }
  }
  return totalRulesOutputs;
}

async function generateIgnore(config: Config): Promise<number> {
  if (!config.getFeatures().includes("ignore")) {
    logger.debug("Skipping ignore file generation (not in --features)");
    return 0;
  }

  if (config.getGlobal()) {
    logger.debug("Skipping ignore file generation (not supported in global mode)");
    return 0;
  }

  let totalIgnoreOutputs = 0;
  logger.info("Generating ignore files...");

  for (const toolTarget of intersection(config.getTargets(), IgnoreProcessor.getToolTargets())) {
    for (const baseDir of config.getBaseDirs()) {
      try {
        const processor = new IgnoreProcessor({
          baseDir: baseDir === process.cwd() ? "." : baseDir,
          toolTarget,
        });

        if (config.getDelete()) {
          const oldToolFiles = await processor.loadToolFiles({ forDeletion: true });
          await processor.removeAiFiles(oldToolFiles);
        }

        const rulesyncFiles = await processor.loadRulesyncFiles();
        if (rulesyncFiles.length > 0) {
          const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
          const writtenCount = await processor.writeAiFiles(toolFiles);
          totalIgnoreOutputs += writtenCount;
          logger.success(`Generated ${writtenCount} ${toolTarget} ignore file(s) in ${baseDir}`);
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

  return totalIgnoreOutputs;
}

async function generateMcp(config: Config): Promise<number> {
  if (!config.getFeatures().includes("mcp")) {
    logger.debug("Skipping MCP configuration generation (not in --features)");
    return 0;
  }

  let totalMcpOutputs = 0;
  logger.info("Generating MCP files...");

  if (config.getModularMcp()) {
    logger.info("ℹ️  Modular MCP support is experimental.");
  }

  const toolTargets = intersection(
    config.getTargets(),
    McpProcessor.getToolTargets({ global: config.getGlobal() }),
  );
  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      const processor = new McpProcessor({
        baseDir: baseDir,
        toolTarget: toolTarget,
        global: config.getGlobal(),
        modularMcp: config.getModularMcp(),
      });

      if (config.getDelete()) {
        const oldToolFiles = await processor.loadToolFiles({ forDeletion: true });
        await processor.removeAiFiles(oldToolFiles);
      }

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      const writtenCount = await processor.writeAiFiles(toolFiles);
      totalMcpOutputs += writtenCount;
      logger.success(`Generated ${writtenCount} ${toolTarget} MCP configuration(s) in ${baseDir}`);
    }
  }

  return totalMcpOutputs;
}

async function generateCommands(config: Config): Promise<number> {
  if (!config.getFeatures().includes("commands")) {
    logger.debug("Skipping command file generation (not in --features)");
    return 0;
  }

  let totalCommandOutputs = 0;
  logger.info("Generating command files...");

  const toolTargets = intersection(
    config.getTargets(),
    CommandsProcessor.getToolTargets({
      global: config.getGlobal(),
      includeSimulated: config.getSimulateCommands(),
    }),
  );

  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      const processor = new CommandsProcessor({
        baseDir: baseDir,
        toolTarget: toolTarget,
        global: config.getGlobal(),
      });

      if (config.getDelete()) {
        const oldToolFiles = await processor.loadToolFiles({ forDeletion: true });
        await processor.removeAiFiles(oldToolFiles);
      }

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      const writtenCount = await processor.writeAiFiles(toolFiles);
      totalCommandOutputs += writtenCount;
      logger.success(`Generated ${writtenCount} ${toolTarget} command(s) in ${baseDir}`);
    }
  }

  return totalCommandOutputs;
}

async function generateSubagents(config: Config): Promise<number> {
  if (!config.getFeatures().includes("subagents")) {
    logger.debug("Skipping subagent file generation (not in --features)");
    return 0;
  }

  let totalSubagentOutputs = 0;
  logger.info("Generating subagent files...");

  const toolTargets = intersection(
    config.getTargets(),
    SubagentsProcessor.getToolTargets({
      global: config.getGlobal(),
      includeSimulated: config.getSimulateSubagents(),
    }),
  );

  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      const processor = new SubagentsProcessor({
        baseDir: baseDir,
        toolTarget: toolTarget,
        global: config.getGlobal(),
      });

      if (config.getDelete()) {
        const oldToolFiles = await processor.loadToolFiles({ forDeletion: true });
        await processor.removeAiFiles(oldToolFiles);
      }

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      const writtenCount = await processor.writeAiFiles(toolFiles);
      totalSubagentOutputs += writtenCount;
      logger.success(`Generated ${writtenCount} ${toolTarget} subagent(s) in ${baseDir}`);
    }
  }

  return totalSubagentOutputs;
}

async function generateSkills(
  config: Config,
): Promise<{ totalOutputs: number; skills: RulesyncSkill[] }> {
  if (!config.getFeatures().includes("skills")) {
    logger.debug("Skipping skill generation (not in --features)");
    return { totalOutputs: 0, skills: [] };
  }

  let totalSkillOutputs = 0;
  const allSkills: RulesyncSkill[] = [];
  logger.info("Generating skill files...");

  const toolTargets = intersection(
    config.getTargets(),
    SkillsProcessor.getToolTargets({
      global: config.getGlobal(),
      includeSimulated: config.getSimulateSkills(),
    }),
  );

  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      const processor = new SkillsProcessor({
        baseDir: baseDir,
        toolTarget: toolTarget,
        global: config.getGlobal(),
      });

      if (config.getDelete()) {
        const oldToolDirs = await processor.loadToolDirsToDelete();
        await processor.removeAiDirs(oldToolDirs);
      }

      const rulesyncDirs = await processor.loadRulesyncDirs();

      // Collect RulesyncSkill instances
      for (const rulesyncDir of rulesyncDirs) {
        if (rulesyncDir instanceof RulesyncSkill) {
          allSkills.push(rulesyncDir);
        }
      }

      const toolDirs = await processor.convertRulesyncDirsToToolDirs(rulesyncDirs);
      const writtenCount = await processor.writeAiDirs(toolDirs);
      totalSkillOutputs += writtenCount;
      logger.success(`Generated ${writtenCount} ${toolTarget} skill(s) in ${baseDir}`);
    }
  }

  return { totalOutputs: totalSkillOutputs, skills: allSkills };
}

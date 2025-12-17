import { intersection } from "es-toolkit";
import { Config } from "../../config/config.js";
import { ConfigResolver, type ConfigResolverResolveParams } from "../../config/config-resolver.js";
import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { CommandsProcessor } from "../../features/commands/commands-processor.js";
import { IgnoreProcessor } from "../../features/ignore/ignore-processor.js";
import { McpProcessor } from "../../features/mcp/mcp-processor.js";
import { RulesProcessor } from "../../features/rules/rules-processor.js";
import { RulesyncSkill } from "../../features/skills/rulesync-skill.js";
import { SkillsProcessor } from "../../features/skills/skills-processor.js";
import { SubagentsProcessor } from "../../features/subagents/subagents-processor.js";
import type { FileComparisonResult } from "../../types/file-comparison.js";
import { fileExists } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";

/**
 * Result type for generate functions to support both normal and check modes
 */
type GenerateResult = {
  /** Number of files written (normal mode) or would be written (check mode) */
  count: number;
  /** Comparison results (only in check mode) */
  comparisonResults: FileComparisonResult[];
};

/**
 * Log comparison results for check mode
 */
function logComparisonResults(results: FileComparisonResult[]): void {
  for (const result of results) {
    if (result.status === "create") {
      logger.info(`Would create: ${result.filePath}`);
    } else if (result.status === "update") {
      logger.info(`Would update: ${result.filePath}`);
    } else if (result.status === "delete") {
      logger.info(`Would delete: ${result.filePath}`);
    }
  }
}

export type GenerateOptions = ConfigResolverResolveParams;

export async function generateCommand(options: GenerateOptions): Promise<void> {
  const config = await ConfigResolver.resolve(options);

  // Set logger verbosity based on config
  logger.setVerbose(config.getVerbose());

  const isCheckMode = config.getCheck();
  if (isCheckMode) {
    logger.info("Checking files...");
  } else {
    logger.info("Generating files...");
  }

  // Check if .rulesync directory exists
  if (!(await fileExists(RULESYNC_RELATIVE_DIR_PATH))) {
    logger.error("❌ .rulesync directory not found. Run 'rulesync init' first.");
    process.exit(1);
  }

  logger.info(`Base directories: ${config.getBaseDirs().join(", ")}`);

  // Collect all comparison results for check mode
  const allComparisonResults: FileComparisonResult[] = [];

  // Generate ignore files (ignore feature)
  const ignoreResult = await generateIgnore(config);
  allComparisonResults.push(...ignoreResult.comparisonResults);

  // Generate MCP configurations (mcp feature)
  const mcpResult = await generateMcp(config);
  allComparisonResults.push(...mcpResult.comparisonResults);

  // Generate command files (commands feature)
  const commandsResult = await generateCommands(config);
  allComparisonResults.push(...commandsResult.comparisonResults);

  // Generate subagent files (subagents feature)
  const subagentsResult = await generateSubagents(config);
  allComparisonResults.push(...subagentsResult.comparisonResults);

  // Generate skill files (skills feature)
  const skillsResult = await generateSkills(config);
  allComparisonResults.push(...skillsResult.comparisonResults);

  // Generate rule files (rules feature)
  const rulesResult = await generateRules(config, {
    skills: skillsResult.skills,
  });
  allComparisonResults.push(...rulesResult.comparisonResults);

  // Check if any features generated content
  const totalGenerated =
    rulesResult.count +
    mcpResult.count +
    commandsResult.count +
    ignoreResult.count +
    subagentsResult.count +
    skillsResult.count;

  if (isCheckMode) {
    // In check mode, log comparison results and exit with appropriate code
    logComparisonResults(allComparisonResults);

    const outOfSyncCount = allComparisonResults.filter((r) => r.status !== "unchanged").length;
    if (outOfSyncCount > 0) {
      logger.error(`${outOfSyncCount} file(s) out of sync.`);
      process.exit(1);
    } else if (totalGenerated === 0) {
      const enabledFeatures = config.getFeatures().join(", ");
      logger.warn(`⚠️  No files to check for enabled features: ${enabledFeatures}`);
    } else {
      logger.success("All files are up to date.");
    }
    return;
  }

  if (totalGenerated === 0) {
    const enabledFeatures = config.getFeatures().join(", ");
    logger.warn(`⚠️  No files generated for enabled features: ${enabledFeatures}`);
    return;
  }

  // Final success message
  if (totalGenerated > 0) {
    const parts = [];
    if (rulesResult.count > 0) parts.push(`${rulesResult.count} rules`);
    if (ignoreResult.count > 0) parts.push(`${ignoreResult.count} ignore files`);
    if (mcpResult.count > 0) parts.push(`${mcpResult.count} MCP files`);
    if (commandsResult.count > 0) parts.push(`${commandsResult.count} commands`);
    if (subagentsResult.count > 0) parts.push(`${subagentsResult.count} subagents`);
    if (skillsResult.count > 0) parts.push(`${skillsResult.count} skills`);

    logger.success(`🎉 All done! Generated ${totalGenerated} file(s) total (${parts.join(" + ")})`);
  }
}

async function generateRules(
  config: Config,
  options?: { skills?: RulesyncSkill[] },
): Promise<GenerateResult> {
  if (!config.getFeatures().includes("rules")) {
    logger.debug("Skipping rule generation (not in --features)");
    return { count: 0, comparisonResults: [] };
  }

  let totalRulesOutputs = 0;
  const comparisonResults: FileComparisonResult[] = [];
  const isCheckMode = config.getCheck();

  if (isCheckMode) {
    logger.info("Checking rule files...");
  } else {
    logger.info("Generating rule files...");
  }

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

      // Handle deletion (or report what would be deleted in check mode)
      if (config.getDelete()) {
        const oldToolFiles = await processor.loadToolFiles({ forDeletion: true });
        if (isCheckMode) {
          for (const file of oldToolFiles) {
            comparisonResults.push({ filePath: file.getFilePath(), status: "delete" });
          }
        } else {
          await processor.removeAiFiles(oldToolFiles);
        }
      }

      let rulesyncFiles = await processor.loadRulesyncFiles();
      if (rulesyncFiles.length === 0) {
        rulesyncFiles = await processor.loadRulesyncFilesLegacy();
      }

      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);

      if (isCheckMode) {
        const compareResult = await processor.compareAiFiles(toolFiles);
        comparisonResults.push(...compareResult.results);
        totalRulesOutputs += toolFiles.length;
      } else {
        const writtenCount = await processor.writeAiFiles(toolFiles);
        totalRulesOutputs += writtenCount;
        logger.success(`Generated ${writtenCount} ${toolTarget} rule(s) in ${baseDir}`);
      }
    }
  }
  return { count: totalRulesOutputs, comparisonResults };
}

async function generateIgnore(config: Config): Promise<GenerateResult> {
  if (!config.getFeatures().includes("ignore")) {
    logger.debug("Skipping ignore file generation (not in --features)");
    return { count: 0, comparisonResults: [] };
  }

  if (config.getGlobal()) {
    logger.debug("Skipping ignore file generation (not supported in global mode)");
    return { count: 0, comparisonResults: [] };
  }

  let totalIgnoreOutputs = 0;
  const comparisonResults: FileComparisonResult[] = [];
  const isCheckMode = config.getCheck();

  if (isCheckMode) {
    logger.info("Checking ignore files...");
  } else {
    logger.info("Generating ignore files...");
  }

  for (const toolTarget of intersection(config.getTargets(), IgnoreProcessor.getToolTargets())) {
    for (const baseDir of config.getBaseDirs()) {
      try {
        const processor = new IgnoreProcessor({
          baseDir: baseDir === process.cwd() ? "." : baseDir,
          toolTarget,
        });

        // Handle deletion (or report what would be deleted in check mode)
        if (config.getDelete()) {
          const oldToolFiles = await processor.loadToolFiles({ forDeletion: true });
          if (isCheckMode) {
            for (const file of oldToolFiles) {
              comparisonResults.push({ filePath: file.getFilePath(), status: "delete" });
            }
          } else {
            await processor.removeAiFiles(oldToolFiles);
          }
        }

        const rulesyncFiles = await processor.loadRulesyncFiles();
        if (rulesyncFiles.length > 0) {
          const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);

          if (isCheckMode) {
            const compareResult = await processor.compareAiFiles(toolFiles);
            comparisonResults.push(...compareResult.results);
            totalIgnoreOutputs += toolFiles.length;
          } else {
            const writtenCount = await processor.writeAiFiles(toolFiles);
            totalIgnoreOutputs += writtenCount;
            logger.success(`Generated ${writtenCount} ${toolTarget} ignore file(s) in ${baseDir}`);
          }
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

  return { count: totalIgnoreOutputs, comparisonResults };
}

async function generateMcp(config: Config): Promise<GenerateResult> {
  if (!config.getFeatures().includes("mcp")) {
    logger.debug("Skipping MCP configuration generation (not in --features)");
    return { count: 0, comparisonResults: [] };
  }

  let totalMcpOutputs = 0;
  const comparisonResults: FileComparisonResult[] = [];
  const isCheckMode = config.getCheck();

  if (isCheckMode) {
    logger.info("Checking MCP files...");
  } else {
    logger.info("Generating MCP files...");
  }

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

      // Handle deletion (or report what would be deleted in check mode)
      if (config.getDelete()) {
        const oldToolFiles = await processor.loadToolFiles({ forDeletion: true });
        if (isCheckMode) {
          for (const file of oldToolFiles) {
            comparisonResults.push({ filePath: file.getFilePath(), status: "delete" });
          }
        } else {
          await processor.removeAiFiles(oldToolFiles);
        }
      }

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);

      if (isCheckMode) {
        const compareResult = await processor.compareAiFiles(toolFiles);
        comparisonResults.push(...compareResult.results);
        totalMcpOutputs += toolFiles.length;
      } else {
        const writtenCount = await processor.writeAiFiles(toolFiles);
        totalMcpOutputs += writtenCount;
        logger.success(
          `Generated ${writtenCount} ${toolTarget} MCP configuration(s) in ${baseDir}`,
        );
      }
    }
  }

  return { count: totalMcpOutputs, comparisonResults };
}

async function generateCommands(config: Config): Promise<GenerateResult> {
  if (!config.getFeatures().includes("commands")) {
    logger.debug("Skipping command file generation (not in --features)");
    return { count: 0, comparisonResults: [] };
  }

  let totalCommandOutputs = 0;
  const comparisonResults: FileComparisonResult[] = [];
  const isCheckMode = config.getCheck();

  if (isCheckMode) {
    logger.info("Checking command files...");
  } else {
    logger.info("Generating command files...");
  }

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

      // Handle deletion (or report what would be deleted in check mode)
      if (config.getDelete()) {
        const oldToolFiles = await processor.loadToolFiles({ forDeletion: true });
        if (isCheckMode) {
          for (const file of oldToolFiles) {
            comparisonResults.push({ filePath: file.getFilePath(), status: "delete" });
          }
        } else {
          await processor.removeAiFiles(oldToolFiles);
        }
      }

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);

      if (isCheckMode) {
        const compareResult = await processor.compareAiFiles(toolFiles);
        comparisonResults.push(...compareResult.results);
        totalCommandOutputs += toolFiles.length;
      } else {
        const writtenCount = await processor.writeAiFiles(toolFiles);
        totalCommandOutputs += writtenCount;
        logger.success(`Generated ${writtenCount} ${toolTarget} command(s) in ${baseDir}`);
      }
    }
  }

  return { count: totalCommandOutputs, comparisonResults };
}

async function generateSubagents(config: Config): Promise<GenerateResult> {
  if (!config.getFeatures().includes("subagents")) {
    logger.debug("Skipping subagent file generation (not in --features)");
    return { count: 0, comparisonResults: [] };
  }

  let totalSubagentOutputs = 0;
  const comparisonResults: FileComparisonResult[] = [];
  const isCheckMode = config.getCheck();

  if (isCheckMode) {
    logger.info("Checking subagent files...");
  } else {
    logger.info("Generating subagent files...");
  }

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

      // Handle deletion (or report what would be deleted in check mode)
      if (config.getDelete()) {
        const oldToolFiles = await processor.loadToolFiles({ forDeletion: true });
        if (isCheckMode) {
          for (const file of oldToolFiles) {
            comparisonResults.push({ filePath: file.getFilePath(), status: "delete" });
          }
        } else {
          await processor.removeAiFiles(oldToolFiles);
        }
      }

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);

      if (isCheckMode) {
        const compareResult = await processor.compareAiFiles(toolFiles);
        comparisonResults.push(...compareResult.results);
        totalSubagentOutputs += toolFiles.length;
      } else {
        const writtenCount = await processor.writeAiFiles(toolFiles);
        totalSubagentOutputs += writtenCount;
        logger.success(`Generated ${writtenCount} ${toolTarget} subagent(s) in ${baseDir}`);
      }
    }
  }

  return { count: totalSubagentOutputs, comparisonResults };
}

async function generateSkills(
  config: Config,
): Promise<GenerateResult & { skills: RulesyncSkill[] }> {
  if (!config.getFeatures().includes("skills")) {
    logger.debug("Skipping skill generation (not in --features)");
    return { count: 0, comparisonResults: [], skills: [] };
  }

  let totalSkillOutputs = 0;
  const comparisonResults: FileComparisonResult[] = [];
  const allSkills: RulesyncSkill[] = [];
  const isCheckMode = config.getCheck();

  if (isCheckMode) {
    logger.info("Checking skill files...");
  } else {
    logger.info("Generating skill files...");
  }

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

      // Handle deletion (or report what would be deleted in check mode)
      if (config.getDelete()) {
        const oldToolDirs = await processor.loadToolDirsToDelete();
        if (isCheckMode) {
          for (const dir of oldToolDirs) {
            comparisonResults.push({ filePath: dir.getDirPath(), status: "delete" });
          }
        } else {
          await processor.removeAiDirs(oldToolDirs);
        }
      }

      const rulesyncDirs = await processor.loadRulesyncDirs();

      // Collect RulesyncSkill instances
      for (const rulesyncDir of rulesyncDirs) {
        if (rulesyncDir instanceof RulesyncSkill) {
          allSkills.push(rulesyncDir);
        }
      }

      const toolDirs = await processor.convertRulesyncDirsToToolDirs(rulesyncDirs);

      if (isCheckMode) {
        const compareResult = await processor.compareAiDirs(toolDirs);
        comparisonResults.push(...compareResult.results);
        totalSkillOutputs += toolDirs.length;
      } else {
        const writtenCount = await processor.writeAiDirs(toolDirs);
        totalSkillOutputs += writtenCount;
        logger.success(`Generated ${writtenCount} ${toolTarget} skill(s) in ${baseDir}`);
      }
    }
  }

  return { count: totalSkillOutputs, comparisonResults, skills: allSkills };
}

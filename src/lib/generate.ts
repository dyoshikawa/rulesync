import { intersection } from "es-toolkit";
import { join } from "node:path";

import { ConfigResolver, type ConfigResolverResolveParams } from "../config/config-resolver.js";
import { Config } from "../config/config.js";
import { RULESYNC_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { CommandsProcessor } from "../features/commands/commands-processor.js";
import { IgnoreProcessor } from "../features/ignore/ignore-processor.js";
import { McpProcessor } from "../features/mcp/mcp-processor.js";
import { RulesProcessor } from "../features/rules/rules-processor.js";
import { RulesyncSkill } from "../features/skills/rulesync-skill.js";
import { SkillsProcessor } from "../features/skills/skills-processor.js";
import { SubagentsProcessor } from "../features/subagents/subagents-processor.js";
import { fileExists } from "../utils/file.js";

export type GenerateParams = ConfigResolverResolveParams;

/**
 * Result of the generate function with detailed counts.
 */
export type GenerateResult = {
  /** Total number of files generated */
  total: number;
  /** Number of rule files generated */
  rules: number;
  /** Number of ignore files generated */
  ignore: number;
  /** Number of MCP files generated */
  mcp: number;
  /** Number of command files generated */
  commands: number;
  /** Number of subagent files generated */
  subagents: number;
  /** Number of skill files generated */
  skills: number;
};

/**
 * Generate configuration files for AI tools.
 *
 * @param params - Configuration parameters
 * @returns The result object with total and per-feature counts
 * @throws Error if .rulesync directory is not found
 *
 * @example
 * ```typescript
 * import { generate } from "rulesync";
 *
 * const result = await generate({
 *   targets: ["claudecode", "cursor"],
 *   features: ["rules", "mcp"],
 * });
 * console.log(`Generated ${result.total} files (${result.rules} rules, ${result.mcp} MCP)`);
 * ```
 */
export async function generate(params: GenerateParams = {}): Promise<GenerateResult> {
  const config = await ConfigResolver.resolve(params);

  // Check if .rulesync directory exists in the first baseDir
  const baseDirs = config.getBaseDirs();
  const firstBaseDir = baseDirs[0];
  if (firstBaseDir === undefined) {
    throw new Error("No base directories configured.");
  }
  const rulesyncPath = join(firstBaseDir, RULESYNC_RELATIVE_DIR_PATH);
  if (!(await fileExists(rulesyncPath))) {
    throw new Error(".rulesync directory not found. Run 'rulesync init' first.");
  }

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

  const totalGenerated =
    totalRulesOutputs +
    totalMcpOutputs +
    totalCommandOutputs +
    totalIgnoreOutputs +
    totalSubagentOutputs +
    skillsResult.totalOutputs;

  return {
    total: totalGenerated,
    rules: totalRulesOutputs,
    ignore: totalIgnoreOutputs,
    mcp: totalMcpOutputs,
    commands: totalCommandOutputs,
    subagents: totalSubagentOutputs,
    skills: skillsResult.totalOutputs,
  };
}

async function generateRules(
  config: Config,
  options?: { skills?: RulesyncSkill[] },
): Promise<number> {
  if (!config.getFeatures().includes("rules")) {
    return 0;
  }

  let totalRulesOutputs = 0;

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
    }
  }
  return totalRulesOutputs;
}

async function generateIgnore(config: Config): Promise<number> {
  if (!config.getFeatures().includes("ignore")) {
    return 0;
  }

  if (config.getGlobal()) {
    return 0;
  }

  let totalIgnoreOutputs = 0;

  for (const toolTarget of intersection(config.getTargets(), IgnoreProcessor.getToolTargets())) {
    for (const baseDir of config.getBaseDirs()) {
      const processor = new IgnoreProcessor({
        baseDir,
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
      }
    }
  }

  return totalIgnoreOutputs;
}

async function generateMcp(config: Config): Promise<number> {
  if (!config.getFeatures().includes("mcp")) {
    return 0;
  }

  let totalMcpOutputs = 0;

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
    }
  }

  return totalMcpOutputs;
}

async function generateCommands(config: Config): Promise<number> {
  if (!config.getFeatures().includes("commands")) {
    return 0;
  }

  let totalCommandOutputs = 0;

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
    }
  }

  return totalCommandOutputs;
}

async function generateSubagents(config: Config): Promise<number> {
  if (!config.getFeatures().includes("subagents")) {
    return 0;
  }

  let totalSubagentOutputs = 0;

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
    }
  }

  return totalSubagentOutputs;
}

async function generateSkills(
  config: Config,
): Promise<{ totalOutputs: number; skills: RulesyncSkill[] }> {
  if (!config.getFeatures().includes("skills")) {
    return { totalOutputs: 0, skills: [] };
  }

  let totalSkillOutputs = 0;
  const allSkills: RulesyncSkill[] = [];

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
    }
  }

  return { totalOutputs: totalSkillOutputs, skills: allSkills };
}

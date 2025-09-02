import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod/mini";
import { FeatureProcessor } from "../types/feature-processor.js";
import { RulesyncFile } from "../types/rulesync-file.js";
import { ToolFile } from "../types/tool-file.js";
import { ToolTarget } from "../types/tool-targets.js";
import { directoryExists } from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { ClaudecodeSubagent } from "./claudecode-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { ToolSubagent } from "./tool-subagent.js";

const subagentsProcessorToolTargets: ToolTarget[] = ["claudecode"];
export const SubagentsProcessorToolTargetSchema = z.enum(subagentsProcessorToolTargets);

export type SubagentsProcessorToolTarget = z.infer<typeof SubagentsProcessorToolTargetSchema>;

export class SubagentsProcessor extends FeatureProcessor {
  private readonly toolTarget: SubagentsProcessorToolTarget;

  constructor({
    baseDir = ".",
    toolTarget,
  }: { baseDir?: string; toolTarget: SubagentsProcessorToolTarget }) {
    super({ baseDir });
    this.toolTarget = SubagentsProcessorToolTargetSchema.parse(toolTarget);
  }

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncSubagents = rulesyncFiles.filter(
      (file): file is RulesyncSubagent => file instanceof RulesyncSubagent,
    );

    const toolSubagents = rulesyncSubagents.map((rulesyncSubagent) => {
      switch (this.toolTarget) {
        case "claudecode":
          return ClaudecodeSubagent.fromRulesyncSubagent({
            baseDir: this.baseDir,
            relativeDirPath: ".claude/agents",
            rulesyncSubagent: rulesyncSubagent,
          });
        default:
          throw new Error(`Unsupported tool target: ${this.toolTarget}`);
      }
    });

    return toolSubagents;
  }

  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const toolSubagents = toolFiles.filter(
      (file): file is ToolSubagent => file instanceof ToolSubagent,
    );

    const rulesyncSubagents = toolSubagents.map((toolSubagent) => {
      return toolSubagent.toRulesyncSubagent();
    });

    return rulesyncSubagents;
  }

  /**
   * Implementation of abstract method from Processor
   * Load and parse rulesync subagent files from .rulesync/subagents/ directory
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    const subagentsDir = join(this.baseDir, ".rulesync", "subagents");

    // Check if directory exists
    const dirExists = await directoryExists(subagentsDir);
    if (!dirExists) {
      logger.debug(`Rulesync subagents directory not found: ${subagentsDir}`);
      return [];
    }

    // Read all markdown files from the directory
    const entries = await readdir(subagentsDir);
    const mdFiles = entries.filter((file) => file.endsWith(".md"));

    if (mdFiles.length === 0) {
      logger.debug(`No markdown files found in rulesync subagents directory: ${subagentsDir}`);
      return [];
    }

    logger.info(`Found ${mdFiles.length} subagent files in ${subagentsDir}`);

    // Parse all files and create RulesyncSubagent instances using fromFilePath
    const rulesyncSubagents: RulesyncSubagent[] = [];

    for (const mdFile of mdFiles) {
      const filepath = join(subagentsDir, mdFile);

      try {
        const rulesyncSubagent = await RulesyncSubagent.fromFilePath({
          filePath: filepath,
        });

        rulesyncSubagents.push(rulesyncSubagent);
        logger.debug(`Successfully loaded subagent: ${mdFile}`);
      } catch (error) {
        logger.warn(`Failed to load subagent file ${filepath}:`, error);
        continue;
      }
    }

    if (rulesyncSubagents.length === 0) {
      logger.debug(`No valid subagents found in ${subagentsDir}`);
      return [];
    }

    logger.info(`Successfully loaded ${rulesyncSubagents.length} rulesync subagents`);
    return rulesyncSubagents;
  }

  /**
   * Implementation of abstract method from Processor
   * Load tool-specific subagent configurations and parse them into ToolSubagent instances
   */
  async loadToolFiles(): Promise<ToolFile[]> {
    switch (this.toolTarget) {
      case "claudecode":
        return await this.loadClaudecodeSubagents();
      default:
        throw new Error(`Unsupported tool target: ${this.toolTarget}`);
    }
  }

  /**
   * Load Claude Code subagent configurations from .claude/agents/ directory
   */
  private async loadClaudecodeSubagents(): Promise<ToolSubagent[]> {
    const agentsDir = join(this.baseDir, ".claude", "agents");

    // Check if directory exists
    if (!(await directoryExists(agentsDir))) {
      logger.warn(`Claude Code agents directory not found: ${agentsDir}`);
      return [];
    }

    // Read all markdown files from the directory
    let entries: string[];
    try {
      entries = await readdir(agentsDir);
    } catch (error) {
      logger.warn(`Failed to read Claude Code agents directory ${agentsDir}:`, error);
      return [];
    }
    const mdFiles = entries.filter((file) => file.endsWith(".md"));

    if (mdFiles.length === 0) {
      logger.info(`No JSON agent files found in ${agentsDir}`);
      return [];
    }

    logger.info(`Found ${mdFiles.length} Claude Code agent files in ${agentsDir}`);

    // Parse all files and create ToolSubagent instances
    const toolSubagents: ToolSubagent[] = [];

    for (const mdFile of mdFiles) {
      const filepath = join(agentsDir, mdFile);

      try {
        const claudecodeSubagent = await ClaudecodeSubagent.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".claude/agents",
          relativeFilePath: mdFile,
          filePath: filepath,
        });

        toolSubagents.push(claudecodeSubagent);
        logger.debug(`Successfully loaded Claude Code agent: ${mdFile}`);
      } catch (error) {
        logger.warn(`Failed to load Claude Code agent file ${filepath}:`, error);
        continue;
      }
    }

    logger.info(`Successfully loaded ${toolSubagents.length} Claude Code subagents`);
    return toolSubagents;
  }
  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets(): ToolTarget[] {
    return subagentsProcessorToolTargets;
  }
}

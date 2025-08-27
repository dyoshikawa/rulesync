import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod/mini";
import { Processor } from "../types/processor.js";
import { directoryExists } from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { ClaudecodeSubagent } from "./claudecode-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { ToolSubagent } from "./tool-subagent.js";

export const SubagentsProcessorToolTargetSchema = z.enum(["claudecode"]);

export type SubagentsProcessorToolTarget = z.infer<typeof SubagentsProcessorToolTargetSchema>;

export class SubagentsProcessor extends Processor {
  private readonly toolTarget: SubagentsProcessorToolTarget;

  constructor({
    baseDir,
    toolTarget,
  }: { baseDir: string; toolTarget: SubagentsProcessorToolTarget }) {
    super({ baseDir });
    this.toolTarget = SubagentsProcessorToolTargetSchema.parse(toolTarget);
  }

  async writeToolSubagentsFromRulesyncSubagents(
    rulesyncSubagents: RulesyncSubagent[],
  ): Promise<void> {
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

    await this.writeAiFiles(toolSubagents);
  }

  /**
   * Load and parse rulesync subagent files from .rulesync/subagents/ directory
   */
  async loadRulesyncSubagents(): Promise<RulesyncSubagent[]> {
    const subagentsDir = join(this.baseDir, ".rulesync", "subagents");

    // Check if directory exists
    if (!(await directoryExists(subagentsDir))) {
      throw new Error(`Rulesync subagents directory not found: ${subagentsDir}`);
    }

    // Read all markdown files from the directory
    const entries = await readdir(subagentsDir);
    const mdFiles = entries.filter((file) => file.endsWith(".md"));

    if (mdFiles.length === 0) {
      throw new Error(`No markdown files found in rulesync subagents directory: ${subagentsDir}`);
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
      throw new Error(`No valid subagents found in ${subagentsDir}`);
    }

    logger.info(`Successfully loaded ${rulesyncSubagents.length} rulesync subagents`);
    return rulesyncSubagents;
  }

  /**
   * Load tool-specific subagent configurations and parse them into ToolSubagent instances
   */
  async loadToolSubagents(): Promise<ToolSubagent[]> {
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

    // Read all JSON files from the directory
    const entries = await readdir(agentsDir);
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

  async writeRulesyncSubagentsFromToolSubagents(toolSubagents: ToolSubagent[]): Promise<void> {
    const rulesyncSubagents = toolSubagents.map((toolSubagent) => {
      return toolSubagent.toRulesyncSubagent();
    });

    await this.writeAiFiles(rulesyncSubagents);
  }
}

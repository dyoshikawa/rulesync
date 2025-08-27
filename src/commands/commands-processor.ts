import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod/mini";
import { Processor } from "../types/processor.js";
import { directoryExists } from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { ClaudecodeCommand } from "./claudecode-command.js";
import { GeminiCliCommand } from "./geminicli-command.js";
import { RooCommand } from "./roo-command.js";
import { RulesyncCommand } from "./rulesync-command.js";
import { ToolCommand } from "./tool-command.js";

export const CommandsProcessorToolTargetSchema = z.enum(["claudecode", "geminicli", "roo"]);

export type CommandsProcessorToolTarget = z.infer<typeof CommandsProcessorToolTargetSchema>;

export class CommandsProcessor extends Processor {
  private readonly toolTarget: CommandsProcessorToolTarget;

  constructor({
    baseDir,
    toolTarget,
  }: { baseDir: string; toolTarget: CommandsProcessorToolTarget }) {
    super({ baseDir });
    this.toolTarget = CommandsProcessorToolTargetSchema.parse(toolTarget);
  }

  /**
   * Convert rulesync commands to tool-specific command formats and write them to the appropriate directories
   */
  async writeToolCommandsFromRulesyncCommands(rulesyncCommands: RulesyncCommand[]): Promise<void> {
    const toolCommands = rulesyncCommands.map((rulesyncCommand) => {
      switch (this.toolTarget) {
        case "claudecode":
          return ClaudecodeCommand.fromRulesyncCommand({
            baseDir: this.baseDir,
            relativeDirPath: ".claude/commands",
            rulesyncCommand: rulesyncCommand,
          });
        case "geminicli":
          return GeminiCliCommand.fromRulesyncCommand({
            baseDir: this.baseDir,
            relativeDirPath: ".gemini/commands",
            rulesyncCommand: rulesyncCommand,
          });
        case "roo":
          return RooCommand.fromRulesyncCommand({
            baseDir: this.baseDir,
            relativeDirPath: ".roo/commands",
            rulesyncCommand: rulesyncCommand,
          });
        default:
          throw new Error(`Unsupported tool target: ${this.toolTarget}`);
      }
    });

    await this.writeAiFiles(toolCommands);
  }

  /**
   * Load and parse rulesync command files from .rulesync/commands/ directory
   */
  async loadRulesyncCommands(): Promise<RulesyncCommand[]> {
    const commandsDir = join(this.baseDir, ".rulesync", "commands");

    // Check if directory exists
    if (!(await directoryExists(commandsDir))) {
      throw new Error(`Rulesync commands directory not found: ${commandsDir}`);
    }

    // Read all markdown files from the directory
    const entries = await readdir(commandsDir);
    const mdFiles = entries.filter((file) => file.endsWith(".md"));

    if (mdFiles.length === 0) {
      throw new Error(`No markdown files found in rulesync commands directory: ${commandsDir}`);
    }

    logger.info(`Found ${mdFiles.length} command files in ${commandsDir}`);

    // Parse all files and create RulesyncCommand instances using fromFilePath
    const rulesyncCommands: RulesyncCommand[] = [];

    for (const mdFile of mdFiles) {
      const filepath = join(commandsDir, mdFile);

      try {
        const rulesyncCommand = await RulesyncCommand.fromFilePath({
          filePath: filepath,
        });

        rulesyncCommands.push(rulesyncCommand);
        logger.debug(`Successfully loaded command: ${mdFile}`);
      } catch (error) {
        logger.warn(`Failed to load command file ${filepath}:`, error);
        continue;
      }
    }

    if (rulesyncCommands.length === 0) {
      throw new Error(`No valid commands found in ${commandsDir}`);
    }

    logger.info(`Successfully loaded ${rulesyncCommands.length} rulesync commands`);
    return rulesyncCommands;
  }

  /**
   * Load tool-specific command configurations and parse them into ToolCommand instances
   */
  async loadToolCommands(): Promise<ToolCommand[]> {
    switch (this.toolTarget) {
      case "claudecode":
        return await this.loadClaudecodeCommands();
      case "geminicli":
        return await this.loadGeminiCliCommands();
      case "roo":
        return await this.loadRooCommands();
      default:
        throw new Error(`Unsupported tool target: ${this.toolTarget}`);
    }
  }

  /**
   * Load Claude Code command configurations from .claude/commands/ directory
   */
  private async loadClaudecodeCommands(): Promise<ToolCommand[]> {
    const commandsDir = join(this.baseDir, ".claude", "commands");

    // Check if directory exists
    if (!(await directoryExists(commandsDir))) {
      logger.warn(`Claude Code commands directory not found: ${commandsDir}`);
      return [];
    }

    // Read all markdown files from the directory
    const entries = await readdir(commandsDir);
    const mdFiles = entries.filter((file) => file.endsWith(".md"));

    if (mdFiles.length === 0) {
      logger.info(`No markdown command files found in ${commandsDir}`);
      return [];
    }

    logger.info(`Found ${mdFiles.length} Claude Code command files in ${commandsDir}`);

    // Parse all files and create ToolCommand instances
    const toolCommands: ToolCommand[] = [];

    for (const mdFile of mdFiles) {
      const filepath = join(commandsDir, mdFile);

      try {
        const claudecodeCommand = await ClaudecodeCommand.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".claude/commands",
          relativeFilePath: mdFile,
          filePath: filepath,
        });

        toolCommands.push(claudecodeCommand);
        logger.debug(`Successfully loaded Claude Code command: ${mdFile}`);
      } catch (error) {
        logger.warn(`Failed to load Claude Code command file ${filepath}:`, error);
        continue;
      }
    }

    logger.info(`Successfully loaded ${toolCommands.length} Claude Code commands`);
    return toolCommands;
  }

  /**
   * Load Gemini CLI command configurations from .gemini/commands/ directory
   */
  private async loadGeminiCliCommands(): Promise<ToolCommand[]> {
    const commandsDir = join(this.baseDir, ".gemini", "commands");

    // Check if directory exists
    if (!(await directoryExists(commandsDir))) {
      logger.warn(`Gemini CLI commands directory not found: ${commandsDir}`);
      return [];
    }

    // Read all TOML files from the directory
    const entries = await readdir(commandsDir);
    const tomlFiles = entries.filter((file) => file.endsWith(".toml"));

    if (tomlFiles.length === 0) {
      logger.info(`No TOML command files found in ${commandsDir}`);
      return [];
    }

    logger.info(`Found ${tomlFiles.length} Gemini CLI command files in ${commandsDir}`);

    // Parse all files and create ToolCommand instances
    const toolCommands: ToolCommand[] = [];

    for (const tomlFile of tomlFiles) {
      const filepath = join(commandsDir, tomlFile);

      try {
        const geminiCliCommand = await GeminiCliCommand.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".gemini/commands",
          relativeFilePath: tomlFile,
          filePath: filepath,
        });

        toolCommands.push(geminiCliCommand);
        logger.debug(`Successfully loaded Gemini CLI command: ${tomlFile}`);
      } catch (error) {
        logger.warn(`Failed to load Gemini CLI command file ${filepath}:`, error);
        continue;
      }
    }

    logger.info(`Successfully loaded ${toolCommands.length} Gemini CLI commands`);
    return toolCommands;
  }

  /**
   * Load Roo Code command configurations from .roo/commands/ directory
   */
  private async loadRooCommands(): Promise<ToolCommand[]> {
    const commandsDir = join(this.baseDir, ".roo", "commands");

    // Check if directory exists
    if (!(await directoryExists(commandsDir))) {
      logger.warn(`Roo Code commands directory not found: ${commandsDir}`);
      return [];
    }

    // Read all markdown files from the directory
    const entries = await readdir(commandsDir);
    const mdFiles = entries.filter((file) => file.endsWith(".md"));

    if (mdFiles.length === 0) {
      logger.info(`No markdown command files found in ${commandsDir}`);
      return [];
    }

    logger.info(`Found ${mdFiles.length} Roo Code command files in ${commandsDir}`);

    // Parse all files and create ToolCommand instances
    const toolCommands: ToolCommand[] = [];

    for (const mdFile of mdFiles) {
      const filepath = join(commandsDir, mdFile);

      try {
        const rooCommand = await RooCommand.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".roo/commands",
          relativeFilePath: mdFile,
          filePath: filepath,
        });

        toolCommands.push(rooCommand);
        logger.debug(`Successfully loaded Roo Code command: ${mdFile}`);
      } catch (error) {
        logger.warn(`Failed to load Roo Code command file ${filepath}:`, error);
        continue;
      }
    }

    logger.info(`Successfully loaded ${toolCommands.length} Roo Code commands`);
    return toolCommands;
  }

  /**
   * Convert tool-specific commands back to rulesync commands and write them to .rulesync/commands/
   */
  async writeRulesyncCommandsFromToolCommands(toolCommands: ToolCommand[]): Promise<void> {
    const rulesyncCommands = toolCommands.map((toolCommand) => {
      return toolCommand.toRulesyncCommand();
    });

    await this.writeAiFiles(rulesyncCommands);
  }
}

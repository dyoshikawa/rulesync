import { join } from "node:path";
import { z } from "zod/mini";
import { FeatureProcessor } from "../types/feature-processor.js";
import { RulesyncFile } from "../types/rulesync-file.js";
import { ToolFile } from "../types/tool-file.js";
import { ToolTarget } from "../types/tool-targets.js";
import { logger } from "../utils/logger.js";
import { AmazonqcliMcp } from "./amazonqcli-mcp.js";
import { ClaudecodeMcp } from "./claudecode-mcp.js";
import { ClineMcp } from "./cline-mcp.js";
import { CopilotMcp } from "./copilot-mcp.js";
import { CursorMcp } from "./cursor-mcp.js";
import { RooMcp } from "./roo-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp } from "./tool-mcp.js";

const mcpProcessorToolTargets: ToolTarget[] = [
  "amazonqcli",
  "claudecode",
  "cline",
  "copilot",
  "cursor",
  "roo",
];

export const McpProcessorToolTargetSchema = z.enum(mcpProcessorToolTargets);

export type McpProcessorToolTarget = z.infer<typeof McpProcessorToolTargetSchema>;

export class McpProcessor extends FeatureProcessor {
  private readonly toolTarget: McpProcessorToolTarget;

  constructor({
    baseDir = process.cwd(),
    toolTarget,
  }: { baseDir?: string; toolTarget: McpProcessorToolTarget }) {
    super({ baseDir });
    this.toolTarget = McpProcessorToolTargetSchema.parse(toolTarget);
  }

  async writeToolMcpsFromRulesyncMcps(rulesyncMcps: RulesyncMcp[]): Promise<void> {
    const toolMcps = await this.convertRulesyncFilesToToolFiles(rulesyncMcps);
    await this.writeAiFiles(toolMcps);
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load and parse rulesync MCP files from .rulesync/ directory
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    const rulesyncMcps = await this.loadRulesyncMcps();
    return rulesyncMcps;
  }

  async loadRulesyncMcps(): Promise<RulesyncMcp[]> {
    return [await RulesyncMcp.fromFilePath({ filePath: ".rulesync/.mcp.json" })];
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific MCP configurations and parse them into ToolMcp instances
   */
  async loadToolFiles(): Promise<ToolFile[]> {
    const toolMcps = await this.loadToolMcps();
    return toolMcps;
  }

  async loadToolMcps(): Promise<ToolMcp[]> {
    switch (this.toolTarget) {
      case "amazonqcli":
        return await this.loadAmazonqcliMcps();
      case "claudecode":
        return await this.loadClaudecodeMcps();
      case "cline":
        return await this.loadClineMcps();
      case "copilot":
        return await this.loadCopilotMcps();
      case "cursor":
        return await this.loadCursorMcps();
      case "roo":
        return await this.loadRooMcps();
      default:
        throw new Error(`Unsupported tool target: ${this.toolTarget}`);
    }
  }

  private async loadAmazonqcliMcps(): Promise<ToolMcp[]> {
    const supportedFiles = AmazonqcliMcp.getSupportedMcpFileNames();

    for (const filename of supportedFiles) {
      const mcpFilePath = join(this.baseDir, filename);

      try {
        const amazonqcliMcp = await AmazonqcliMcp.fromFilePath({
          filePath: mcpFilePath,
        });

        logger.info(`Successfully loaded Amazon Q Developer CLI MCP file: ${mcpFilePath}`);
        return [amazonqcliMcp];
      } catch (error) {
        logger.debug(`Failed to load ${mcpFilePath}:`, error);
      }
    }

    logger.debug("No Amazon Q Developer CLI MCP files found");
    return [];
  }

  private async loadClaudecodeMcps(): Promise<ToolMcp[]> {
    const supportedFiles = ClaudecodeMcp.getSupportedMcpFileNames();

    for (const filename of supportedFiles) {
      const mcpFilePath = join(this.baseDir, filename);

      try {
        const claudecodeMcp = await ClaudecodeMcp.fromFilePath({
          filePath: mcpFilePath,
        });

        logger.info(`Successfully loaded Claude Code MCP file: ${mcpFilePath}`);
        return [claudecodeMcp];
      } catch (error) {
        logger.debug(`Failed to load ${mcpFilePath}:`, error);
      }
    }

    logger.debug("No Claude Code MCP files found");
    return [];
  }

  private async loadClineMcps(): Promise<ToolMcp[]> {
    const supportedFiles = ClineMcp.getSupportedMcpFileNames();

    for (const filename of supportedFiles) {
      const mcpFilePath = join(this.baseDir, filename);

      try {
        const clineMcp = await ClineMcp.fromFilePath({
          filePath: mcpFilePath,
        });

        logger.info(`Successfully loaded Cline MCP file: ${mcpFilePath}`);
        return [clineMcp];
      } catch (error) {
        logger.debug(`Failed to load ${mcpFilePath}:`, error);
      }
    }

    logger.debug("No Cline MCP files found");
    return [];
  }

  private async loadCopilotMcps(): Promise<ToolMcp[]> {
    const supportedFiles = CopilotMcp.getSupportedMcpFileNames();

    for (const filename of supportedFiles) {
      const mcpFilePath = join(this.baseDir, filename);

      try {
        const copilotMcp = await CopilotMcp.fromFilePath({
          filePath: mcpFilePath,
        });

        logger.info(`Successfully loaded GitHub Copilot MCP file: ${mcpFilePath}`);
        return [copilotMcp];
      } catch (error) {
        logger.debug(`Failed to load ${mcpFilePath}:`, error);
      }
    }

    logger.debug("No GitHub Copilot MCP files found");
    return [];
  }

  private async loadCursorMcps(): Promise<ToolMcp[]> {
    const supportedFiles = CursorMcp.getSupportedMcpFileNames();

    for (const filename of supportedFiles) {
      const mcpFilePath = join(this.baseDir, filename);

      try {
        const cursorMcp = await CursorMcp.fromFilePath({
          filePath: mcpFilePath,
        });

        logger.info(`Successfully loaded Cursor MCP file: ${mcpFilePath}`);
        return [cursorMcp];
      } catch (error) {
        logger.debug(`Failed to load ${mcpFilePath}:`, error);
      }
    }

    logger.debug("No Cursor MCP files found");
    return [];
  }

  private async loadRooMcps(): Promise<ToolMcp[]> {
    const supportedFiles = RooMcp.getSupportedMcpFileNames();

    for (const filename of supportedFiles) {
      const mcpFilePath = join(this.baseDir, filename);

      try {
        const rooMcp = await RooMcp.fromFilePath({
          filePath: mcpFilePath,
        });

        logger.info(`Successfully loaded Roo Code MCP file: ${mcpFilePath}`);
        return [rooMcp];
      } catch (error) {
        logger.debug(`Failed to load ${mcpFilePath}:`, error);
      }
    }

    logger.debug("No Roo Code MCP files found");
    return [];
  }

  async writeRulesyncMcpsFromToolMcps(toolMcps: ToolMcp[]): Promise<void> {
    const rulesyncMcps = toolMcps.map((toolMcp) => {
      return toolMcp.toRulesyncMcp();
    });

    await this.writeAiFiles(rulesyncMcps);
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Convert RulesyncFile[] to ToolFile[]
   */
  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncMcp = rulesyncFiles.find(
      (file): file is RulesyncMcp => file instanceof RulesyncMcp,
    );

    if (!rulesyncMcp) {
      throw new Error(`No .rulesync/.mcp.json found.`);
    }

    const toolMcps = [rulesyncMcp].map((rulesyncMcp) => {
      switch (this.toolTarget) {
        case "amazonqcli":
          return AmazonqcliMcp.fromRulesyncMcp({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncMcp,
          });
        case "claudecode":
          return ClaudecodeMcp.fromRulesyncMcp({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncMcp,
          });
        case "cline":
          return ClineMcp.fromRulesyncMcp({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncMcp,
          });
        case "copilot":
          return CopilotMcp.fromRulesyncMcp({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncMcp,
          });
        case "cursor":
          return CursorMcp.fromRulesyncMcp({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncMcp,
          });
        case "roo":
          return RooMcp.fromRulesyncMcp({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncMcp,
          });
        default:
          throw new Error(`Unsupported tool target: ${this.toolTarget}`);
      }
    });

    return toolMcps;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Convert ToolFile[] to RulesyncFile[]
   */
  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const toolMcps = toolFiles.filter((file): file is ToolMcp => file instanceof ToolMcp);

    const rulesyncMcps = toolMcps.map((toolMcp) => {
      return toolMcp.toRulesyncMcp();
    });

    return rulesyncMcps;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets(): ToolTarget[] {
    return mcpProcessorToolTargets;
  }
}

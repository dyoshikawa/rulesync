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

export const mcpProcessorToolTargets: ToolTarget[] = [
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
    baseDir = ".",
    toolTarget,
  }: { baseDir?: string; toolTarget: McpProcessorToolTarget }) {
    super({ baseDir });
    this.toolTarget = McpProcessorToolTargetSchema.parse(toolTarget);
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load and parse rulesync MCP files from .rulesync/ directory
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    try {
      return [await RulesyncMcp.fromFile({})];
    } catch (error) {
      logger.debug(`No MCP files found for tool target: ${this.toolTarget}`, error);
      return [];
    }
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific MCP configurations and parse them into ToolMcp instances
   */
  async loadToolFiles(): Promise<ToolFile[]> {
    try {
      const toolMcps = await (async () => {
        switch (this.toolTarget) {
          case "amazonqcli": {
            return [
              await AmazonqcliMcp.fromFile({
                baseDir: this.baseDir,
                validate: true,
              }),
            ];
          }
          case "claudecode": {
            return [
              await ClaudecodeMcp.fromFile({
                baseDir: this.baseDir,
                validate: true,
              }),
            ];
          }
          case "cline": {
            return [
              await ClineMcp.fromFile({
                baseDir: this.baseDir,
                validate: true,
              }),
            ];
          }
          case "copilot": {
            return [
              await CopilotMcp.fromFile({
                baseDir: this.baseDir,
                validate: true,
              }),
            ];
          }
          case "cursor": {
            return [
              await CursorMcp.fromFile({
                baseDir: this.baseDir,
                validate: true,
              }),
            ];
          }
          case "roo": {
            return [
              await RooMcp.fromFile({
                baseDir: this.baseDir,
                validate: true,
              }),
            ];
          }
          default:
            throw new Error(`Unsupported tool target: ${this.toolTarget}`);
        }
      })();
      logger.info(`Successfully loaded ${toolMcps.length} ${this.toolTarget} MCP files`);
      return toolMcps;
    } catch (error) {
      logger.debug(`No MCP files found for tool target: ${this.toolTarget}`, error);
      return [];
    }
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
            rulesyncMcp,
          });
        case "claudecode":
          return ClaudecodeMcp.fromRulesyncMcp({
            baseDir: this.baseDir,
            rulesyncMcp,
          });
        case "cline":
          return ClineMcp.fromRulesyncMcp({
            baseDir: this.baseDir,
            rulesyncMcp,
          });
        case "copilot":
          return CopilotMcp.fromRulesyncMcp({
            baseDir: this.baseDir,
            rulesyncMcp,
          });
        case "cursor":
          return CursorMcp.fromRulesyncMcp({
            baseDir: this.baseDir,
            rulesyncMcp,
          });
        case "roo":
          return RooMcp.fromRulesyncMcp({
            baseDir: this.baseDir,
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

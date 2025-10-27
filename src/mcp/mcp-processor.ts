import { z } from "zod/mini";
import { FeatureProcessor } from "../types/feature-processor.js";
import { RulesyncFile } from "../types/rulesync-file.js";
import { ToolFile } from "../types/tool-file.js";
import { ToolTarget } from "../types/tool-targets.js";
import { logger } from "../utils/logger.js";
import { AmazonqcliMcp } from "./amazonqcli-mcp.js";
import { ClaudecodeMcp } from "./claudecode-mcp.js";
import { ClineMcp } from "./cline-mcp.js";
import { CodexcliMcp } from "./codexcli-mcp.js";
import { CopilotMcp } from "./copilot-mcp.js";
import { CursorMcp } from "./cursor-mcp.js";
import { GeminiCliMcp } from "./geminicli-mcp.js";
import { ModularMcp } from "./modular-mcp.js";
import { RooMcp } from "./roo-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp } from "./tool-mcp.js";

export const mcpProcessorToolTargets: ToolTarget[] = [
  "amazonqcli",
  "claudecode",
  "cline",
  "copilot",
  "cursor",
  "geminicli",
  "roo",
];

export const McpProcessorToolTargetSchema = z.enum(
  // codexcli is not in the list of tool targets but we add it here because it is a valid tool target for global mode generation
  mcpProcessorToolTargets.concat("codexcli"),
);
export type McpProcessorToolTarget = z.infer<typeof McpProcessorToolTargetSchema>;

export const mcpProcessorToolTargetsGlobal: ToolTarget[] = ["claudecode", "codexcli", "geminicli"];

export const mcpProcessorToolTargetsModular: ToolTarget[] = ["claudecode"];

export class McpProcessor extends FeatureProcessor {
  private readonly toolTarget: McpProcessorToolTarget;
  private readonly global: boolean;
  private readonly modularMcp: boolean;

  constructor({
    baseDir = ".",
    toolTarget,
    global = false,
    modularMcp = false,
  }: {
    baseDir?: string;
    toolTarget: McpProcessorToolTarget;
    global?: boolean;
    modularMcp?: boolean;
  }) {
    super({ baseDir });
    const result = McpProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for McpProcessor: ${toolTarget}. ${result.error.message}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
    this.modularMcp = modularMcp;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load and parse rulesync MCP files from .rulesync/ directory
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    try {
      return [await RulesyncMcp.fromFile({ modularMcp: this.modularMcp })];
    } catch (error) {
      logger.debug(`Failed to load MCP files for tool target: ${this.toolTarget}`, error);
      return [];
    }
  }

  async loadToolFilesToDelete(): Promise<ToolFile[]> {
    // When global mode, "~/.claude/.claude.json" should not be deleted.
    if (this.global) {
      return (await this.loadToolFiles()).filter(
        (toolFile) => !(toolFile instanceof ClaudecodeMcp),
      );
    }

    return this.loadToolFiles();
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
                global: this.global,
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
          case "codexcli": {
            return [
              await CodexcliMcp.fromFile({
                baseDir: this.baseDir,
                validate: true,
                global: this.global,
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
          case "geminicli": {
            return [
              await GeminiCliMcp.fromFile({
                baseDir: this.baseDir,
                validate: true,
                global: this.global,
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
      logger.debug(`Failed to load MCP files for tool target: ${this.toolTarget}`, error);
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
      throw new Error(`No .rulesync/mcp.json found.`);
    }

    const toolMcps = await Promise.all(
      [rulesyncMcp].map(async (rulesyncMcp) => {
        switch (this.toolTarget) {
          case "amazonqcli":
            return AmazonqcliMcp.fromRulesyncMcp({
              baseDir: this.baseDir,
              rulesyncMcp,
            });
          case "claudecode":
            return await ClaudecodeMcp.fromRulesyncMcp({
              baseDir: this.baseDir,
              rulesyncMcp,
              global: this.global,
              modularMcp: this.modularMcp,
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
          case "codexcli":
            return await CodexcliMcp.fromRulesyncMcp({
              baseDir: this.baseDir,
              rulesyncMcp,
              global: this.global,
            });
          case "geminicli":
            return GeminiCliMcp.fromRulesyncMcp({
              baseDir: this.baseDir,
              rulesyncMcp,
              global: this.global,
            });
          case "roo":
            return RooMcp.fromRulesyncMcp({
              baseDir: this.baseDir,
              rulesyncMcp,
            });
          default:
            throw new Error(`Unsupported tool target: ${this.toolTarget}`);
        }
      }),
    );

    const toolFiles: ToolFile[] = toolMcps;

    // Add modular-mcp.json if modularMcp is enabled and target supports modular-mcp
    if (this.modularMcp && mcpProcessorToolTargetsModular.includes(this.toolTarget)) {
      toolFiles.push(
        ModularMcp.fromRulesyncMcp({
          baseDir: this.baseDir,
          rulesyncMcp,
        }),
      );
    }

    return toolFiles;
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

  static getToolTargetsGlobal(): ToolTarget[] {
    return mcpProcessorToolTargetsGlobal;
  }
}

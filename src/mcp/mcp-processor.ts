import { join } from "node:path";
import { z } from "zod/mini";
import { FeatureProcessor } from "../types/feature-processor.js";
import { RulesyncFile } from "../types/rulesync-file.js";
import { ToolFile } from "../types/tool-file.js";
import { ToolTarget } from "../types/tool-targets.js";
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
    return [
      await RulesyncMcp.fromFilePath({ filePath: join(this.baseDir, ".rulesync", ".mcp.json") }),
    ];
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific MCP configurations and parse them into ToolMcp instances
   */
  async loadToolFiles(): Promise<ToolFile[]> {
    switch (this.toolTarget) {
      case "amazonqcli": {
        return [
          await AmazonqcliMcp.fromFilePath({
            filePath: join(this.baseDir, ".amazonq", "mcp.json"),
          }),
        ];
      }
      case "claudecode": {
        return [
          await ClaudecodeMcp.fromFilePath({
            filePath: join(this.baseDir, ".mcp.json"),
          }),
        ];
      }
      case "cline": {
        return [
          await ClineMcp.fromFilePath({ filePath: join(this.baseDir, ".cline", "mcp.json") }),
        ];
      }
      case "copilot": {
        return [
          await CopilotMcp.fromFilePath({ filePath: join(this.baseDir, ".vscode", "mcp.json") }),
        ];
      }
      case "cursor": {
        return [
          await CursorMcp.fromFilePath({ filePath: join(this.baseDir, ".cursor", "mcp.json") }),
        ];
      }
      case "roo": {
        return [await RooMcp.fromFilePath({ filePath: join(this.baseDir, ".roo", "mcp.json") })];
      }
      default:
        throw new Error(`Unsupported tool target: ${this.toolTarget}`);
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

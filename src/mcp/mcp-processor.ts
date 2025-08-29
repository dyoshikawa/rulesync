import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod/mini";
import { FeatureProcessor } from "../types/feature-processor.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { RulesyncFile } from "../types/rulesync-file.js";
import { ToolFile } from "../types/tool-file.js";
import { ToolTarget } from "../types/tool-targets.js";
import { directoryExists, fileExists } from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { AmazonqcliMcp } from "./amazonqcli-mcp.js";
import { AugmentcodeMcp } from "./augmentcode-mcp.js";
import { ClaudecodeMcp } from "./claudecode-mcp.js";
import { ClineMcp } from "./cline-mcp.js";
import { CodexcliMcp } from "./codexcli-mcp.js";
import { CopilotMcp } from "./copilot-mcp.js";
import { CursorMcp } from "./cursor-mcp.js";
import { GeminicliMcp } from "./geminicli-mcp.js";
import { JunieMcp } from "./junie-mcp.js";
import { KiroMcp } from "./kiro-mcp.js";
import { OpencodeMcp } from "./opencode-mcp.js";
import { QwencodeMcp } from "./qwencode-mcp.js";
import { RooMcp } from "./roo-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import type { ToolMcp } from "./tool-mcp.js";
import { WindsurfMcp } from "./windsurf-mcp.js";

const mcpProcessorToolTargets: ToolTarget[] = [
  "amazonqcli",
  "augmentcode",
  "claudecode",
  "cline",
  "codexcli",
  "copilot",
  "cursor",
  "geminicli",
  "junie",
  "kiro",
  "opencode",
  "qwencode",
  "roo",
  "windsurf",
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

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncMcpConfigs = rulesyncFiles.filter(
      (file): file is RulesyncMcp => file instanceof RulesyncMcp,
    );

    const toolMcpFiles = rulesyncMcpConfigs.map((rulesyncMcp) => {
      switch (this.toolTarget) {
        case "amazonqcli":
          return AmazonqcliMcp.fromRulesyncMcp(rulesyncMcp, this.baseDir, ".amazonq");
        case "augmentcode":
          return AugmentcodeMcp.fromRulesyncMcp(rulesyncMcp, this.baseDir, ".");
        case "claudecode":
          return ClaudecodeMcp.fromRulesyncMcp(rulesyncMcp, this.baseDir, ".");
        case "cline":
          return ClineMcp.fromRulesyncMcp(rulesyncMcp, this.baseDir, ".");
        case "codexcli":
          return CodexcliMcp.fromRulesyncMcp(rulesyncMcp, this.baseDir, ".");
        case "copilot":
          throw new Error(
            "Copilot MCP conversion from rulesync format is not supported due to multiple format variants",
          );
        case "cursor":
          return CursorMcp.fromRulesyncMcp(rulesyncMcp, this.baseDir, ".cursor");
        case "geminicli":
          return GeminicliMcp.fromRulesyncMcp(rulesyncMcp, this.baseDir, ".gemini");
        case "junie":
          return JunieMcp.fromRulesyncMcp(rulesyncMcp, this.baseDir, ".");
        case "kiro":
          return KiroMcp.fromRulesyncMcp(rulesyncMcp, this.baseDir, ".kiro");
        case "opencode":
          throw new Error("OpenCode MCP conversion from rulesync format is not supported");
        case "qwencode":
          return QwencodeMcp.fromRulesyncMcp(rulesyncMcp, this.baseDir, ".qwen");
        case "roo":
          return RooMcp.fromRulesyncMcp(rulesyncMcp, this.baseDir, ".roo");
        case "windsurf":
          return WindsurfMcp.fromRulesyncMcp(rulesyncMcp, this.baseDir, ".");
        default: {
          const validTargets = mcpProcessorToolTargets;
          throw new Error(
            `Unsupported tool target: "${this.toolTarget}". ` +
              `Supported targets are: ${validTargets.join(", ")}`,
          );
        }
      }
    });

    return toolMcpFiles;
  }

  async convertToolFilesToRulesyncFiles(_toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    throw new Error(
      "Converting tool-specific MCP configurations to rulesync format is not yet implemented",
    );
  }

  /**
   * Convert rulesync MCP configurations to tool-specific MCP format and write to files
   */
  async writeToolMcpFromRulesyncMcp(rulesyncMcpConfigs: RulesyncMcp[]): Promise<void> {
    const toolMcpFiles = await this.convertRulesyncFilesToToolFiles(rulesyncMcpConfigs);
    await this.writeAiFiles(toolMcpFiles);
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load and parse rulesync MCP files from .rulesync/mcp/ directory
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    const mcpDir = join(this.baseDir, ".rulesync", "mcp");

    // Check if directory exists
    const dirExists = await directoryExists(mcpDir);
    if (!dirExists) {
      logger.debug(`Rulesync MCP directory not found: ${mcpDir}`);
      return [];
    }

    // Read all markdown files from the directory
    const entries = await readdir(mcpDir);
    const mdFiles = entries.filter((file) => file.endsWith(".md"));

    if (mdFiles.length === 0) {
      logger.debug(`No markdown files found in rulesync MCP directory: ${mcpDir}`);
      return [];
    }

    logger.info(`Found ${mdFiles.length} MCP files in ${mcpDir}`);

    // Parse all files and create RulesyncMcp instances using fromFilePath
    const rulesyncMcpConfigs: RulesyncMcp[] = [];

    for (const mdFile of mdFiles) {
      const filepath = join(mcpDir, mdFile);

      try {
        const rulesyncMcp = await RulesyncMcp.fromFilePath({
          filePath: filepath,
        });

        rulesyncMcpConfigs.push(rulesyncMcp);
        logger.debug(`Successfully loaded MCP config: ${mdFile}`);
      } catch (error) {
        logger.warn(`Failed to load MCP file ${filepath}:`, error);
        continue;
      }
    }

    if (rulesyncMcpConfigs.length === 0) {
      logger.debug(`No valid MCP configs found in ${mcpDir}`);
      return [];
    }

    logger.info(`Successfully loaded ${rulesyncMcpConfigs.length} rulesync MCP configs`);
    return rulesyncMcpConfigs;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific MCP configurations and parse them into ToolMcp instances
   */
  async loadToolFiles(): Promise<ToolFile[]> {
    switch (this.toolTarget) {
      case "amazonqcli":
        return await this.loadAmazonqcliMcp();
      case "augmentcode":
        return await this.loadAugmentcodeMcp();
      case "claudecode":
        return await this.loadClaudecodeMcp();
      case "cline":
        return await this.loadClineMcp();
      case "codexcli":
        return await this.loadCodexcliMcp();
      case "copilot":
        return await this.loadCopilotMcp();
      case "cursor":
        return await this.loadCursorMcp();
      case "geminicli":
        return await this.loadGeminicliMcp();
      case "junie":
        return await this.loadJunieMcp();
      case "kiro":
        return await this.loadKiroMcp();
      case "opencode":
        return await this.loadOpencodeMcp();
      case "qwencode":
        return await this.loadQwencodeMcp();
      case "roo":
        return await this.loadRooMcp();
      case "windsurf":
        return await this.loadWindsurfMcp();
      default:
        throw new Error(`Unsupported tool target: ${this.toolTarget}`);
    }
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets(): ToolTarget[] {
    return mcpProcessorToolTargets;
  }

  /**
   * Load Amazon Q CLI MCP configuration from .amazonq/mcp.json
   */
  private async loadAmazonqcliMcp(): Promise<ToolMcp[]> {
    const mcpPath = join(this.baseDir, ".amazonq", "mcp.json");

    if (!(await fileExists(mcpPath))) {
      logger.info(`Amazon Q CLI MCP config not found: ${mcpPath}`);
      return [];
    }

    try {
      const config = await AmazonqcliMcp.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        filePath: mcpPath,
      });
      return [config];
    } catch (error) {
      logger.warn(`Failed to load Amazon Q CLI MCP config:`, error);
      return [];
    }
  }

  /**
   * Load AugmentCode MCP configuration from .mcp.json
   */
  private async loadAugmentcodeMcp(): Promise<ToolMcp[]> {
    const mcpPath = join(this.baseDir, ".mcp.json");

    if (!(await fileExists(mcpPath))) {
      logger.info(`AugmentCode MCP config not found: ${mcpPath}`);
      return [];
    }

    try {
      const config = await AugmentcodeMcp.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        filePath: mcpPath,
      });
      return [config];
    } catch (error) {
      logger.warn(`Failed to load AugmentCode MCP config:`, error);
      return [];
    }
  }

  /**
   * Load Claude Code MCP configuration from .mcp.json
   */
  private async loadClaudecodeMcp(): Promise<ToolMcp[]> {
    const mcpPath = join(this.baseDir, ".mcp.json");

    if (!(await fileExists(mcpPath))) {
      logger.info(`Claude Code MCP config not found: ${mcpPath}`);
      return [];
    }

    try {
      const config = await ClaudecodeMcp.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        filePath: mcpPath,
      });
      return [config];
    } catch (error) {
      logger.warn(`Failed to load Claude Code MCP config:`, error);
      return [];
    }
  }

  /**
   * Load Cline MCP configuration from .cline/mcp.json
   */
  private async loadClineMcp(): Promise<ToolMcp[]> {
    const mcpPath = join(this.baseDir, ".cline", "mcp.json");

    if (!(await fileExists(mcpPath))) {
      logger.info(`Cline MCP config not found: ${mcpPath}`);
      return [];
    }

    try {
      const config = await ClineMcp.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".cline",
        relativeFilePath: "mcp.json",
        filePath: mcpPath,
      });
      return [config];
    } catch (error) {
      logger.warn(`Failed to load Cline MCP config:`, error);
      return [];
    }
  }

  /**
   * Load CodexCLI MCP configuration from opencode.json
   */
  private async loadCodexcliMcp(): Promise<ToolMcp[]> {
    const mcpPath = join(this.baseDir, "opencode.json");

    if (!(await fileExists(mcpPath))) {
      logger.info(`CodexCLI MCP config not found: ${mcpPath}`);
      return [];
    }

    try {
      const config = await CodexcliMcp.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        filePath: mcpPath,
      });
      return [config];
    } catch (error) {
      logger.warn(`Failed to load CodexCLI MCP config:`, error);
      return [];
    }
  }

  /**
   * Load Copilot MCP configuration from both coding-agent and editor formats
   */
  private async loadCopilotMcp(): Promise<ToolMcp[]> {
    const configs: ToolMcp[] = [];

    // Try coding-agent format first
    const codingAgentPath = join(this.baseDir, "copilot-coding-agent.json");
    if (await fileExists(codingAgentPath)) {
      try {
        const config = await CopilotMcp.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".",
          relativeFilePath: "copilot-coding-agent.json",
          filePath: codingAgentPath,
        });
        configs.push(config);
      } catch (error) {
        logger.warn(`Failed to load Copilot coding-agent MCP config:`, error);
      }
    }

    // Try editor format (.vscode/mcp.json)
    const editorPath = join(this.baseDir, ".vscode", "mcp.json");
    if (await fileExists(editorPath)) {
      try {
        const config = await CopilotMcp.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".vscode",
          relativeFilePath: "mcp.json",
          filePath: editorPath,
        });
        configs.push(config);
      } catch (error) {
        logger.warn(`Failed to load Copilot editor MCP config:`, error);
      }
    }

    if (configs.length === 0) {
      logger.info(`No Copilot MCP configs found`);
    }

    return configs;
  }

  /**
   * Load Cursor MCP configuration from .cursor/mcp.json
   */
  private async loadCursorMcp(): Promise<ToolMcp[]> {
    const mcpPath = join(this.baseDir, ".cursor", "mcp.json");

    if (!(await fileExists(mcpPath))) {
      logger.info(`Cursor MCP config not found: ${mcpPath}`);
      return [];
    }

    try {
      const config = await CursorMcp.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        filePath: mcpPath,
      });
      return [config];
    } catch (error) {
      logger.warn(`Failed to load Cursor MCP config:`, error);
      return [];
    }
  }

  /**
   * Load Gemini CLI MCP configuration from .gemini/settings.json
   */
  private async loadGeminicliMcp(): Promise<ToolMcp[]> {
    const mcpPath = join(this.baseDir, ".gemini", "settings.json");

    if (!(await fileExists(mcpPath))) {
      logger.info(`Gemini CLI MCP config not found: ${mcpPath}`);
      return [];
    }

    try {
      const config = await GeminicliMcp.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".gemini",
        relativeFilePath: "settings.json",
        filePath: mcpPath,
      });
      return [config];
    } catch (error) {
      logger.warn(`Failed to load Gemini CLI MCP config:`, error);
      return [];
    }
  }

  /**
   * Load Junie MCP configuration from .junie/mcp_settings.json
   */
  private async loadJunieMcp(): Promise<ToolMcp[]> {
    const mcpPath = join(this.baseDir, ".junie", "mcp_settings.json");

    if (!(await fileExists(mcpPath))) {
      logger.info(`Junie MCP config not found: ${mcpPath}`);
      return [];
    }

    try {
      const config = await JunieMcp.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".junie",
        relativeFilePath: "mcp_settings.json",
        filePath: mcpPath,
      });
      return [config];
    } catch (error) {
      logger.warn(`Failed to load Junie MCP config:`, error);
      return [];
    }
  }

  /**
   * Load Kiro MCP configuration from .kiro/mcp.json
   */
  private async loadKiroMcp(): Promise<ToolMcp[]> {
    const mcpPath = join(this.baseDir, ".kiro", "mcp.json");

    if (!(await fileExists(mcpPath))) {
      logger.info(`Kiro MCP config not found: ${mcpPath}`);
      return [];
    }

    try {
      const config = await KiroMcp.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".kiro",
        relativeFilePath: "mcp.json",
        filePath: mcpPath,
      });
      return [config];
    } catch (error) {
      logger.warn(`Failed to load Kiro MCP config:`, error);
      return [];
    }
  }

  /**
   * Load OpenCode MCP configuration from opencode.json
   */
  private async loadOpencodeMcp(): Promise<ToolMcp[]> {
    const mcpPath = join(this.baseDir, "opencode.json");

    if (!(await fileExists(mcpPath))) {
      logger.info(`OpenCode MCP config not found: ${mcpPath}`);
      return [];
    }

    try {
      const config = await OpencodeMcp.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        filePath: mcpPath,
      });
      return [config];
    } catch (error) {
      logger.warn(`Failed to load OpenCode MCP config:`, error);
      return [];
    }
  }

  /**
   * Load QwenCode MCP configuration from .qwen/settings.json
   */
  private async loadQwencodeMcp(): Promise<ToolMcp[]> {
    const mcpPath = join(this.baseDir, ".qwen", "settings.json");

    if (!(await fileExists(mcpPath))) {
      logger.info(`QwenCode MCP config not found: ${mcpPath}`);
      return [];
    }

    try {
      const config = await QwencodeMcp.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        filePath: mcpPath,
      });
      return [config];
    } catch (error) {
      logger.warn(`Failed to load QwenCode MCP config:`, error);
      return [];
    }
  }

  /**
   * Load Roo Code MCP configuration from .roo/mcp.json
   */
  private async loadRooMcp(): Promise<ToolMcp[]> {
    const mcpPath = join(this.baseDir, ".roo", "mcp.json");

    if (!(await fileExists(mcpPath))) {
      logger.info(`Roo Code MCP config not found: ${mcpPath}`);
      return [];
    }

    try {
      const config = await RooMcp.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        filePath: mcpPath,
      });
      return [config];
    } catch (error) {
      logger.warn(`Failed to load Roo Code MCP config:`, error);
      return [];
    }
  }

  /**
   * Load Windsurf MCP configuration from mcp_config.json
   */
  private async loadWindsurfMcp(): Promise<ToolMcp[]> {
    const mcpPath = join(this.baseDir, "mcp_config.json");

    if (!(await fileExists(mcpPath))) {
      logger.info(`Windsurf MCP config not found: ${mcpPath}`);
      return [];
    }

    try {
      const config = await WindsurfMcp.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".",
        relativeFilePath: "mcp_config.json",
        filePath: mcpPath,
      });
      return [config];
    } catch (error) {
      logger.warn(`Failed to load Windsurf MCP config:`, error);
      return [];
    }
  }

  /**
   * Write MCP servers from import data (during import process)
   * This method writes MCP servers directly to .rulesync/.mcp.json
   */
  async writeRulesyncMcpFromImport(mcpServers: Record<string, RulesyncMcpServer>): Promise<void> {
    if (!mcpServers || Object.keys(mcpServers).length === 0) {
      logger.debug("No MCP servers to write during import");
      return;
    }

    const mcpPath = join(this.baseDir, ".rulesync", ".mcp.json");
    const mcpContent = JSON.stringify({ mcpServers }, null, 2) + "\n";

    try {
      const { writeFile, mkdir } = await import("node:fs/promises");

      // Ensure .rulesync directory exists
      await mkdir(join(this.baseDir, ".rulesync"), { recursive: true });

      // Write MCP config file
      await writeFile(mcpPath, mcpContent, "utf8");

      logger.info(`Created .mcp.json with ${Object.keys(mcpServers).length} servers`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to write MCP configuration during import: ${errorMessage}`);
    }
  }
}

import { join } from "node:path";
import { ValidationResult } from "../types/ai-file.js";
import { readOrInitializeFileContent } from "../utils/file.js";
import { ModularMcp } from "./modular-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

export class ClaudecodeMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;
  private modularMcpFile?: ModularMcp;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = JSON.parse(this.fileContent || "{}");
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  setModularMcpFile(file: ModularMcp): void {
    this.modularMcpFile = file;
  }

  getModularMcpFile(): ModularMcp | undefined {
    return this.modularMcpFile;
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      return {
        relativeDirPath: ".claude",
        relativeFilePath: ".claude.json",
      };
    }
    return {
      relativeDirPath: ".",
      relativeFilePath: ".mcp.json",
    };
  }

  static async fromFile({
    baseDir = ".",
    validate = true,
    global = false,
    modularMcp = false,
  }: ToolMcpFromFileParams & { modularMcp?: boolean }): Promise<ClaudecodeMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent = await readOrInitializeFileContent(
      join(baseDir, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcpServers: {} }, null, 2),
    );
    const json = JSON.parse(fileContent);
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    const claudecodeMcp = new ClaudecodeMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
    });

    if (modularMcp) {
      const modularMcpPaths = ModularMcp.getSettablePaths();
      const modularMcpFileContent = await readOrInitializeFileContent(
        join(baseDir, modularMcpPaths.relativeDirPath, modularMcpPaths.relativeFilePath),
        JSON.stringify({ mcpServers: {} }, null, 2),
      );

      const modularMcpFile = new ModularMcp({
        baseDir,
        relativeDirPath: modularMcpPaths.relativeDirPath,
        relativeFilePath: modularMcpPaths.relativeFilePath,
        fileContent: modularMcpFileContent,
        validate,
      });

      claudecodeMcp.setModularMcpFile(modularMcpFile);
    }

    return claudecodeMcp;
  }

  static async fromRulesyncMcp({
    baseDir = ".",
    rulesyncMcp,
    validate = true,
    global = false,
    modularMcp = false,
  }: ToolMcpFromRulesyncMcpParams & { modularMcp?: boolean }): Promise<ClaudecodeMcp> {
    const paths = this.getSettablePaths({ global });

    const fileContent = await readOrInitializeFileContent(
      join(baseDir, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcpServers: {} }, null, 2),
    );
    const json = JSON.parse(fileContent);

    let mcpJson: Record<string, unknown>;
    let modularMcpJson: Record<string, unknown> | undefined;

    if (modularMcp) {
      // Generate .mcp.json with modular-mcp proxy
      mcpJson = {
        ...json,
        mcpServers: {
          "modular-mcp": {
            type: "stdio",
            command: "npx",
            args: ["-y", "@kimuson/modular-mcp", "modular-mcp.json"],
            env: {},
          },
        },
      };

      // Generate modular-mcp.json with actual server configurations
      modularMcpJson = {
        mcpServers: rulesyncMcp.getJson({ modularMcp: true }).mcpServers,
      };
    } else {
      mcpJson = { ...json, mcpServers: rulesyncMcp.getJson({ modularMcp: false }).mcpServers };
    }

    const claudecodeMcp = new ClaudecodeMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(mcpJson, null, 2),
      validate,
    });

    if (modularMcp && modularMcpJson) {
      const modularMcpPaths = ModularMcp.getSettablePaths();
      const modularMcpFile = new ModularMcp({
        baseDir,
        relativeDirPath: modularMcpPaths.relativeDirPath,
        relativeFilePath: modularMcpPaths.relativeFilePath,
        fileContent: JSON.stringify(modularMcpJson, null, 2),
        validate,
      });

      claudecodeMcp.setModularMcpFile(modularMcpFile);
    }

    return claudecodeMcp;
  }

  toRulesyncMcp(): RulesyncMcp {
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: this.json.mcpServers }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}

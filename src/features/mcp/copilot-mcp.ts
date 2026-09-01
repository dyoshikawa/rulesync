import { join } from "node:path";

import { COPILOT_MCP_DIR, COPILOT_MCP_FILE_NAME } from "../../constants/copilot-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContent, readFileContentOrNull } from "../../utils/file.js";
import { parseJsonc } from "../../utils/jsonc.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

/**
 * `.vscode/mcp.json` has three documented top-level sections: `servers` (the
 * one rulesync manages), `inputs` (secret prompts referenced as
 * `${input:id}`) and `sandbox` (filesystem/network rules for sandboxed
 * servers). Only `servers` is generated; the rest of the document is read back
 * and preserved, since VS Code recommends committing this file and dropping an
 * `inputs` entry would leave `${input:…}` unresolvable at startup.
 *
 * @see https://code.visualstudio.com/docs/agents/reference/mcp-configuration
 */
type CopilotMcpConfig = {
  servers?: McpServers;
  [key: string]: unknown;
};

function convertFromCopilotFormat(copilotConfig: CopilotMcpConfig): McpServers {
  return copilotConfig.servers ?? {};
}

export class CopilotMcp extends ToolMcp {
  private readonly json: CopilotMcpConfig;

  constructor(params: ToolMcpParams) {
    super(params);
    // JSONC, not JSON: `.vscode/mcp.json` is a file VS Code's own "MCP: Add
    // Server" scaffold writes a comment into, and the gateway now preserves
    // those comments on write-back, so this content can carry them.
    this.json =
      this.fileContent !== undefined ? (parseJsonc(this.fileContent) as CopilotMcpConfig) : {};
  }

  getJson(): CopilotMcpConfig {
    return this.json;
  }

  static getSettablePaths(): ToolMcpSettablePaths {
    return {
      relativeDirPath: COPILOT_MCP_DIR,
      relativeFilePath: COPILOT_MCP_FILE_NAME,
    };
  }
  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolMcpFromFileParams): Promise<CopilotMcp> {
    const fileContent = await readFileContent(
      join(
        outputRoot,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath,
      ),
    );

    return new CopilotMcp({
      outputRoot,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate,
    });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
  }: ToolMcpFromRulesyncMcpParams): Promise<CopilotMcp> {
    const paths = this.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so this stays side-effect-free under
    // `--dry-run`/`--check`; the actual write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    return new CopilotMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      // The shared-config gateway owns only `servers`, parses the file as the
      // JSONC VS Code actually writes (its "MCP: Add Server" scaffold starts
      // with a comment), and fails closed rather than overwriting a file it
      // could not fully parse.
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "mcp",
        existingContent,
        patch: { servers: rulesyncMcp.getMcpServers() },
        filePath,
      }),
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = convertFromCopilotFormat(this.json);
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolMcpForDeletionParams): CopilotMcp {
    return new CopilotMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}

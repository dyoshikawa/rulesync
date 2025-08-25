import { RulesyncMcpConfigSchema } from "../../types/mcp.js";
import { safeAsyncOperation } from "../../utils/error.js";
import { fileExists, readFileContent, resolvePath } from "../../utils/file.js";
import { BaseMcpParser, type McpParseResult } from "./base.js";

/**
 * Parser for Gemini CLI MCP configuration
 */
export class GeminiCLIMcpParser extends BaseMcpParser {
  getToolName() {
    return "geminicli" as const;
  }

  getMcpConfigFileName(): string {
    return ".gemini/settings.json";
  }

  async parseMcp(baseDir: string): Promise<McpParseResult> {
    const result: McpParseResult = {
      mcpServers: {},
      errors: [],
    };

    const settingsPath = resolvePath(".gemini/settings.json", baseDir);
    if (!(await fileExists(settingsPath))) {
      // Not an error - settings.json is optional
      return result;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const content = await readFileContent(settingsPath);
      const settings = JSON.parse(content);

      // Extract MCP servers
      const mcpParseResult = RulesyncMcpConfigSchema.safeParse(settings);
      if (mcpParseResult.success && Object.keys(mcpParseResult.data.mcpServers).length > 0) {
        result.mcpServers = mcpParseResult.data.mcpServers;
      }
    }, "Failed to parse .gemini/settings.json");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }

    return result;
  }
}

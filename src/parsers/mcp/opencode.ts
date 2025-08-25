import { RulesyncMcpConfigSchema } from "../../types/mcp.js";
import { safeAsyncOperation } from "../../utils/error.js";
import { fileExists, readFileContent, resolvePath } from "../../utils/file.js";
import { BaseMcpParser, type McpParseResult } from "./base.js";

/**
 * Parser for OpenCode MCP configuration
 */
export class OpenCodeMcpParser extends BaseMcpParser {
  getToolName() {
    return "opencode" as const;
  }

  getMcpConfigFileName(): string {
    return "opencode.json";
  }

  async parseMcp(baseDir: string): Promise<McpParseResult> {
    const result: McpParseResult = {
      mcpServers: {},
      errors: [],
    };

    const configPath = resolvePath("opencode.json", baseDir);
    if (!(await fileExists(configPath))) {
      // Not an error - opencode.json is optional
      return result;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const content = await readFileContent(configPath);
      const config = JSON.parse(content);

      // Extract MCP servers
      const mcpParseResult = RulesyncMcpConfigSchema.safeParse(config);
      if (mcpParseResult.success && Object.keys(mcpParseResult.data.mcpServers).length > 0) {
        result.mcpServers = mcpParseResult.data.mcpServers;
      }
    }, "Failed to parse opencode.json");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }

    return result;
  }
}

import { RulesyncMcpConfigSchema } from "../../types/mcp.js";
import { safeAsyncOperation } from "../../utils/error.js";
import { fileExists, readFileContent, resolvePath } from "../../utils/file.js";
import { BaseMcpParser, type McpParseResult } from "./base.js";

/**
 * Parser for Amazon Q Developer CLI MCP configuration
 */
export class AmazonQCLIMcpParser extends BaseMcpParser {
  getToolName() {
    return "amazonqcli" as const;
  }

  getMcpConfigFileName(): string {
    return ".amazonq/mcp.json";
  }

  async parseMcp(baseDir: string): Promise<McpParseResult> {
    const result: McpParseResult = {
      mcpServers: {},
      errors: [],
    };

    const mcpPath = resolvePath(".amazonq/mcp.json", baseDir);
    if (!(await fileExists(mcpPath))) {
      // Not an error - mcp.json is optional
      return result;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const content = await readFileContent(mcpPath);
      const mcp = JSON.parse(content);
      const mcpParseResult = RulesyncMcpConfigSchema.safeParse(mcp);
      if (mcpParseResult.success && Object.keys(mcpParseResult.data.mcpServers).length > 0) {
        result.mcpServers = mcpParseResult.data.mcpServers;
      }
    }, "Failed to parse .amazonq/mcp.json");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }

    return result;
  }
}

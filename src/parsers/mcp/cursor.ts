import { join } from "node:path";
import type { RulesyncMcpServer } from "../../types/mcp.js";
import { RulesyncMcpConfigSchema } from "../../types/mcp.js";
import { getErrorMessage, safeAsyncOperation } from "../../utils/error.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { BaseMcpParser, type McpParseResult } from "./base.js";

/**
 * Parser for Cursor MCP configuration
 */
export class CursorMcpParser extends BaseMcpParser {
  getToolName() {
    return "cursor" as const;
  }

  getMcpConfigFileName(): string {
    return ".cursor/mcp.json";
  }

  async parseMcp(baseDir: string): Promise<McpParseResult> {
    const result: McpParseResult = {
      mcpServers: {},
      errors: [],
    };

    const cursorMcpPath = join(baseDir, ".cursor", "mcp.json");
    if (!(await fileExists(cursorMcpPath))) {
      // Not an error - mcp.json is optional
      return result;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const content = await readFileContent(cursorMcpPath);
      const mcp = JSON.parse(content);
      const mcpParseResult = RulesyncMcpConfigSchema.safeParse(mcp);
      if (mcpParseResult.success && Object.keys(mcpParseResult.data.mcpServers).length > 0) {
        result.mcpServers = mcpParseResult.data.mcpServers;
      }
    }, "Failed to parse .cursor/mcp.json");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }

    return result;
  }
}
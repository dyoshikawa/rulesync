import type { ToolTarget } from "../../types/tool-targets.js";
import { AmazonQCLIMcpParser } from "./amazonqcli.js";
import type { BaseMcpParser } from "./base.js";
import { ClaudeCodeMcpParser } from "./claudecode.js";
import { CursorMcpParser } from "./cursor.js";
import { GeminiCLIMcpParser } from "./geminicli.js";
import { OpenCodeMcpParser } from "./opencode.js";
import { QwenCodeMcpParser } from "./qwencode.js";

// Export all MCP parsers
export * from "./amazonqcli.js";
export * from "./base.js";
export * from "./claudecode.js";
export * from "./cursor.js";
export * from "./geminicli.js";
export * from "./opencode.js";
export * from "./qwencode.js";

/**
 * Factory function to get the appropriate MCP parser for a tool
 */
export function getMcpParser(tool: ToolTarget): BaseMcpParser | undefined {
  switch (tool) {
    case "amazonqcli":
      return new AmazonQCLIMcpParser();
    case "claudecode":
      return new ClaudeCodeMcpParser();
    case "cursor":
      return new CursorMcpParser();
    case "geminicli":
      return new GeminiCLIMcpParser();
    case "opencode":
      return new OpenCodeMcpParser();
    case "qwencode":
      return new QwenCodeMcpParser();
    // Tools that don't support MCP
    default:
      return undefined;
  }
}

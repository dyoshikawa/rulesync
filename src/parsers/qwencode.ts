import type { ParsedRule } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { getCommandParser } from "./commands/index.js";
import { getMcpParser } from "./mcp/index.js";
import { getRuleParser } from "./rules/index.js";

export interface QwenImportResult {
  rules: ParsedRule[];
  errors: string[];
  ignorePatterns?: string[];
  mcpServers?: Record<string, RulesyncMcpServer>;
}

export async function parseQwenConfiguration(
  baseDir: string = process.cwd(),
): Promise<QwenImportResult> {
  const result: QwenImportResult = {
    rules: [],
    errors: [],
  };

  // Parse rules using the new rule parser
  const ruleParser = getRuleParser("qwencode");
  if (ruleParser) {
    const ruleResult = await ruleParser.parseRules(baseDir);
    result.rules.push(...ruleResult.rules);
    result.errors.push(...ruleResult.errors);
  }

  // Parse MCP configuration using the new MCP parser
  const mcpParser = getMcpParser("qwencode");
  if (mcpParser) {
    const mcpResult = await mcpParser.parseMcp(baseDir);
    if (Object.keys(mcpResult.mcpServers).length > 0) {
      result.mcpServers = mcpResult.mcpServers;
    }
    result.errors.push(...mcpResult.errors);
  }

  // Parse commands using the new command parser
  const commandParser = getCommandParser("qwencode");
  if (commandParser) {
    const commands = await commandParser.parseCommands(baseDir);
    // Add commands to rules array since they are rules with type="command"
    result.rules.push(...commands);
  }

  return result;
}

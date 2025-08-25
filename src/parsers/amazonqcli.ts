import type { ParsedRule } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { getMcpParser } from "./mcp/index.js";
import { getRuleParser } from "./rules/index.js";

export interface AmazonqcliImportResult {
  rules: ParsedRule[];
  errors: string[];
  ignorePatterns?: string[];
  mcpServers?: Record<string, RulesyncMcpServer>;
}

export async function parseAmazonqcliConfiguration(
  baseDir: string = process.cwd(),
): Promise<AmazonqcliImportResult> {
  const result: AmazonqcliImportResult = {
    rules: [],
    errors: [],
  };

  // Parse rules using the new rule parser
  const ruleParser = getRuleParser("amazonqcli");
  if (ruleParser) {
    const ruleResult = await ruleParser.parseRules(baseDir);
    result.rules.push(...ruleResult.rules);
    result.errors.push(...ruleResult.errors);
  }

  // Parse MCP configuration using the new MCP parser
  const mcpParser = getMcpParser("amazonqcli");
  if (mcpParser) {
    const mcpResult = await mcpParser.parseMcp(baseDir);
    if (Object.keys(mcpResult.mcpServers).length > 0) {
      result.mcpServers = mcpResult.mcpServers;
    }
    result.errors.push(...mcpResult.errors);
  }

  return result;
}

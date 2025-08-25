import type { ParsedRule } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { getIgnoreParser } from "./ignore/index.js";
import { getMcpParser } from "./mcp/index.js";
import { getRuleParser } from "./rules/index.js";

export interface CursorImportResult {
  rules: ParsedRule[];
  errors: string[];
  ignorePatterns?: string[];
  mcpServers?: Record<string, RulesyncMcpServer>;
}

export async function parseCursorConfiguration(
  baseDir: string = process.cwd(),
): Promise<CursorImportResult> {
  const result: CursorImportResult = {
    rules: [],
    errors: [],
  };

  // Parse rules using the new rule parser
  const ruleParser = getRuleParser("cursor");
  if (ruleParser) {
    const ruleResult = await ruleParser.parseRules(baseDir);
    result.rules.push(...ruleResult.rules);
    result.errors.push(...ruleResult.errors);
  }

  // Parse MCP configuration using the new MCP parser
  const mcpParser = getMcpParser("cursor");
  if (mcpParser) {
    const mcpResult = await mcpParser.parseMcp(baseDir);
    if (Object.keys(mcpResult.mcpServers).length > 0) {
      result.mcpServers = mcpResult.mcpServers;
    }
    result.errors.push(...mcpResult.errors);
  }

  // Parse ignore patterns using the dedicated ignore parser
  const ignoreParser = getIgnoreParser("cursor");
  if (ignoreParser) {
    const ignoreResult = await ignoreParser.parseIgnorePatterns(baseDir);
    if (ignoreResult.patterns.length > 0) {
      result.ignorePatterns = ignoreResult.patterns;
    }
    result.errors.push(...ignoreResult.errors);
  }

  return result;
}

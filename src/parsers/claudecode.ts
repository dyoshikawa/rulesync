import type { ParsedRule } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import type { ParsedSubagent } from "../types/subagent.js";
import { fileExists, resolvePath } from "../utils/file.js";
import { getCommandParser } from "./commands/index.js";
import { getIgnoreParser } from "./ignore/index.js";
import { getMcpParser } from "./mcp/index.js";
import { getRuleParser } from "./rules/index.js";
import { parseSubagentsFromDirectory } from "./subagents/shared.js";

export interface ClaudeImportResult {
  rules: ParsedRule[];
  errors: string[];
  ignorePatterns?: string[];
  mcpServers?: Record<string, RulesyncMcpServer>;
  subagents?: ParsedSubagent[];
}

export async function parseClaudeConfiguration(
  baseDir: string = process.cwd(),
): Promise<ClaudeImportResult> {
  // Create the result
  const result: ClaudeImportResult = {
    rules: [],
    errors: [],
  };

  // Parse rules using the new rule parser
  const ruleParser = getRuleParser("claudecode");
  if (ruleParser) {
    const ruleResult = await ruleParser.parseRules(baseDir);
    result.rules.push(...ruleResult.rules);
    result.errors.push(...ruleResult.errors);
  }

  // Parse MCP configuration using the new MCP parser
  const mcpParser = getMcpParser("claudecode");
  if (mcpParser) {
    const mcpResult = await mcpParser.parseMcp(baseDir);
    if (Object.keys(mcpResult.mcpServers).length > 0) {
      result.mcpServers = mcpResult.mcpServers;
    }
    result.errors.push(...mcpResult.errors);
  }

  // Parse subagents if they exist
  const agentsDir = resolvePath(".claude/agents", baseDir);
  if (await fileExists(agentsDir)) {
    const subagents = await parseSubagentsFromDirectory(agentsDir);
    if (subagents.length > 0) {
      result.subagents = subagents;
    }
  }

  // Parse commands using the new command parser
  const commandParser = getCommandParser("claudecode");
  if (commandParser) {
    const commands = await commandParser.parseCommands(baseDir);
    // Add commands to rules array since they are rules with type="command"
    result.rules.push(...commands);
  }

  // Parse ignore patterns using the dedicated ignore parser
  const ignoreParser = getIgnoreParser("claudecode");
  if (ignoreParser) {
    const ignoreResult = await ignoreParser.parseIgnorePatterns(baseDir);
    if (ignoreResult.patterns.length > 0) {
      result.ignorePatterns = ignoreResult.patterns;
    }
    result.errors.push(...ignoreResult.errors);
  }

  return result;
}

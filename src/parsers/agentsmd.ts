import type { ParsedRule } from "../types/index.js";
import { getRuleParser } from "./rules/index.js";

export interface AgentsMdImportResult {
  rules: ParsedRule[];
  errors: string[];
}

export async function parseAgentsMdConfiguration(
  baseDir: string = process.cwd(),
): Promise<AgentsMdImportResult> {
  const result: AgentsMdImportResult = {
    rules: [],
    errors: [],
  };

  // Parse rules using the new rule parser
  const ruleParser = getRuleParser("agentsmd");
  if (ruleParser) {
    const ruleResult = await ruleParser.parseRules(baseDir);
    result.rules.push(...ruleResult.rules);
    result.errors.push(...ruleResult.errors);
  }

  return result;
}

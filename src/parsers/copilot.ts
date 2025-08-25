import type { ParsedRule } from "../types/index.js";
import { getRuleParser } from "./rules/index.js";

export interface CopilotImportResult {
  rules: ParsedRule[];
  errors: string[];
}

export async function parseCopilotConfiguration(
  baseDir: string = process.cwd(),
): Promise<CopilotImportResult> {
  const result: CopilotImportResult = {
    rules: [],
    errors: [],
  };

  // Parse rules using the new rule parser
  const ruleParser = getRuleParser("copilot");
  if (ruleParser) {
    const ruleResult = await ruleParser.parseRules(baseDir);
    result.rules.push(...ruleResult.rules);
    result.errors.push(...ruleResult.errors);
  }

  return result;
}

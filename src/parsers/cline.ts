import type { ParsedRule } from "../types/index.js";
import { getRuleParser } from "./rules/index.js";

export interface ClineImportResult {
  rules: ParsedRule[];
  errors: string[];
}

export async function parseClineConfiguration(
  baseDir: string = process.cwd(),
): Promise<ClineImportResult> {
  const result: ClineImportResult = {
    rules: [],
    errors: [],
  };

  // Parse rules using the new rule parser
  const ruleParser = getRuleParser("cline");
  if (ruleParser) {
    const ruleResult = await ruleParser.parseRules(baseDir);
    result.rules.push(...ruleResult.rules);
    result.errors.push(...ruleResult.errors);
  }

  return result;
}

import type { ParsedRule } from "../types/index.js";
import { getRuleParser } from "./rules/index.js";

export interface RooImportResult {
  rules: ParsedRule[];
  errors: string[];
}

export async function parseRooConfiguration(
  baseDir: string = process.cwd(),
): Promise<RooImportResult> {
  const result: RooImportResult = {
    rules: [],
    errors: [],
  };

  // Parse rules using the new rule parser
  const ruleParser = getRuleParser("roo");
  if (ruleParser) {
    const ruleResult = await ruleParser.parseRules(baseDir);
    result.rules.push(...ruleResult.rules);
    result.errors.push(...ruleResult.errors);
  }

  return result;
}

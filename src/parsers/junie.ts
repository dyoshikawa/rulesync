import type { ParsedRule } from "../types/index.js";
import { getRuleParser } from "./rules/index.js";

export interface JunieImportResult {
  rules: ParsedRule[];
  errors: string[];
}

export async function parseJunieConfiguration(
  baseDir: string = process.cwd(),
): Promise<JunieImportResult> {
  const result: JunieImportResult = {
    rules: [],
    errors: [],
  };

  // Parse rules using the new rule parser
  const ruleParser = getRuleParser("junie");
  if (ruleParser) {
    const ruleResult = await ruleParser.parseRules(baseDir);
    result.rules.push(...ruleResult.rules);
    result.errors.push(...ruleResult.errors);
  }

  return result;
}

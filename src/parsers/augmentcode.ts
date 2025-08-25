import type { ParsedRule } from "../types/index.js";
import { getRuleParser } from "./rules/index.js";

export interface AugmentImportResult {
  rules: ParsedRule[];
  errors: string[];
}

export async function parseAugmentcodeConfiguration(
  baseDir: string = process.cwd(),
): Promise<AugmentImportResult> {
  const result: AugmentImportResult = {
    rules: [],
    errors: [],
  };

  // Parse rules using the new rule parser
  const ruleParser = getRuleParser("augmentcode");
  if (ruleParser) {
    const ruleResult = await ruleParser.parseRules(baseDir);
    result.rules.push(...ruleResult.rules);
    result.errors.push(...ruleResult.errors);
  }

  return result;
}

export async function parseAugmentcodeLegacyConfiguration(
  baseDir: string = process.cwd(),
): Promise<AugmentImportResult> {
  // Legacy parsing is now handled within the AugmentCodeRuleParser
  return parseAugmentcodeConfiguration(baseDir);
}

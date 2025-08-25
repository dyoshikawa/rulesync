import type { ParsedRule } from "../types/index.js";
import { getIgnoreParser } from "./ignore/index.js";
import { getRuleParser } from "./rules/index.js";

export interface CodexImportResult {
  rules: ParsedRule[];
  errors: string[];
  ignorePatterns?: string[];
}

export async function parseCodexConfiguration(
  baseDir: string = process.cwd(),
): Promise<CodexImportResult> {
  const result: CodexImportResult = {
    rules: [],
    errors: [],
  };

  // Parse rules using the new rule parser
  const ruleParser = getRuleParser("codexcli");
  if (ruleParser) {
    const ruleResult = await ruleParser.parseRules(baseDir);
    result.rules.push(...ruleResult.rules);
    result.errors.push(...ruleResult.errors);
  }

  // Parse ignore patterns using the dedicated ignore parser
  const ignoreParser = getIgnoreParser("codexcli");
  if (ignoreParser) {
    const ignoreResult = await ignoreParser.parseIgnorePatterns(baseDir);
    if (ignoreResult.patterns.length > 0) {
      result.ignorePatterns = ignoreResult.patterns;
    }
    result.errors.push(...ignoreResult.errors);
  }

  return result;
}

import type { ParsedRule, ToolTarget } from "../types/index.js";

/**
 * Checks if a rule is a tool-specific specification file that should only
 * be generated for its intended tool.
 *
 * @param rule - The parsed rule to check
 * @param targetTool - The tool currently being generated for
 * @returns true if the rule should be included for this tool, false otherwise
 */
export function isToolSpecificRule(rule: ParsedRule, targetTool: ToolTarget): boolean {
  const filename = rule.filename;

  // Check if filename indicates it's for a specific tool
  // Note: Order matters - check augmentcode-legacy before augmentcode
  const toolPatterns: Record<string, RegExp> = {
    "augmentcode-legacy": /^specification-augmentcode-legacy-/i,
    augmentcode: /^specification-augmentcode-/i,
    copilot: /^specification-copilot-/i,
    cursor: /^specification-cursor-/i,
    cline: /^specification-cline-/i,
    claudecode: /^specification-claudecode-/i,
    roo: /^specification-roo-/i,
    geminicli: /^specification-geminicli-/i,
    kiro: /^specification-kiro-/i,
  };

  for (const [tool, pattern] of Object.entries(toolPatterns)) {
    if (pattern.test(filename)) {
      return tool === targetTool;
    }
  }

  return true;
}

/**
 * Filters rules to only include those that should be generated for a specific tool.
 * This includes:
 * 1. Rules that explicitly target the tool (or use "*")
 * 2. Rules that aren't tool-specific specifications for other tools
 *
 * @param rules - All parsed rules
 * @param targetTool - The tool to filter for
 * @param resolvedTargets - The resolved targets for each rule
 * @returns Filtered rules for the specific tool
 */
export function filterRulesForToolWithSpecificationCheck(
  rules: ParsedRule[],
  targetTool: ToolTarget,
  resolvedTargets: ToolTarget[],
): ParsedRule[] {
  return rules.filter((rule) => {
    if (!resolvedTargets.includes(targetTool)) {
      return false;
    }

    return isToolSpecificRule(rule, targetTool);
  });
}

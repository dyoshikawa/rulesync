import { ALL_TOOL_TARGETS, type ToolTarget } from "../../types/index.js";
import { logger } from "../../utils/logger.js";

/**
 * Parse targets from a string or array of strings
 * @param targetsInput - Comma-separated string or array of tool names
 * @returns Array of valid tool targets
 */
export function parseTargets(targetsInput: string | string[]): ToolTarget[] {
  if (!targetsInput) {
    return [];
  }

  let targetStrings: string[];

  if (Array.isArray(targetsInput)) {
    targetStrings = targetsInput;
  } else {
    // Split by comma and trim whitespace
    targetStrings = targetsInput
      .split(",")
      .map((target) => target.trim())
      .filter((target) => target.length > 0);
  }

  const results: ToolTarget[] = [];
  const errors: string[] = [];
  let hasWildcard = false;

  for (const targetString of targetStrings) {
    if (targetString === "*" || targetString === "all") {
      // "*" or "all" keyword means all tools
      hasWildcard = true;
      results.push(...ALL_TOOL_TARGETS);
    } else if (isValidToolTarget(targetString)) {
      results.push(targetString);
    } else {
      errors.push(targetString);
    }
  }

  // Validate that * is not used with other specific tools
  if (hasWildcard && targetStrings.length > 1) {
    throw new Error(
      "Cannot use '*' (all tools) with specific tool targets. Use either '--targets *' for all tools, or specify individual tools.",
    );
  }

  if (errors.length > 0) {
    const validTargets = ALL_TOOL_TARGETS.join(", ");
    throw new Error(
      `Invalid tool targets: ${errors.join(", ")}. Valid targets are: ${validTargets}, *, all`,
    );
  }

  // Remove duplicates
  return [...new Set(results)];
}

/**
 * Check if a string is a valid tool target
 * @param target - String to check
 * @returns True if valid tool target
 */
function isValidToolTarget(target: string): target is ToolTarget {
  // eslint-disable-next-line no-type-assertion/no-type-assertion
  return ALL_TOOL_TARGETS.includes(target as ToolTarget);
}

/**
 * Check for deprecated individual flags and return the tools they represent
 * @param options - Commander options object
 * @returns Array of tool targets from deprecated flags
 */
export function checkDeprecatedFlags(options: Record<string, unknown>): ToolTarget[] {
  const deprecatedTools: ToolTarget[] = [];

  // Map of option names to tool targets
  const flagToToolMap: Record<string, ToolTarget> = {
    agentsmd: "agentsmd",
    amazonqcli: "amazonqcli",
    augmentcode: "augmentcode",
    "augmentcode-legacy": "augmentcode-legacy",
    copilot: "copilot",
    cursor: "cursor",
    cline: "cline",
    codexcli: "codexcli",
    claudecode: "claudecode",
    roo: "roo",
    geminicli: "geminicli",
    junie: "junie",
    qwencode: "qwencode",
    kiro: "kiro",
    opencode: "opencode",
    windsurf: "windsurf",
  };

  for (const [flag, tool] of Object.entries(flagToToolMap)) {
    if (options[flag]) {
      deprecatedTools.push(tool);
    }
  }

  return deprecatedTools;
}

/**
 * Generate a deprecation warning message for deprecated flags
 * @param deprecatedTools - Array of tools from deprecated flags
 * @param command - Command name (generate or import)
 * @returns Formatted warning message
 */
export function getDeprecationWarning(
  deprecatedTools: ToolTarget[],
  command: string = "generate",
): string {
  const toolsStr = deprecatedTools.join(",");
  return [
    "⚠️  DEPRECATED: Individual tool flags are deprecated and will be removed in a future version.",
    `   Current: rulesync ${command} ${deprecatedTools.map((t) => `--${t}`).join(" ")}`,
    `   New:     rulesync ${command} --targets ${toolsStr}`,
    "   Please update your scripts to use the new --targets flag.",
  ].join("\n");
}

/**
 * Merge and deduplicate tools from different sources
 * @param targetsTools - Tools from --targets flag
 * @param deprecatedTools - Tools from deprecated individual flags
 * @param allFlag - Whether --all flag was used
 * @returns Combined and deduplicated array of tools
 */
export function mergeAndDeduplicateTools(
  targetsTools: ToolTarget[],
  deprecatedTools: ToolTarget[],
  allFlag: boolean,
): ToolTarget[] {
  if (allFlag) {
    // Show deprecation warning for --all flag
    logger.warn(
      [
        "⚠️  DEPRECATED: The --all flag is deprecated and will be removed in a future version.",
        "   Current: rulesync generate --all",
        "   New:     rulesync generate --targets *",
        "   Please update your scripts to use the new --targets flag.",
      ].join("\n"),
    );
    return [...ALL_TOOL_TARGETS];
  }

  const allTools = [...targetsTools, ...deprecatedTools];
  return [...new Set(allTools)];
}

/**
 * Validate that at least one target is specified
 * @param tools - Array of tool targets
 * @throws Error if no tools are specified
 */
export function validateToolsNotEmpty(tools: ToolTarget[]): void {
  if (tools.length === 0) {
    throw new Error(
      "No tools specified. Use --targets <tool1,tool2> or --targets * to specify which tools to generate for.",
    );
  }
}

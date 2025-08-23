import { type ProcessedRule } from "../../types/rules.js";
import { type ParsedSubagent, type SubagentOutput } from "../../types/subagent.js";
import { logger } from "../../utils/logger.js";

/**
 * Generate subagent files from processed rules
 * @param rules Processed rules to convert to subagents
 * @returns Array of subagent outputs
 */
export function generateSubagentsFromRules(_rules: ProcessedRule[]): SubagentOutput[] {
  // NOTE: This function was originally designed to convert regular rules to subagents,
  // but this is not the intended behavior. Subagents should only come from
  // the .rulesync/subagents/ directory. Returning empty array to prevent
  // unintended file generation.
  logger.debug("Skipping rule-to-subagent conversion (deprecated behavior)");
  return [];
}

/**
 * Convert parsed subagents to output format
 */
export function formatSubagentsForOutput(subagents: ParsedSubagent[]): SubagentOutput[] {
  return subagents.map((subagent) => {
    // Build frontmatter
    const frontmatterLines: string[] = ["---"];
    frontmatterLines.push(`name: ${subagent.frontmatter.name}`);
    frontmatterLines.push(`description: ${subagent.frontmatter.description}`);

    if (subagent.frontmatter.model) {
      frontmatterLines.push(`model: ${subagent.frontmatter.model}`);
    }

    frontmatterLines.push("---");

    // Combine frontmatter and content
    const content = `${frontmatterLines.join("\n")}\n\n${subagent.content}`;

    return {
      filename: `${subagent.filename}.md`,
      content,
    };
  });
}

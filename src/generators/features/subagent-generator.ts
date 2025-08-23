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

// NOTE: These functions are deprecated and kept for potential future use
// /**
//  * Convert a single rule to a subagent
//  */
// function convertRuleToSubagent(rule: ProcessedRule): SubagentOutput | null {
//   try {
//     // Generate subagent name from filename
//     const name = generateSubagentName(rule.filename);
//
//     // Build frontmatter
//     const frontmatterLines: string[] = ["---"];
//     frontmatterLines.push(`name: ${name}`);
//     frontmatterLines.push(`description: ${rule.frontmatter.description}`);
//
//     // Add model if it makes sense (could be configured in the future)
//     // For now, we'll leave it unspecified to use the default
//
//     frontmatterLines.push("---");
//
//     // Combine frontmatter and content
//     const content = `${frontmatterLines.join("\n")}\n\n${rule.content}`;
//
//     // Generate filename (kebab-case version of the name)
//     const filename = `${name.toLowerCase().replace(/\s+/g, "-")}.md`;
//
//     return {
//       filename,
//       content,
//     };
//   } catch (error) {
//     logger.warn(`Failed to convert rule ${rule.filename} to subagent:`, error);
//     return null;
//   }
// }
//
// /**
//  * Generate a subagent name from a rule filename
//  */
// function generateSubagentName(filename: string): string {
//   // Remove extension and number prefixes
//   let name = filename.replace(/\.\w+$/, "").replace(/^\d+-/, "");
//
//   // Convert kebab-case or snake_case to Title Case
//   name = name
//     .split(/[-_]/)
//     .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
//     .join(" ");
//
//   // Add "Agent" suffix if not already present
//   if (!name.toLowerCase().includes("agent")) {
//     name = `${name} Agent`;
//   }
//
//   return name;
// }

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

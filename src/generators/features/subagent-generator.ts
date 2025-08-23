import { type ProcessedRule } from "../../types/rules.js";
import { type ParsedSubagent, type SubagentOutput } from "../../types/subagent.js";
import { logger } from "../../utils/logger.js";

/**
 * Generate subagent files from processed rules
 * @param rules Processed rules to convert to subagents
 * @returns Array of subagent outputs
 */
export function generateSubagentsFromRules(rules: ProcessedRule[]): SubagentOutput[] {
  const subagents: SubagentOutput[] = [];

  for (const rule of rules) {
    // Skip rules that are commands (they're handled separately)
    if (rule.type === "command") {
      continue;
    }

    // Generate a subagent for each rule that has a meaningful description
    if (rule.frontmatter.description && rule.frontmatter.description.trim()) {
      const subagent = convertRuleToSubagent(rule);
      if (subagent) {
        subagents.push(subagent);
      }
    }
  }

  logger.info(`Generated ${subagents.length} subagents from rules`);
  return subagents;
}

/**
 * Convert a single rule to a subagent
 */
function convertRuleToSubagent(rule: ProcessedRule): SubagentOutput | null {
  try {
    // Generate subagent name from filename
    const name = generateSubagentName(rule.filename);

    // Build frontmatter
    const frontmatterLines: string[] = ["---"];
    frontmatterLines.push(`name: ${name}`);
    frontmatterLines.push(`description: ${rule.frontmatter.description}`);

    // Add model if it makes sense (could be configured in the future)
    // For now, we'll leave it unspecified to use the default

    frontmatterLines.push("---");

    // Combine frontmatter and content
    const content = `${frontmatterLines.join("\n")}\n\n${rule.content}`;

    // Generate filename (kebab-case version of the name)
    const filename = `${name.toLowerCase().replace(/\s+/g, "-")}.md`;

    return {
      filename,
      content,
    };
  } catch (error) {
    logger.warn(`Failed to convert rule ${rule.filename} to subagent:`, error);
    return null;
  }
}

/**
 * Generate a subagent name from a rule filename
 */
function generateSubagentName(filename: string): string {
  // Remove extension and number prefixes
  let name = filename.replace(/\.\w+$/, "").replace(/^\d+-/, "");

  // Convert kebab-case or snake_case to Title Case
  name = name
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

  // Add "Agent" suffix if not already present
  if (!name.toLowerCase().includes("agent")) {
    name = `${name} Agent`;
  }

  return name;
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

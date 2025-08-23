import type { ProcessedRule } from "../../types/rules.js";
import type { ParsedSubagent, SubagentOutput } from "../../types/subagent.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { logger } from "../../utils/logger.js";
import { BaseSubagentGenerator } from "./base.js";

export class ClaudeCodeSubagentGenerator extends BaseSubagentGenerator {
  getToolName(): ToolTarget {
    return "claudecode";
  }

  getAgentsDirectory(): string {
    return ".claude/agents";
  }

  generateFromRules(_rules: ProcessedRule[]): SubagentOutput[] {
    // NOTE: This function was originally designed to convert regular rules to subagents,
    // but this is not the intended behavior. Subagents should only come from
    // the .rulesync/subagents/ directory. Returning empty array to prevent
    // unintended file generation.
    logger.debug("Skipping rule-to-subagent conversion (deprecated behavior)");
    return [];
  }

  generateFromParsedSubagents(subagents: ParsedSubagent[]): SubagentOutput[] {
    return subagents.map((subagent) => {
      // Build frontmatter
      const frontmatterLines: string[] = ["---"];
      frontmatterLines.push(`name: ${subagent.frontmatter.name}`);
      frontmatterLines.push(`description: ${subagent.frontmatter.description}`);

      // Check for claudecode-specific model configuration
      if (subagent.frontmatter.claudecode?.model) {
        frontmatterLines.push(`model: ${subagent.frontmatter.claudecode.model}`);
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

  processContent(subagent: ParsedSubagent): string {
    // Build frontmatter
    const frontmatterLines: string[] = ["---"];
    frontmatterLines.push(`name: ${subagent.frontmatter.name}`);
    frontmatterLines.push(`description: ${subagent.frontmatter.description}`);

    // Check for claudecode-specific model configuration
    if (subagent.frontmatter.claudecode?.model) {
      frontmatterLines.push(`model: ${subagent.frontmatter.claudecode.model}`);
    }

    frontmatterLines.push("---");

    // Combine frontmatter and content
    return `${frontmatterLines.join("\n")}\n\n${subagent.content}`;
  }
}

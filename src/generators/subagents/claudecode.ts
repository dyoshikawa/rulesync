import type { ProcessedRule } from "../../types/rules.js";
import type { ParsedSubagent, SubagentOutput } from "../../types/subagent.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import {
  formatSubagentsForOutput,
  generateSubagentsFromRules,
} from "../features/subagent-generator.js";
import { BaseSubagentGenerator } from "./base.js";

export class ClaudeCodeSubagentGenerator extends BaseSubagentGenerator {
  getToolName(): ToolTarget {
    return "claudecode";
  }

  getAgentsDirectory(): string {
    return ".claude/agents";
  }

  generateFromRules(rules: ProcessedRule[]): SubagentOutput[] {
    return generateSubagentsFromRules(rules);
  }

  generateFromParsedSubagents(subagents: ParsedSubagent[]): SubagentOutput[] {
    return formatSubagentsForOutput(subagents);
  }

  processContent(subagent: ParsedSubagent): string {
    // Build frontmatter
    const frontmatterLines: string[] = ["---"];
    frontmatterLines.push(`name: ${subagent.frontmatter.name}`);
    frontmatterLines.push(`description: ${subagent.frontmatter.description}`);

    if (subagent.frontmatter.model) {
      frontmatterLines.push(`model: ${subagent.frontmatter.model}`);
    }

    frontmatterLines.push("---");

    // Combine frontmatter and content
    return `${frontmatterLines.join("\n")}\n\n${subagent.content}`;
  }
}

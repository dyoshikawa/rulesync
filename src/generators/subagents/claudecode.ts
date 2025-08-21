import type { ParsedSubagent } from "../../types/subagents.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { BaseSubagentGenerator } from "./base.js";

export class ClaudeCodeSubagentGenerator extends BaseSubagentGenerator {
  getToolName(): ToolTarget {
    return "claudecode";
  }

  getSubagentsDirectory(): string {
    return ".claude/agents";
  }

  processContent(subagent: ParsedSubagent): string {
    const { frontmatter, content } = subagent;

    // Build YAML frontmatter for Claude Code agents
    const yamlParts = ["---"];

    if (frontmatter.description) {
      yamlParts.push(`description: "${frontmatter.description}"`);
    }

    yamlParts.push("---");
    yamlParts.push("");

    // Add the actual content
    yamlParts.push(content.trim());

    return yamlParts.join("\n");
  }
}

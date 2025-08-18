import type { ParsedCommand } from "../../types/commands.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { buildCommandContent } from "../../utils/command-generators.js";
import { BaseCommandGenerator } from "./base.js";

export class ClaudeCodeCommandGenerator extends BaseCommandGenerator {
  getToolName(): ToolTarget {
    return "claudecode";
  }

  getCommandsDirectory(): string {
    return ".claude/commands";
  }

  processContent(command: ParsedCommand): string {
    return buildCommandContent(command);
  }

  // Uses flattened structure by default (supportsHierarchy returns false)
}

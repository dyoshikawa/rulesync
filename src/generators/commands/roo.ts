import type { ParsedCommand } from "../../types/commands.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { buildCommandContent } from "../../utils/command-generators.js";
import { BaseCommandGenerator } from "./base.js";

export class RooCommandGenerator extends BaseCommandGenerator {
  getToolName(): ToolTarget {
    return "roo";
  }

  getCommandsDirectory(): string {
    return ".roo/commands";
  }

  processContent(command: ParsedCommand): string {
    return buildCommandContent(command, { includeDescription: true });
  }

  // Uses flattened structure by default (supportsHierarchy returns false)
}

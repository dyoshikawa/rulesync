import type { RulesyncMcpServer } from "../types/mcp.js";
import type { ToolTarget } from "../types/tool-targets.js";
import { RulesyncTargetsSchema, ToolTargetSchema } from "../types/tool-targets.js";

export function shouldIncludeServer(server: RulesyncMcpServer, targetTool: ToolTarget): boolean {
  // If no targets specified, include in all tools
  if (!server.targets || server.targets.length === 0) {
    return true;
  }

  // Parse and validate targets
  const parsedTargets = RulesyncTargetsSchema.parse(server.targets);

  // Check if it's ["*"]
  if (parsedTargets.length === 1 && parsedTargets[0] === "*") {
    return true;
  }

  // Validate that targetTool is a valid ToolTarget
  const validatedTool = ToolTargetSchema.parse(targetTool);

  // Now check if it's included
  for (const target of parsedTargets) {
    if (target === validatedTool) {
      return true;
    }
  }

  return false;
}

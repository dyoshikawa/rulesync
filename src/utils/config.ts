import type { Config, ToolTarget } from "../types/index.js";
import { ALL_TOOL_TARGETS, ToolTargetsSchema } from "../types/tool-targets.js";

export function getDefaultConfig(): Config {
  return {
    aiRulesDir: ".rulesync",
    outputPaths: {
      augmentcode: ".",
      "augmentcode-legacy": ".",
      copilot: ".github/instructions",
      cursor: ".cursor/rules",
      cline: ".clinerules",
      claudecode: ".",
      roo: ".roo/rules",
      geminicli: ".gemini/memories",
      kiro: ".kiro/steering",
    },
    watchEnabled: false,
    defaultTargets: ALL_TOOL_TARGETS.filter((tool) => tool !== "augmentcode-legacy"),
  };
}

export function resolveTargets(targets: ToolTarget[] | ["*"], config: Config): ToolTarget[] {
  if (targets.length === 1 && targets[0] === "*") {
    return config.defaultTargets;
  }

  // Type guard to ensure targets is ToolTarget[]
  const validatedTargets = ToolTargetsSchema.parse(targets);
  return validatedTargets;
}

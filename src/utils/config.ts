import type { Config, ToolTarget } from "../types/index.js";
import { ToolTargetsSchema } from "../types/tool-targets.js";

export function getDefaultConfig(): Config {
  return {
    aiRulesDir: ".rulesync",
    outputPaths: {
      copilot: ".github/instructions",
      cursor: ".cursor/rules",
      cline: ".clinerules",
      claudecode: ".",
      roo: ".roo/rules",
      geminicli: ".gemini/memories",
    },
    watchEnabled: false,
    defaultTargets: ["copilot", "cursor", "cline", "claudecode", "roo", "geminicli"],
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

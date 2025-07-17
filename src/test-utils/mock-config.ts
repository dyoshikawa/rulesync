import type { Config } from "../types/config.js";
import type { ToolTarget } from "../types/tool-targets.js";

/**
 * Creates a default mock configuration for testing
 */
export function createMockConfig(overrides: Partial<Config> = {}): Config {
  return {
    aiRulesDir: ".rulesync",
    outputPaths: {
      copilot: ".github/instructions",
      cursor: ".cursor/rules",
      cline: ".clinerules",
      claudecode: ".",
      roo: ".roo/rules",
      geminicli: ".gemini/memories",
      kiro: ".kiro/steering",
    },
    watchEnabled: false,
    defaultTargets: ["copilot", "cursor", "cline", "claudecode", "roo", "geminicli", "kiro"],
    ...overrides,
  };
}

/**
 * Creates a mock configuration focused on a specific tool
 */
export function createMockConfigByTool(tool: ToolTarget, overrides: Partial<Config> = {}): Config {
  return createMockConfig({
    defaultTargets: [tool],
    ...overrides,
  });
}

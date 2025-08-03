import type { Config } from "../types/config.js";
import type { ToolTarget } from "../types/tool-targets.js";

/**
 * Creates a default mock configuration for testing
 */
export function createMockConfig(overrides: Partial<Config> = {}): Config {
  return {
    aiRulesDir: ".rulesync",
    outputPaths: {
      augmentcode: ".",
      "augmentcode-legacy": ".",
      copilot: ".github/instructions",
      cursor: ".cursor/rules",
      cline: ".clinerules",
      claudecode: ".",
      codexcli: ".",
      roo: ".roo/rules",
      geminicli: ".gemini/memories",
      kiro: ".kiro/steering",
      junie: ".",
      windsurf: ".",
    },
    watchEnabled: false,
    defaultTargets: [
      "augmentcode",
      "copilot",
      "cursor",
      "cline",
      "claudecode",
      "codexcli",
      "roo",
      "geminicli",
      "kiro",
      "junie",
      "windsurf",
    ],
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

import type { Config } from "../types/config.js";
import type { ToolTarget } from "../types/tool-targets.js";

/**
 * Standard output paths used in tests - matches the common pattern used across ignore generator tests
 */
const STANDARD_TEST_OUTPUT_PATHS = {
  amazonqcli: "./.amazonq/rules",
  augmentcode: "./.augment/rules",
  "augmentcode-legacy": "./.augment-guidelines",
  copilot: "./.github/copilot-instructions.md",
  cursor: "./.cursor/rules",
  cline: "./.clinerules",
  claudecode: "./CLAUDE.md",
  codexcli: "./AGENTS.md",
  opencode: "./AGENTS.md",
  qwencode: "./.qwen/memories",
  roo: "./.roo/rules",
  geminicli: "./GEMINI.md",
  kiro: "./.kiro/steering",
  junie: "./.junie/guidelines.md",
  windsurf: "./.windsurf/rules",
} as const;

/**
 * Creates a default mock configuration for testing
 */
export function createMockConfig(overrides: Partial<Config> = {}): Config {
  return {
    aiRulesDir: ".rulesync",
    outputPaths: {
      amazonqcli: ".amazonq/rules",
      augmentcode: ".",
      "augmentcode-legacy": ".",
      copilot: ".github/instructions",
      cursor: ".cursor/rules",
      cline: ".clinerules",
      claudecode: ".",
      codexcli: ".",
      opencode: ".",
      qwencode: ".qwen/memories",
      roo: ".roo/rules",
      geminicli: ".gemini/memories",
      kiro: ".kiro/steering",
      junie: ".",
      windsurf: ".",
    },
    watchEnabled: false,
    defaultTargets: [
      "amazonqcli",
      "augmentcode",
      "copilot",
      "cursor",
      "cline",
      "claudecode",
      "codexcli",
      "opencode",
      "qwencode",
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

/**
 * Creates a mock configuration with standard test output paths
 * This is commonly used in ignore generator tests
 */
export function createMockConfigWithStandardPaths(
  tool: ToolTarget,
  overrides: Partial<Config> = {},
): Config {
  return createMockConfigByTool(tool, {
    outputPaths: STANDARD_TEST_OUTPUT_PATHS,
    ...overrides,
  });
}

import { type KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["src/cli/index.ts", "src/index.ts", "src/**/*.test.ts", "src/**/*.test-d.ts"],
  project: ["src/**/*.ts"],
  ignore: [
    // Build output and node_modules
    "dist/**",
    "node_modules/**",
    // Temporary files during testing
    "**/test-temp/**",
    // Configuration files
    "tsconfig.json",
    "vitest.config.ts",
    "eslint.config.js",
    ".oxfmtrc.json",
    ".rulesync/**",
    "docs/**",
  ],
  ignoreDependencies: [
    // Dependencies used only in configuration files
    "@secretlint/secretlint-rule-preset-recommend",
    // For MCP development
    "o3-search-mcp",
    // Used only in TypeScript configuration
    "typescript",
    "@types/node",
    "@types/js-yaml",
    "@types/micromatch",
    // lint-staged is used in git hooks
    "lint-staged",
    // Used in docs site
    "vitepress",
  ],
  typescript: {
    config: "tsconfig.json",
  },
  includeEntryExports: true,
};

export default config;

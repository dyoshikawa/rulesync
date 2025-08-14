import { type KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["src/cli/index.ts", "src/**/*.test.ts", "src/**/*.test-d.ts"],
  project: ["src/**/*.ts"],
  ignore: [
    // ビルド出力とnode_modules
    "dist/**",
    "node_modules/**",
    // テスト時の一時ファイル
    "**/test-temp/**",
    // 設定ファイル
    "tsconfig.json",
    "vitest.config.ts",
    "eslint.config.js",
    "biome.json",
    ".rulesync/**",
  ],
  ignoreDependencies: [
    // 設定ファイルでのみ使用される依存関係
    "@secretlint/secretlint-rule-preset-recommend",
    // MCP開発用
    "o3-search-mcp",
    // TypeScript設定のみで使用されるもの
    "typescript",
    "@types/node",
    "@types/js-yaml",
    "@types/micromatch",
    // lint-staged is used in git hooks
    "lint-staged",
  ],
  typescript: {
    config: "tsconfig.json",
  },
  includeEntryExports: true,
};

export default config;

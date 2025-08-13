import { type KnipConfig } from "knip";

const config: KnipConfig = {
  entry: [
    // メインのCLIエントリーポイント
    "src/cli/index.ts",
    // テストファイル
    "src/**/*.test.ts",
    "src/**/*.test-d.ts",
  ],
  project: [
    // TypeScriptファイルを対象にする
    "src/**/*.ts",
  ],
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
  ],
  typescript: {
    // TypeScript設定ファイルのパス
    config: "tsconfig.json",
  },
  // 未使用の exports を検出
  includeEntryExports: true,
};

export default config;

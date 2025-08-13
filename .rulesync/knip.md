---
description: "Knip - JavaScriptとTypeScriptプロジェクトの不要コード分析ツール"
target: ["*"]
globs: []
---

# Knip - Dead Code Elimination Tool

Knipは、JavaScript / TypeScriptプロジェクトの不要なファイル、依存関係、エクスポートを検出・削除するツールです。

## Knipの主な機能

### 検出対象
- **未使用ファイル**: どこからもインポートまたは参照されていないファイル
- **未使用依存関係**: npm dependencies/devDependenciesの未使用、未定義、未解決の依存関係
- **未使用エクスポート**: 名前付き/デフォルトエクスポート、型、列挙型とクラスメンバー、名前空間エクスポート、重複

### 自動修正機能
- `--fix`オプションで未使用のエクスポート、列挙型/クラスメンバー、ファイルを削除
- package.jsonの依存関係を自動的にプルーニング
- `--format`でPrettier/Biome/dprint経由のフォーマット適用

## rulesyncプロジェクトでの導入 ✅ 完了

### 1. インストール ✅
```bash
pnpm add -D knip
```

### 2. 設定ファイル (knip.ts) ✅
```typescript
import { type KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    // メインのCLIエントリーポイント
    'src/cli/index.ts',
    // テストファイル
    'src/**/*.test.ts',
    'src/**/*.test-d.ts',
  ],
  project: [
    // TypeScriptファイルを対象にする
    'src/**/*.ts',
  ],
  ignore: [
    // ビルド出力とnode_modules
    'dist/**',
    'node_modules/**',
    // テスト時の一時ファイル
    '**/test-temp/**',
    // 設定ファイル
    'tsconfig.json',
    'vitest.config.ts',
    'eslint.config.js',
    'biome.json',
    '.rulesync/**',
  ],
  ignoreDependencies: [
    // 設定ファイルでのみ使用される依存関係
    '@secretlint/secretlint-rule-preset-recommend',
    // MCP開発用
    'o3-search-mcp',
    // TypeScript設定のみで使用されるもの
    'typescript',
    '@types/node',
    '@types/js-yaml',
    '@types/micromatch',
  ],
  typescript: {
    // TypeScript設定ファイルのパス
    config: 'tsconfig.json',
  },
  // 未使用の exports を検出
  includeEntryExports: true,
};

export default config;
```

### 3. package.jsonスクリプト追加 ✅
```json
{
  "scripts": {
    "knip": "knip",
    "knip:production": "knip --production"
  }
}
```

## 実行パターン

### ローカル実行 ✅
```bash
# 全体スキャン
pnpm knip

# プロダクションモード（テストとdevDepsを無視）
pnpm knip:production

# 現在検出される項目:
# - 未使用ファイル: src/generators/ignore/index.ts
# - 未使用依存関係: marked
# - 未使用exports: 22個
# - 未使用型定義: 36個
```

### CI/CDでの活用
```yaml
# .github/workflows/knip.yml
name: Code Quality
on: [push, pull_request]

jobs:
  knip:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run knip
```

## rulesyncプロジェクトでの想定される効果

### 検出可能な問題
1. **未使用ジェネレーター**: 使われていないAIツール用ジェネレーターの検出
2. **未使用パーサー**: 不要なインポートパーサーの発見
3. **未使用ユーティリティ**: src/utilsの未使用関数
4. **未使用型定義**: src/typesの不要な型定義
5. **未使用依存関係**: package.jsonの整理

### ファイル構造への適用
```typescript
// rulesyncプロジェクト構造を考慮した設定
{
  "entry": [
    "src/cli/index.ts",
    "src/generators/*/index.ts"
  ],
  "project": [
    "src/**/*.ts",
    "!src/**/*.test.ts",
    "scripts/**/*.ts"
  ],
  "workspaces": {
    ".": {
      "entry": ["src/cli/index.ts"],
      "project": ["src/**/*.ts"]
    }
  }
}
```

## ベストプラクティス

### 段階的導入
1. **初回実行**: まず`knip`でレポート確認
2. **false positiveの除外**: `ignore*`ルールで意図的な使用を除外
3. **自動修正**: `--fix`で段階的に問題を修正
4. **CI統合**: PRでコードの清潔さを維持

### rulesyncプロジェクト向けの注意点
- **動的インポート**: ジェネレーターの動的ロードは`ignoreDependencies`で除外
- **テンプレート文字列**: 設定ファイル名の動的生成は手動でignore
- **型のみインポート**: TypeScriptの`import type`は適切に処理される

## 制限事項
1. 純粋に動的な`require()`、テンプレート文字列での`import()`は検出漏れの可能性
2. クラスメンバーの自動削除は実験的機能
3. 一部のエコシステム（例：Angular + SCSS）では手動でignoreルールが必要

Knipを導入することで、rulesyncプロジェクトのコードベースを継続的に清潔に保ち、ビルド時間の短縮とメンテナンス性の向上が期待できます。
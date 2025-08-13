# rulesyncへの貢献

rulesyncへの貢献を歓迎します！このドキュメントでは、貢献のプロセスと始め方について説明します。

[English](./CONTRIBUTING.md) | **日本語**

## 始める

1. リポジトリをフォーク
2. フォークをクローン: `git clone https://github.com/your-username/rulesync.git`
3. 依存関係をインストール: `pnpm install`
4. gitフックをセットアップ: `npx simple-git-hooks`
5. 新しいブランチを作成: `git checkout -b feature/your-feature-name`

## 開発環境の設定

### 前提条件

- Node.js 20+（推奨: 24+）
- pnpm（推奨）またはnpm/yarn

### MCP接続設定

Claude CodeをMCP（Model Context Protocol）で使用する場合は、以下の環境変数を設定してください：

- `OPENAI_API_KEY` - OpenAI連携に必要
- `GITHUB_PERSONAL_ACCESS_TOKEN` - GitHub MCPサーバー機能に必要

### 開発コマンド

```bash
# 依存関係をインストール
pnpm install

# ホットリロードで開発モードで実行
pnpm dev

# プロジェクトをビルド
pnpm build

# テストを実行
pnpm test

# ウォッチモードでテストを実行
pnpm test:watch

# カバレッジ付きでテストを実行
pnpm test:coverage

# コードをリント
pnpm lint

# コードをフォーマット
pnpm format

# フォーマットをチェック
pnpm format:check

# 包括的チェック（Biome + Oxlint + ESLint + TypeScript）
pnpm check

# リントとフォーマット問題を修正
pnpm fix

# シークレットをチェック
pnpm secretlint

# スペルチェック
pnpm cspell

# 型チェック
pnpm typecheck
```

## プロジェクトアーキテクチャ

### レジストリパターンアーキテクチャ

プロジェクトは保守性とコード再利用性を向上させるためにレジストリパターンアーキテクチャを実装しています:

**共有ファクトリーパターン**:
- **Ignore共有ファクトリー**: 統一されたignoreファイル生成パターン
- **MCP共有ファクトリー**: 標準化されたMCP設定生成
- **レジストリベース設計**: 各AIツールの設定パターンを中央管理

**主要な改善点 (v0.56.0)**:
- **オプションフロントマター**: 全フロントマターフィールドが適切なデフォルト値付きでオプションに
- **レジストリパターン**: 新ツール追加を容易にする統一ジェネレーターアーキテクチャ
- **関心事の分離**: ジェネレーター、パーサー、共有ファクトリーの明確な分離
- **コード重複の削減**: 共通パターンの共有ファクトリーによる統一
- **型安全性の向上**: Zodスキーマと適切な型ガードの実装
- **包括的テストカバレッジ**: 全モジュールで1,500+行のテストコード

### .rulesyncディレクトリ構造

```
.rulesync/
├── overview.md              # プロジェクト概要とアーキテクチャ (root: true)
├── my-instructions.md       # カスタムプロジェクト指示
├── precautions.md          # 開発上の注意事項とガイドライン
└── specification-[tool]-[type].md  # ツール固有の仕様
    # タイプ: rules, mcp, ignore
    # ツール: augmentcode, copilot, cursor, cline, claudecode, 
    #        codexcli, geminicli, junie, kiro, roo, windsurf
```

**注**: 新しいWindsurf AIコードエディターサポートが追加され、全体で11のAIツールをサポートしています。

### コア構造

```
rulesync/
├── src/
│   ├── cli/
│   │   ├── commands/        # CLIコマンドの実装
│   │   │   ├── init.ts      # プロジェクト初期化
│   │   │   ├── add.ts       # 新しいルールファイルの追加
│   │   │   ├── generate.ts  # 設定生成
│   │   │   ├── import.ts    # 既存設定のインポート
│   │   │   ├── watch.ts     # ファイル監視
│   │   │   ├── status.ts    # プロジェクト状態
│   │   │   ├── validate.ts  # ルール検証
│   │   │   ├── gitignore.ts # .gitignore管理
│   │   │   └── config.ts    # 設定管理
│   │   └── index.ts        # CLIエントリーポイント (Commander.js)
│   ├── core/
│   │   ├── parser.ts       # .rulesync/*.mdファイルのパース
│   │   ├── generator.ts    # レジストリパターンベースの生成オーケストレーション
│   │   ├── importer.ts     # 既存設定のインポート
│   │   ├── validator.ts    # ルール構造の検証
│   │   ├── mcp-generator.ts # MCP固有の生成ロジック
│   │   ├── mcp-parser.ts   # MCP固有のパースロジック
│   │   ├── command-generator.ts # ⭐ 新機能: カスタムコマンド生成オーケストレーション
│   │   └── command-parser.ts    # ⭐ 新機能: ルールからのコマンド定義パース
│   ├── generators/         # ツール固有のジェネレーター（出力タイプ別に整理）
│   │   ├── rules/          # 標準ルールジェネレーター
│   │   │   ├── augmentcode.ts  # AugmentCode Rules
│   │   │   ├── copilot.ts     # GitHub Copilot Custom Instructions
│   │   │   ├── cursor.ts      # Cursor Project Rules (MDCフォーマット)
│   │   │   ├── cline.ts       # Cline Rules
│   │   │   ├── claudecode.ts  # Claude Code Memory (CLAUDE.md + memories)
│   │   │   ├── codexcli.ts    # OpenAI Codex CLI Rules (codex.md階層)
│   │   │   ├── geminicli.ts   # Gemini CLI設定 (GEMINI.md + memories)
│   │   │   ├── junie.ts       # JetBrains Junie Guidelines
│   │   │   ├── kiro.ts        # Kiro IDE Custom Steering Documents
│   │   │   ├── roo.ts         # Roo Code Rules
│   │   │   ├── windsurf.ts    # 新しいWindsurf AIコードエディター
│   │   │   └── shared-helpers.ts # 共通ヘルパー関数とパターン
│   │   ├── mcp/            # MCP設定ジェネレーター
│   │   │   ├── shared-factory.ts # 統一されたMCP設定生成ファクトリー
│   │   │   └── [tool].ts   # 各ツール用のMCP固有設定
│   │   ├── ignore/         # Ignoreファイルジェネレーター
│   │       ├── shared-factory.ts # 統一されたignore設定生成ファクトリー
│   │       ├── shared-helpers.ts # 共通ignoreパターンヘルパー
│   │       └── [tool].ts   # ツール固有のignore設定
│   │   └── commands/       # ⭐ 新機能: カスタムコマンドジェネレーター
│   │       ├── claudecode.ts    # Claude Codeコマンド生成
│   │       └── geminicli.ts     # Gemini CLIコマンド生成
│   ├── parsers/           # インポート機能用ツール固有パーサー
│   │   ├── augmentcode.ts # AugmentCode設定のパース
│   │   ├── copilot.ts     # GitHub Copilot設定のパース (.github/copilot-instructions.md)
│   │   ├── cursor.ts      # Cursor設定のパース (.cursorrules, .cursor/rules/*.mdc)
│   │   │                  # 4つのルールタイプをサポート: always, manual, specificFiles, intelligently
│   │   ├── cline.ts       # Cline設定のパース (.cline/instructions.md)
│   │   ├── claudecode.ts  # Claude Code設定のパース (CLAUDE.md, .claude/memories/*.md)
│   │   ├── codexcli.ts    # OpenAI Codex CLI設定のパース (codex.md階層)
│   │   ├── geminicli.ts   # Gemini CLI設定のパース (GEMINI.md, .gemini/memories/*.md)
│   │   ├── junie.ts       # JetBrains Junie設定のパース
│   │   ├── kiro.ts        # Kiro IDE設定のパース
│   │   ├── roo.ts         # Roo Code設定のパース (.roo/instructions.md)
│   │   └── windsurf.ts    # 新しいWindsurf設定のパース
│   ├── types/              # TypeScript型定義
│   │   ├── config.ts      # 設定型
│   │   ├── rules.ts       # ルールとフロントマター型
│   │   ├── mcp.ts         # MCP固有型
│   │   ├── mcp-config.ts  # 共有MCP設定インターフェース
│   │   ├── commands.ts    # ⭐ 新機能: カスタムコマンド型とインターフェース
│   │   ├── tool-targets.ts # ツールターゲット定義
│   │   └── config-options.ts # 設定オプション型
│   └── utils/
│       ├── file.ts         # ファイル操作 (read/write/delete)
│       ├── config.ts       # 設定管理
│       ├── config-loader.ts # 設定読み込みユーティリティ
│       ├── ignore.ts       # ignoreファイルユーティリティ
│       ├── rules.ts        # ルール処理ユーティリティ
│       ├── mcp-helpers.ts  # MCP設定処理ヘルパー
│       └── parser-helpers.ts # パーサーユーティリティ関数
├── dist/                   # ビルド出力 (CJS + ESM)
└── [module].test.ts        # テストファイル（ソースと同じ場所に配置）
```

### フロントマタースキーマの変更 (v0.56.0)

**重要な変更**: 全フロントマターフィールドが自動デフォルト値付きでオプションになりました：

```typescript
// v0.56.0以前（必須フィールド）
export const RuleFrontmatterSchema = z.object({
  root: z.boolean(),                    // 必須
  targets: RulesyncTargetsSchema,       // 必須
  description: z.string(),              // 必須
  globs: z.array(z.string()),          // 必須
});

// v0.56.0以降（デフォルト値付きオプション）
export const RuleFrontmatterSchema = z.object({
  root: z.optional(z.boolean()),        // デフォルト: false
  targets: z.optional(RulesyncTargetsSchema), // デフォルト: ["*"]
  description: z.optional(z.string()),  // デフォルト: ファイル名から生成
  globs: z.optional(z.array(z.string())), // デフォルト: ["**/*"]
  // 新しいオプションフィールド:
  windsurfActivationMode: z.optional(z.enum(["always", "manual", "model-decision", "glob"])),
  windsurfOutputFormat: z.optional(z.enum(["single-file", "directory"])),
  tags: z.optional(z.array(z.string())),
});
```

**開発への影響**:
- ルールファイルが最小限またはフロントマターなしでも作成可能
- パース段階でデフォルト値が自動適用
- 既存ルールファイルとの後方互換性を維持
- 明確なエラーメッセージによる強化された検証

### カスタムコマンド生成アーキテクチャ (新機能)

プロジェクトは**カスタムコマンド生成システム**を導入しました。これにより、AIツールはルールファイルで定義されたカスタムコマンドを登録・実行できるようになります。この機能は現在、コマンド実行機能を持つツールでサポートされています：

#### コアコンポーネント

1. **CommandParser (`src/core/command-parser.ts`)**
   - ルールフロントマターからコマンド定義を抽出
   - コマンド構文と構造の検証
   - インラインコマンドとコマンドブロックのサポート
   - フロントマター例:
     ```yaml
     commands:
       - name: "test"
         description: "テストを実行"
         content: "npm test"
       - name: "build"
         description: "プロジェクトをビルド"
         content: |
           npm run clean
           npm run compile
           npm run bundle
     ```

2. **CommandGenerator (`src/core/command-generator.ts`)**
   - サポートされているツール全体でのコマンド生成をオーケストレーション
   - 適切なツール固有ジェネレーターへのルーティング
   - コマンドファイルの作成とフォーマット処理
   - コマンドの登録と重複排除の管理

3. **ツール固有コマンドジェネレーター (`src/generators/commands/`)**
   - **claudecode.ts**: Claude Code用のメモリファイル生成
   - **geminicli.ts**: Gemini CLI用のメモリファイル生成

#### コマンド定義フォーマット

コマンドはルールフロントマターで以下の構造を使用して定義されます:

```typescript
interface CommandDefinition {
  name: string;        // コマンド識別子
  description: string; // 人間が読める説明
  content: string;     // コマンドスクリプト（単一行または複数行）
}
```

#### ジェネレーターパターン

各ツールのコマンドジェネレーターは以下のパターンに従います:

```typescript
export async function generateToolCommands(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string
): Promise<GeneratedOutput[]> {
  // 1. ルールからコマンドを抽出
  const commands = CommandParser.extractCommands(rules);
  
  // 2. 特定のツール用にコマンドをフォーマット
  const formattedCommands = formatCommandsForTool(commands);
  
  // 3. 出力ファイルを生成
  return [{
    path: getCommandFilePath(config, baseDir),
    content: formattedCommands
  }];
}
```

### 主要な依存関係

- **Commander.js**: コマンドラインインターフェース用のCLIフレームワーク
- **gray-matter**: Markdownファイルのフロントマターパーシング（YAML、TOML、JSON対応）
- **marked**: Markdownのパーシングとレンダリング
- **chokidar**: 高性能な`watch`コマンド用のファイル監視
- **c12**: 複数フォーマットサポートの設定読み込み
- **micromatch**: ファイルフィルタリング用のglobパターンマッチング
- **zod**: ランタイム型検証とスキーマ定義
- **js-yaml**: YAMLパーシングと文字列化
- **tsup**: ビルドシステム（CJSとESMの両方を出力）
- **tsx**: 開発用TypeScript実行
- **Biome**: 統合リンターとフォーマッター（メイン）
- **ESLint**: カスタムプラグインによる追加リンティング
- **Oxlint**: 追加チェック用の高速Rustベースリンター
- **Vitest**: カバレッジ付きテストフレームワーク
- **cspell**: コードとドキュメント用のスペルチェッカー

### ビルドシステム

- **ターゲット**: Node.js 20+（推奨: 24+）
- **TypeScript**: `@tsconfig/node24`を使用した厳密モード
- **出力**: CommonJS（`dist/index.js`）とESM（`dist/index.mjs`）の両方
- **バイナリ**: `dist/index.js`（実行可能エントリーポイント）
- **型**: ビルド出力に含まれる

## 貢献方法

### 問題の報告

1. 重複を避けるため既存のissueを確認
2. 利用可能な場合はissueテンプレートを使用
3. 以下を含める:
   - 問題の明確な説明
   - 再現手順
   - 期待される動作 vs 実際の動作
   - 環境（Node.jsバージョン、OS等）

### 機能リクエスト

1. 類似のリクエストがないか既存のissueを検索
2. 機能とその使用例を説明
3. 設計提案やモックアップの提供を検討

### プルリクエスト

1. **大きな機能の作業を開始する前に、まずissueを開いて議論してください**
2. 変更がテストでカバーされていることを確認
3. 既存のコードスタイルに従う（Biomeによって強制）
4. 明確なコミットメッセージを書く
5. 必要に応じてドキュメントを更新

#### プルリクエストプロセス

1. フォークして機能ブランチを作成
2. コードとテストを書く
3. 完全なテストスイートを実行: `pnpm test`
4. コード品質チェックを実行: `pnpm check`
5. シークレットをチェック: `pnpm secretlint`
6. スペルチェック: `pnpm cspell`
7. gitフックをセットアップ: `npx simple-git-hooks` (初回のみ)
7. 明確なメッセージで変更をコミット
8. フォークにプッシュしてプルリクエストを作成

#### コミットメッセージフォーマット

conventional commit メッセージを使用します:

```
type(scope): description

[optional body]

[optional footer]
```

タイプ:
- `feat`: 新機能
- `fix`: バグ修正
- `docs`: ドキュメント変更
- `style`: コードスタイル変更（フォーマット等）
- `refactor`: コードリファクタリング
- `test`: テストの追加または更新
- `chore`: メンテナンスタスク

例:
- `feat(generators): 新しいAIツールのサポートを追加`
- `fix(parser): 不足しているフロントマターを適切に処理`
- `docs(readme): インストール手順を更新`

## コードスタイル

包括的なコード品質のために複数のリンティングツールを使用しています:

**メインツール:**
- **[Biome](https://biomejs.dev/)**: メインリンターとフォーマッター
- **[Oxlint](https://oxc.rs/)**: 追加チェック用の高速Rustベースリンター
- **ESLint**: カスタムプラグインによる追加リンティング (zod-import, no-type-assertion)

**コードスタイル:**
- インデントは2スペース
- セミコロン必須
- 文字列は二重引用符
- 複数行オブジェクト/配列で末尾カンマ

スタイルはCIパイプラインとpre-commitフックによって自動的に強制されます。

## テスト

プロジェクトは包括的なカバレッジでVitestを使用してテストしています:

### テスト構造

- **単体テスト**: 個々の関数のテスト
- **統合テスト**: コマンドとジェネレーターのテスト
- **モック**: Vitestの組み込みモック機能を使用
- **カバレッジ目標**: 80%+

### テストの書き方

- 新機能とバグ修正のテストを書く
- 説明的なテスト名を使用
- 成功とエラーの両方のケースをテスト
- テストを集中的かつ独立に保つ
- パターンに従う: `src/module.ts` → `src/module.test.ts`

### テストの実行

```bash
# すべてのテスト
pnpm test

# 開発用ウォッチモード
pnpm test:watch

# カバレッジレポートを生成
pnpm test:coverage

# 特定のテストファイルを実行
pnpm test src/generators/copilot.test.ts

# 特定機能のテストを実行
pnpm test src/cli/commands/import.test.ts  # インポート機能のテスト
pnpm test src/parsers/                     # すべてのパーサーのテスト

# コマンド生成のテスト
pnpm test src/core/command-parser          # コマンドパース
pnpm test src/core/command-generator       # コマンド生成オーケストレーション
pnpm test src/generators/commands/         # すべてのコマンドジェネレーター

# 特定ツールのコマンド生成テスト
pnpm test src/generators/commands/claudecode
pnpm test src/generators/commands/geminicli
```

### モジュール別テストカバレッジ

- **cli/commands**: 優秀なカバレッジ
- **core**: 高カバレッジを達成（command-parser、command-generatorを含む）
- **generators/rules**: すべてのツールで高カバレッジ
- **generators/mcp**: すべてのMCP設定で高カバレッジ
- **generators/ignore**: セキュリティパターンで高カバレッジ
- **generators/commands**: コマンド生成で高カバレッジ（Claude Code、Gemini CLI）
- **parsers**: すべてのパーサーで良好なカバレッジ
- **utils**: すべてのモジュールで高カバレッジ
- **types**: 型定義ファイルのため測定対象外

### 最近の主要改善

**新しいAIツール統合**:
- **Windsurf AIコードエディター**: 完全サポート（ジェネレーター、パーサー、MCP、ignoreファイル）
- **包括的テストカバレッジ**: 新ツール向けの包括的テストスイート実装

**カスタムコマンド生成システム** (新機能):
- **コマンドパーサー**: ルールフロントマターからのコマンド定義抽出
- **コマンドジェネレーター**: ツール固有のコマンドファイル生成
- **サポートツール**: Claude Code、Gemini CLI用のメモリファイル生成
- **拡張可能アーキテクチャ**: 新ツールへのコマンドサポート追加が容易

**アーキテクチャリファクタリング**:
- **レジストリパターン実装**: 中央集権的なツール設定管理システム
- **共有ファクトリーパターン**: 統一されたMCPおよびignoreファイル生成
- **関心事の分離**: ジェネレーター、パーサー、共有ロジックの明確な分離
- **コード重複削減**: 共通パターンの統合により保守性が大幅向上

**強化された開発体験**:
- **型安全性向上**: Zodスキーマと適切な型ガードの実装
- **包括的テスト**: 全モジュールで1,500+行のテストコード（250-350行/ファイル）
- **開発ツール強化**: Biome + ESLint + Oxlintによる多層品質チェック
- **改善された組織化**: rules/、mcp/、ignore/、commands/サブディレクトリによる明確な構造

**高度なMCP統合**:
- **マルチトランスポート**: stdio、SSE、HTTPの完全サポート
- **ラッパーサーバーパターン**: サードパーティ統合のための標準化されたアプローチ
- **環境変数処理**: セキュアな設定管理とAPIキー処理
- **レジストリベース生成**: 統一されたMCP設定パターン

**品質とセキュリティ**:
- **階層ルールシステム**: マルチレベルルール優先順位システム
- **改善された検証**: 堅牢なルール構造とフロントマター検証
- **シリアル実行**: 安定性向上のための順次処理実装

## 新しいAIツールの追加

新しいAIツールのサポートを追加するには（最近追加された`windsurf`とレジストリパターンアーキテクチャを参考として）:

### 1. ジェネレーターの実装

**レジストリパターンの活用**:
- 可能な場合は既存の共有ファクトリーを使用
- 共通パターンは共有ヘルパーを拡張
- 特殊なロジックが必要な場合のみカスタムジェネレーター実装

**ファイル作成**:
```bash
# 標準ルールジェネレーター
src/generators/rules/newtool.ts

# MCP設定（該当する場合）
src/generators/mcp/newtool.ts
# または共有ファクトリーをレジストリに追加

# Ignoreファイル（該当する場合）
src/generators/ignore/newtool.ts
# または共有ファクトリー設定を追加
```

### 2. 共有ファクトリーパターンの活用

**MCP共有ファクトリー使用例**:
```typescript
// src/generators/mcp/newtool.ts
import { generateMcpFromRegistry, MCP_GENERATOR_REGISTRY } from "./shared-factory.js";

// レジストリに設定を追加
MCP_GENERATOR_REGISTRY.newtool = {
  target: "newtool",
  configPaths: ["newtool/mcp-config.json"],
  serverTransform: serverTransforms.extended,
  configWrapper: configWrappers.mcpServers,
};
```

**Ignore共有ファクトリー使用例**:
```typescript
// src/generators/ignore/shared-factory.ts内
export const ignoreConfigs = {
  // ... 既存の設定
  newtool: {
    tool: "newtool" as const,
    filename: ".newtoolignore",
    header: ["# Generated by rulesync - NewTool ignore file"],
    corePatterns: ["# ツール固有パターン"],
    includeCommonPatterns: true,
  } satisfies IgnoreFileConfig,
};
```

### 3. 包括的テストの実装

**テストガイドライン**（Windsurfテストを参考）:
```typescript
// テストファイル例: src/generators/rules/newtool.test.ts
- 基本設定生成テスト
- フロントマター処理テスト 
- 複数ルール処理テスト
- エラーハンドリングテスト
- 目標: 250-350行の包括的カバレッジ
```

### 4. 実装チェックリスト

- [ ] **ジェネレーター実装**: 適切な共有パターン使用
- [ ] **パーサー作成**: `src/parsers/newtool.ts`でインポート機能
- [ ] **コア統合**: `generator.ts`と`importer.ts`を更新
- [ ] **CLI統合**: `src/cli/index.ts`にオプション追加
- [ ] **型定義**: `tool-targets.ts`の`ALL_TOOL_TARGETS`に追加
- [ ] **設定パス**: `src/utils/config.ts`で出力パス定義
- [ ] **コマンドサポート**: ツールがコマンド実行をサポートする場合、コマンドジェネレーターを追加
- [ ] **包括的テスト**: 全機能の徹底的テストカバレッジ（コマンド生成テストを含む）
- [ ] **レジストリ統合**: 該当する場合は共有ファクトリーレジストリに追加
- [ ] **ドキュメント更新**: README.mdとREADME.ja.md
- [ ] **仕様書作成**: `.rulesync/specification-[tool]-*.md`

### 5. 新しいツールへのコマンドサポート追加

ツールがカスタムコマンド実行をサポートする場合:

1. **ツール機能の確認**: ツールがカスタムコマンド実行をサポートしているか確認
2. **コマンドジェネレーター作成**: `src/generators/commands/newtool.ts`を追加
3. **出力フォーマット定義**: ツールが期待するコマンドフォーマットを決定
4. **CommandGeneratorへの登録**: `command-generator.ts`のツールスイッチに追加
5. **型の追加**: 必要に応じて`src/types/commands.ts`を更新
6. **包括的テスト作成**: 新しいジェネレーターのテストを作成
7. **ドキュメント更新**: ツール仕様書にコマンドフォーマットを記載

実装例:
```typescript
// src/generators/commands/newtool.ts
export async function generateNewToolCommands(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string
): Promise<GeneratedOutput[]> {
  const commands = CommandParser.extractCommands(rules);
  
  if (commands.length === 0) {
    return [];
  }
  
  const content = formatNewToolCommands(commands);
  const outputPath = join(
    baseDir ?? config.outputDirectory ?? process.cwd(),
    ".newtool",
    "commands.json"
  );
  
  return [{
    path: outputPath,
    content: JSON.stringify(content, null, 2)
  }];
}
```

#### コマンド生成のテスト

```typescript
// コマンド抽出のテスト
it("should extract commands from rule frontmatter", async () => {
  const commands = CommandParser.extractCommands(rules);
  expect(commands).toHaveLength(3);
  expect(commands[0]).toHaveProperty("name");
  expect(commands[0]).toHaveProperty("description");
  expect(commands[0]).toHaveProperty("content");
});

// 複数行コマンドの処理テスト
it("should handle multi-line command scripts", async () => { /* ... */ });

// コマンド重複排除のテスト
it("should deduplicate commands with same name", async () => { /* ... */ });

// ツール固有フォーマットのテスト
it("should format commands for tool-specific format", async () => { /* ... */ });
```

### 6. アーキテクチャパターンに従った実装

**保守性重視**:
- 共通ロジックは共有ヘルパーに移動
- 重複コードを避け、既存パターンを再利用
- 明確な関心事の分離を維持

**型安全性確保**:
- 適切な型定義とZodスキーマ
- コンパイル時エラー検出
- ランタイム検証実装

### レジストリパターンベースの実装パターン

**共有ファクトリーを使用したMCPジェネレーター**:
```typescript
// src/generators/mcp/newtool.ts
import { generateMcpConfigurationFilesFromRegistry } from "./shared-factory.js";
import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";

export async function generateNewToolMcpConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  // MCP設定を抽出
  const mcpServers = extractMcpServersFromRules(rules);
  if (Object.keys(mcpServers).length === 0) {
    return [];
  }

  // 共有ファクトリーを使用して設定ファイルを生成
  const configFiles = generateMcpConfigurationFilesFromRegistry(
    "newtool",
    mcpServers,
    baseDir || "",
  );

  return configFiles.map(({ filepath, content }) => ({
    tool: "newtool",
    filepath,
    content,
  }));
}
```

**共有ファクトリーを使用したIgnoreジェネレーター**:
```typescript
// src/generators/ignore/newtool.ts
import { generateIgnoreFile, ignoreConfigs } from "./shared-factory.js";
import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";

export function generateNewToolIgnoreFiles(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): GeneratedOutput[] {
  // 事前設定されたignore設定を使用
  return generateIgnoreFile(rules, config, ignoreConfigs.newtool, baseDir);
}
```

**標準ルールジェネレーターパターン**:
```typescript
// src/generators/rules/newtool.ts
import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { createOutputsArray } from "./shared-helpers.js";

export async function generateNewToolConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const outputs = createOutputsArray();
  const outputPath = baseDir || process.cwd();

  for (const rule of rules) {
    const content = generateNewToolMarkdown(rule);
    const filepath = join(outputPath, config.outputPaths.newtool, `${rule.filename}.md`);
    
    outputs.push({
      tool: "newtool",
      filepath,
      content,
    });
  }

  return outputs;
}
```

### パーサーインターフェースパターン

```typescript
export async function parseNewToolConfiguration(
  baseDir: string = process.cwd()
): Promise<{ rules: ParsedRule[]; errors: string[] }> {
  const rules: ParsedRule[] = [];
  const errors: string[] = [];
  
  try {
    // 設定ファイルを検索
    const configFiles = await findNewToolConfigFiles(baseDir);
    
    if (configFiles.length === 0) {
      errors.push("NewTool設定ファイルが見つかりません");
      return { rules, errors };
    }
    
    // 各設定ファイルをパース（包括的エラーハンドリング付き）
    for (const configFile of configFiles) {
      try {
        const content = await readFile(configFile, "utf-8");
        const parsed = await parseNewToolFormat(content);
        
        // フロントマター検証
        const validatedRule = validateRuleFrontmatter(parsed);
        
        rules.push({
          ...validatedRule,
          filename: generateUniqueFilename("newtool", parsed),
          filepath: configFile,
        });
      } catch (error) {
        errors.push(`${configFile}のパースに失敗: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    errors.push(`設定ファイル検索に失敗: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return { rules, errors };
}
```

## ドキュメント

- ユーザー向けの変更についてはREADME.mdを更新
- 新しい関数/クラスにJSDocコメントを追加
- API変更についてはREADME.mdを更新
- ドキュメントに例を含める

## セキュリティ

- シークレット、APIキー、個人情報をコミットしない
- `pnpm secretlint`を使用して潜在的なシークレットをチェック
- セキュリティ問題はメンテナーに非公開で報告

## 質問？

お気軽に:
- 貢献に関する質問はissueを開く
- より広範なトピックについてはディスカッションを開始
- ガイダンスについてはメンテナーに連絡

rulesyncへの貢献をありがとうございます！

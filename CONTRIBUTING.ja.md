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

### 簡素化された.rulesyncディレクトリ

プロジェクトは合理化された.rulesyncディレクトリ構造で簡素化されました:

```
.rulesync/
├── overview.md              # プロジェクト概要とアーキテクチャ (root: true)
├── my-instructions.md       # カスタムプロジェクト指示
├── precautions.md          # 開発上の注意事項とガイドライン
└── specification-[tool]-[type].md  # ツール固有の仕様
    # タイプ: rules, mcp, ignore
    # ツール: augmentcode, copilot, cursor, cline, claudecode, 
    #        codexcli, geminicli, junie, kiro, roo
```

**主要な変更**: 5つの専門ルールファイル（build-tooling.md, cli-development.md, docs-maintenance.md, mcp-support.md, security-quality.md）を削除し、ルール構造を簡素化しました。

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
│   │   ├── generator.ts    # 生成のオーケストレーション
│   │   ├── importer.ts     # 既存設定のインポート
│   │   ├── validator.ts    # ルール構造の検証
│   │   ├── mcp-generator.ts # MCP固有の生成ロジック
│   │   └── mcp-parser.ts   # MCP固有のパースロジック
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
│   │   │   └── roo.ts         # Roo Code Rules
│   │   ├── mcp/            # MCP設定ジェネレーター
│   │   │   └── [tool].ts   # 各ツール用のMCP固有設定
│   │   └── ignore/         # Ignoreファイルジェネレーター
│   │       └── [tool].ts   # ツール固有のignore設定
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
│   │   └── roo.ts         # Roo Code設定のパース (.roo/instructions.md)
│   ├── types/              # TypeScript型定義
│   │   ├── config.ts      # 設定型
│   │   ├── rules.ts       # ルールとフロントマター型
│   │   ├── mcp.ts         # MCP固有型
│   │   ├── tool-targets.ts # ツールターゲット定義
│   │   └── config-options.ts # 設定オプション型
│   └── utils/
│       ├── file.ts         # ファイル操作 (read/write/delete)
│       ├── config.ts       # 設定管理
│       ├── config-loader.ts # 設定読み込みユーティリティ
│       ├── ignore.ts       # ignoreファイルユーティリティ
│       ├── rules.ts        # ルール処理ユーティリティ
│       └── parser-helpers.ts # パーサーユーティリティ関数
├── dist/                   # ビルド出力 (CJS + ESM)
└── [module].test.ts        # テストファイル（ソースと同じ場所に配置）
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
```

### モジュール別テストカバレッジ

- **cli/commands**: 優秀なカバレッジ
- **core**: 高カバレッジを達成
- **generators**: すべてのモジュールで高カバレッジ
- **parsers**: すべてのパーサーで良好なカバレッジ
- **utils**: すべてのモジュールで高カバレッジ
- **types**: 型定義ファイルのため測定対象外

### 最近の改善

- **簡素化されたアーキテクチャ**: 5つの専門.rulesyncルールファイルを削除し、プロジェクト構造を合理化
- **強化されたフロントマター**: init-rulesyncコマンドに包括的なフロントマター仕様を追加
- **ツールサポートの拡大**: AugmentCode、JetBrains Junie、Kiro IDE、OpenAI Codex CLIのサポートを追加
- **高度なMCP統合**: ラッパーサーバー設定、複数の転送タイプ（stdio、SSE、HTTP）、環境変数処理を含む完全なMCP（Model Context Protocol）サポート
- **階層ルールシステム**: OpenAI Codex CLIで実装されているマルチレベルルール優先順位（グローバル → プロジェクト → ディレクトリ）のサポート
- **シリアル実行**: research-tool-specsコマンドを並列からシリアル実行に変更し、安定性を向上
- **改善された組織化**: ジェネレーターをrules/、mcp/、ignore/サブディレクトリに組織化
- **強化されたテスト**: ソースと同じ場所に配置されたテストファイルで全モジュールを包括的にカバー（新ツール向けの1,200+行のテストコード）
- **型安全性**: Zodスキーマと適切な型ガードで型安全性を向上
- **開発ツール**: Biome、ESLintと並んで追加のコード品質チェックのOxlintを追加

## 新しいAIツールの追加

新しいAIツールのサポートを追加するには（最近追加された`augmentcode`、`junie`、`kiro`、`codexcli`を参考として）:

1. **ジェネレーターを作成**: 適切なサブディレクトリにファイルを追加:
   - `src/generators/rules/newtool.ts` （標準ルール）
   - `src/generators/mcp/newtool.ts` （MCP設定、該当する場合）
   - `src/generators/ignore/newtool.ts` （ignoreファイル、該当する場合）
   
   **MCPジェネレーターの実装注意事項**:
   - 一貫したMCP設定生成のために`shared-factory.ts`を使用
   - 複数の転送タイプをサポート: stdio（コマンドベース）、SSE、HTTP
   - APIキー用の環境変数展開を処理
   - サードパーティ統合のラッパーサーバーパターンに従う
2. **パーサーを作成**: インポート機能用に`src/parsers/newtool.ts`を追加
3. **インターフェースを実装**: 確立されたパターンに従って非同期関数をエクスポート
4. **コアに追加**: `src/core/generator.ts`と`src/core/importer.ts`を更新
5. **CLIオプションを追加**: generateとimportコマンドの両方で`src/cli/index.ts`を更新
6. **型を更新**: `src/types/tool-targets.ts`の`ALL_TOOL_TARGETS`に追加
7. **設定を更新**: `src/utils/config.ts`で出力パスを追加
8. **テストを追加**: すべてのジェネレーターとパーサーの包括的なテストファイルを作成
   - 徹底的なカバレッジのためにテストファイルあたり250-350+行を目指す
   - MCPジェネレーターのすべての転送タイプをテスト
   - パーサー機能の統合テストを含める
   - ignoreパターンを変更する際は共有ファクトリーテストを更新
9. **ドキュメントを更新**: README.mdとREADME.ja.mdに追加
10. **仕様を追加**: `.rulesync/`ディレクトリにルール仕様ファイルを作成
    - `specification-[tool]-rules.md`: ツール固有のルール形式とファイル階層
    - `specification-[tool]-mcp.md`: MCPサーバー設定仕様
    - `specification-[tool]-ignore.md`: ignoreファイルパターンと動作

### ジェネレーターインターフェースパターン

```typescript
export async function generateNewToolConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string
): Promise<GeneratedOutput[]> {
  const outputs: GeneratedOutput[] = [];
  
  for (const rule of rules) {
    const content = generateNewToolMarkdown(rule);
    const outputDir = baseDir ? join(baseDir, config.outputPaths.newtool) : config.outputPaths.newtool;
    const filepath = join(outputDir, `${rule.filename}.ext`);
    
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
  
  // 設定ファイルを確認
  const configFiles = await findNewToolConfigFiles(baseDir);
  
  if (configFiles.length === 0) {
    errors.push("NewTool設定ファイルが見つかりません");
    return { rules, errors };
  }
  
  // 各設定ファイルをパース
  for (const configFile of configFiles) {
    try {
      const content = await readFile(configFile, "utf-8");
      const parsed = await parseNewToolFormat(content);
      rules.push({
        ...parsed,
        filename: generateUniqueFilename("newtool", parsed),
      });
    } catch (error) {
      errors.push(`${configFile}のパースに失敗: ${error.message}`);
    }
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

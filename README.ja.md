# rulesync

[![CI](https://github.com/dyoshikawa/rulesync/actions/workflows/ci.yml/badge.svg)](https://github.com/dyoshikawa/rulesync/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/rulesync.svg)](https://www.npmjs.com/package/rulesync)

統一されたAIルールファイル（`.rulesync/*.md`）から、様々なAI開発ツール用の設定ファイルを自動生成するNode.js CLIツールです。既存のAIツール設定を統一形式にインポートすることも可能です。

[English](./README.md) | **日本語**

## 対応ツール

rulesyncは以下の**10のAI開発ツール**の**生成**と**インポート**の両方をサポートしています：

- **GitHub Copilot Custom Instructions** (`.github/copilot-instructions.md` + `.github/instructions/*.instructions.md`)
- **Cursor Project Rules** (`.cursor/rules/*.mdc` + `.cursorrules`) 
- **Cline Rules** (`.clinerules/*.md` + `.cline/instructions.md`)
- **Claude Code Memory** (`./CLAUDE.md` + `.claude/memories/*.md`)
- **OpenAI Codex CLI** (`codex.md` + `.codex/mcp-config.json` + `.codexignore`)
- **AugmentCode Rules** (`.augment/rules/*.md`)
- **Roo Code Rules** (`.roo/rules/*.md` + `.roo/instructions.md`)
- **Gemini CLI** (`GEMINI.md` + `.gemini/memories/*.md`)
- **JetBrains Junie Guidelines** (`.junie/guidelines.md`)
- **Windsurf AIコードエディター** (`.windsurf/rules/*.md` + `.codeiumignore` + `.windsurf/mcp.json`)
- **Kiro IDE カスタムステアリングドキュメント** (`.kiro/steering/*.md`) + **AI除外ファイル** (`.aiignore`)

## インストール

```bash
npm install -g rulesync
# または
pnpm add -g rulesync
# または  
yarn global add rulesync
```

## 使い始める

### 新しいプロジェクト

1. **プロジェクトを初期化:**
   ```bash
   npx rulesync init
   ```

2. **`.rulesync/`ディレクトリの生成されたルールファイル**をプロジェクトのニーズに合わせて編集します
   
   または新しいルールファイルを追加:
   ```bash
   npx rulesync add my-custom-rules
   ```

3. **ツール固有の設定ファイルを生成:**
   ```bash
   npx rulesync generate
   ```

4. **オプション: 生成されたファイルを.gitignoreに追加:**
   ```bash
   npx rulesync gitignore
   ```

### AIツール設定を持つ既存プロジェクト

既にAIツールの設定がある場合、それらをrulesync形式にインポートできます：

1. **既存設定をインポート:**
   ```bash
   # 特定のツールからインポート（一度に1つのツールのみ指定可能）
   npx rulesync import --claudecode  # CLAUDE.mdと.claude/memories/*.mdから
   npx rulesync import --cursor      # .cursorrulesと.cursor/rules/*.mdcから
   npx rulesync import --copilot     # .github/copilot-instructions.mdから
   npx rulesync import --cline       # .cline/instructions.mdから
   npx rulesync import --augmentcode        # .augment/rules/*.mdから
   npx rulesync import --augmentcode-legacy # .augment-guidelines（レガシー形式）から
   npx rulesync import --roo                # .roo/instructions.mdから
   npx rulesync import --geminicli   # GEMINI.mdと.gemini/memories/*.mdから
   npx rulesync import --junie       # .junie/guidelines.mdから
   npx rulesync import --windsurf    # .windsurfrules と .windsurf/rules/*.mdから
   ```

2. **`.rulesync/`ディレクトリのインポートされたルールを確認・編集**

3. **統合された設定を生成:**
   ```bash
   npx rulesync generate
   ```

以上です！AIコーディングアシスタントが生成された設定ファイルを自動的に使用するようになります。

## rulesyncを使う理由

### 🔧 **ツールの柔軟性**
チームメンバーは好みのAIコーディングツールを自由に選択できます。GitHub Copilot、Cursor、Cline、Claude Codeのいずれであっても、各開発者は生産性を最大化するツールを使用できます。

### 📈 **将来を見据えた開発**
AI開発ツールは新しいツールが頻繁に登場し、急速に進化しています。rulesyncがあれば、ツールを切り替える際にルールを一から再定義する必要がありません。

### 🎯 **マルチツールワークフロー**
複数のAIツールを組み合わせたハイブリッド開発ワークフローを可能にします：
- GitHub Copilot：コード補完
- Cursor：リファクタリング
- Claude Code：アーキテクチャ設計
- Cline：デバッグ支援
- OpenAI Codex CLI：GPT-4を活用した開発
- Gemini CLI：知的コード解析
- JetBrains Junie：自律的AIコーディング
- Windsurf：高度なAIコードエディティング

### 🔓 **ベンダーロックインなし**
ベンダーロックインを完全に回避できます。rulesyncの使用を停止することを決定した場合でも、生成されたルールファイル（`.github/instructions/`、`.cursor/rules/`、`.clinerules/`、`CLAUDE.md`、`codex.md`、`GEMINI.md`、`.junie/guidelines.md`、`.windsurfrules`など）をそのまま使い続けることができます。

### 🎯 **ツール間の一貫性**
すべてのAIツールに一貫したルールを適用し、チーム全体のコード品質と開発体験を向上させます。

## Kiro IDE統合

### カスタムステアリングドキュメントとAI除外ファイル

rulesyncは、Kiro IDEの組み込みプロジェクト管理システムを補完する**カスタムステアリングドキュメント**と**AI除外ファイル**をサポートしています。

**重要**: rulesyncは、Kiro IDE自体が直接管理する方が良いコアステアリングファイル（`product.md`、`structure.md`、`tech.md`）を生成しません。代わりに、rulesyncは追加のカスタムステアリングドキュメントとAI専用除外ファイルの生成に焦点を当てています。

### rulesyncがKiroに提供する機能：
- **カスタムステアリングドキュメント**: `.kiro/steering/`ディレクトリの追加`.md`ファイル
- **AI除外ファイル**: AIアクセスからファイルを除外する`.aiignore`ファイル
- **プロジェクト固有のルール**: チームコーディング標準、セキュリティガイドライン、デプロイプロセス
- **ルール同期**: チームメンバー間でカスタムルールを一貫して保つ
- **インテリジェントパターン抽出**: ルールglobからAI機密パターンを自動識別

### AI除外ファイルの機能：
- **セキュリティ優先除外**: 機密ファイル（`.pem`、`.key`、`.env*`）を自動除外
- **データファイル除外**: AIを混乱させる可能性のある大きなデータファイル（`.csv`、`.sqlite`、`.zip`）を除外
- **機密文書**: 内部文書と機密ディレクトリを除外
- **パターンベース除外**: ルールglobを分析してAI機密パターンを識別
- **明示的除外パターン**: ルールコンテンツ内の手動除外パターン（`# IGNORE:`、`# aiignore:`）をサポート

### Kiro IDEが直接処理する機能：
- **コアステアリングファイル**: `product.md`（ユーザー要件）、`structure.md`（アーキテクチャ）、`tech.md`（技術スタック）
- **仕様管理**: `.kiro/specs/`内のフィーチャー仕様
- **エージェントフック**: 自動化されたコンテキスト適用

この責任分担により、rulesyncはKiroのコア機能を複製することなく、その機能を強化します。

## OpenAI Codex CLI統合

### 階層メモリシステム

rulesyncは**OpenAI Codex CLI**の階層メモリシステムをサポートしており、GPT-4を活用した開発ワークフローに持続的なコンテキストとプロジェクト固有のルールを提供します。

**主要機能**：
- **階層インストラクション**: グローバルユーザーインストラクション → プロジェクトレベルインストラクション → ディレクトリ固有インストラクション
- **MCP統合**: ラッパーサーバーを通じたModel Context Protocolサポートで機能拡張
- **GPT-4モデル**: GPT-4、GPT-4 Turbo、o1-mini、その他のOpenAIモデルをサポート
- **プレーンMarkdown形式**: 複雑なフロントマターなしのクリーンで読みやすいインストラクションファイル
- **コミュニティIgnoreサポート**: 機密ファイルをAIアクセスから除外するオプションの`.codexignore`ファイル

### ファイル構造

rulesyncはOpenAI Codex CLI用に以下のファイルを生成します：

- **`codex.md`**: メインのプロジェクトレベルインストラクション（ルートルールから生成）
- **`<filename>.md`**: 追加のインストラクションファイル（非ルートルールから生成）
- **`.codex/mcp-config.json`**: ラッパーサーバー用のMCPサーバー設定
- **`.codexignore`**: コミュニティツールとプライバシー強化用のオプション除外ファイル

### OpenAIモデルでの使用

OpenAI Codex CLIは様々なOpenAIモデルで動作します：
- **GPT-4**: 複雑な推論とアーキテクチャ決定に最適
- **GPT-4 Turbo**: パフォーマンスとコスト効率を最適化
- **o1-mini**: コーディングタスクと問題解決に特化
- **GPT-4o-mini**: 日常的な開発タスクでバランスの取れたパフォーマンス

階層メモリシステムにより、すべてのモデルとのやり取りで一貫したコーディング標準とプロジェクトコンテキストが保証されます。

### 使用例

OpenAI Codex CLI設定ファイルを生成：

```bash
# OpenAI Codex CLI専用で生成
npx rulesync generate --codexcli

# ラッパーサーバー用のMCP設定付きで生成
npx rulesync generate --codexcli --verbose

# 特定のディレクトリに生成（monorepoに便利）
npx rulesync generate --codexcli --base-dir ./packages/frontend
```

これにより以下が作成されます：
- `codex.md` プロジェクトレベルのインストラクション
- 特定のルールカテゴリ用の追加`.md`ファイル
- `.codex/mcp-config.json` MCPラッパーサーバー統合用
- `.codexignore` プライバシー制御強化用（`.rulesyncignore`が存在する場合）

## Windsurf AI統合

### 包括的なWindsurf対応

rulesyncは**Windsurf AIコードエディター**の完全統合を提供し、ルール/メモリー管理、Model Context Protocol (MCP)サーバー、AIファイル除外の3つの主要領域をサポートしています。

**主要機能**：
- **統一ルールシステム**: プロジェクト固有のAIルールと開発ガイドライン
- **MCP統合**: Model Context Protocolサーバー設定で外部ツールとの拡張可能性
- **プライバシー制御**: 機密ファイルをAIアクセスから除外するスマートな除外システム
- **プロジェクトレベル設定**: チーム全体で一貫したAI支援開発体験

### 生成されるファイル構造

rulesyncはWindsurf用に以下のファイルを生成します：

- **`.windsurfrules`**: メインのプロジェクトルール（ルートルールから生成）
- **`.windsurf/rules/<filename>.md`**: 追加のルールファイル（非ルートルールから生成）
- **`.windsurf/mcp.json`**: Model Context Protocol サーバー設定
- **`.windsurfignore`**: AIアクセス除外ファイル（`.rulesyncignore`から生成）

### Windsurf設定の生成

Windsurf設定ファイルを生成する：

```bash
# Windsurf専用で生成
npx rulesync generate --windsurf

# MCPサーバー設定の詳細出力付きで生成
npx rulesync generate --windsurf --verbose

# 特定のディレクトリに生成（monorepoに便利）
npx rulesync generate --windsurf --base-dir ./packages/frontend
```

これにより以下が作成されます：
- `.windsurfrules` プロジェクトレベルのルール
- `.windsurf/rules/` ディレクトリの詳細ルールファイル
- `.windsurf/mcp.json` Model Context Protocolサーバー統合用
- `.windsurfignore` プライバシー保護用（`.rulesyncignore`が存在する場合）

### アーキテクチャ改善

Windsurfサポートの実装により、rulesyncのアーキテクチャは大幅に改善されました：

- **レジストリパターン**: すべてのルールジェネレーターを統一されたレジストリシステムで管理
- **共有ファクトリー**: ジェネレーター間でコードの重複を削減
- **関心事の分離**: より良い保守性とテストのためのモジュラー設計
- **包括的なテスト**: 新機能の広範なテストカバレッジ

これらの改善により、すべてのAI開発ツールにおいて、より一貫性があり信頼性の高い設定生成が可能になりました。

## Claude Code統合

### カスタムスラッシュコマンドの作成

Claude Codeの組み込み`/init`コマンドを使用する代わりに、rulesync専用のカスタムスラッシュコマンドを作成することをお勧めします。

[Claude Codeスラッシュコマンドドキュメント](https://docs.anthropic.com/en/docs/claude-code/slash-commands)を参照し、以下のカスタムコマンドを追加してください：

**`.claude/commands/init-rulesync.md`**

```markdown
Analyze this project's codebase and update .rulesync/overview.md files as needed.

Please ensure the following frontmatter is defined in .rulesync/overview.md:

---
root: true | false               # Required: Rule level (true for overview, false for details)
targets: ["*"]                   # Required: Target tools (* = all, or specific tools)
description: "" # Required: Rule description
globs: ["**/*"]                  # Required: File patterns
cursorRuleType: "always"         # Optional: Cursor-specific rule type (always, manual, specificFiles, intelligently)
---

In .rulesync/overview.md, root should be set to true. Please write an appropriate description in the description field.
```

### 統合のメリット

- **プロジェクト固有の初期化**: 各プロジェクトに最適化されたルール設定
- **自動ルール更新**: プロジェクトの変更に応じてルールが自動的に適応
- **チーム標準化**: すべてのメンバーが同じルールセットを使用
- **継続的改善**: プロジェクトの成長とともにルールが進化

## 使用方法

### 1. 初期化

```bash
npx rulesync init
```

これにより、サンプルルールファイルを含む`.rulesync/`ディレクトリが作成されます。

### 2. ルールファイルの編集

`.rulesync/`ディレクトリ内の各Markdownファイルでメタデータをフロントマターで定義します。詳細な例については、下記の[ファイル例](#ファイル例)セクションを参照してください。

### ルールレベル

rulesyncは2レベルのルールシステムを使用します：

- **root: true**: プロジェクト全体の概要とポリシー
  - プロジェクトごとに**1つ**のrootファイルのみ許可
  - 高レベルのガイドラインとプロジェクトコンテキストを含む
- **root: false**: 具体的な実装ルールと詳細なガイドライン
  - 複数の非rootファイルが許可
  - 具体的なコーディングルール、命名規約などを含む

#### ツール固有の動作

各AIツールはルールレベルを異なって処理します：

| ツール             | ルートルール       | 非ルートルール           | 特別な動作                                                           |
| ------------------ | ------------------ | ------------------------ | -------------------------------------------------------------------- |
| **Claude Code**    | `./CLAUDE.md`      | `.claude/memories/*.md`  | CLAUDE.mdが詳細ファイルへの`@filename`参照を含む                     |
| **Cursor**         | `cursorRuleType: always` | `cursorRuleType: specificFiles` (globs指定時)<br>`cursorRuleType: intelligently` (description指定時)<br>`cursorRuleType: manual` (デフォルト) | コンテンツ解析に基づく高度なルールタイプシステム |
| **GitHub Copilot** | 標準フォーマット   | 標準フォーマット         | すべてのルールがフロントマター付きの同じフォーマットを使用           |
| **Cline**          | 標準フォーマット   | 標準フォーマット         | すべてのルールがプレーンMarkdownフォーマットを使用                   |
| **Roo Code**       | 標準フォーマット   | 標準フォーマット         | すべてのルールが説明ヘッダー付きのプレーンMarkdownフォーマットを使用 |
| **Gemini CLI**     | `GEMINI.md`        | `.gemini/memories/*.md`  | GEMINI.mdがメモリファイルへの`@filename`参照を含む                   |
| **Windsurf**       | `.windsurf/rules/*.md`   | `.windsurf/rules/*.md`   | 包括的統合：MCP設定、ignoreファイル、プレーンMarkdownフォーマット    |

### 3. 設定ファイルの生成

```bash
# すべてのツール用に生成
npx rulesync generate

# 特定のツール用に生成
npx rulesync generate --copilot
npx rulesync generate --cursor  
npx rulesync generate --cline
npx rulesync generate --claudecode
npx rulesync generate --codexcli
npx rulesync generate --augmentcode
npx rulesync generate --roo
npx rulesync generate --geminicli
npx rulesync generate --junie
npx rulesync generate --windsurf
npx rulesync generate --kiro

# クリーンビルド（既存ファイルを最初に削除）
npx rulesync generate --delete

# 特定ツール用のクリーンビルド
npx rulesync generate --copilot --cursor --codexcli --windsurf --delete

# 詳細出力
npx rulesync generate --verbose
npx rulesync generate --delete --verbose

# 特定のベースディレクトリに生成（monorepoサポート）
npx rulesync generate --base-dir ./packages/frontend
npx rulesync generate --base-dir ./packages/frontend,./packages/backend
npx rulesync generate --base-dir ./apps/web,./apps/api,./packages/shared
```

#### 生成オプション

- `--delete`: 新しいファイルを作成する前に既存の生成済みファイルをすべて削除
- `--verbose`: 生成プロセス中に詳細出力を表示
- `--copilot`, `--cursor`, `--cline`, `--claudecode`, `--codexcli`, `--augmentcode`, `--roo`, `--geminicli`, `--junie`, `--windsurf`, `--kiro`: 指定されたツールのみ生成
- `--base-dir <paths>`: 指定されたベースディレクトリに設定ファイルを生成（複数パスの場合はカンマ区切り）。異なるプロジェクトディレクトリにツール固有の設定を生成したいmonorepoセットアップに便利。
- `--config <path>`: 特定の設定ファイルを使用
- `--no-config`: 設定ファイルの読み込みを無効化

### 4. 既存設定のインポート

プロジェクトに既存のAIツール設定がある場合、rulesync形式にインポートできます：

```bash
# 既存のAIツール設定からインポート
npx rulesync import --claudecode # CLAUDE.mdと.claude/memories/*.mdからインポート
npx rulesync import --cursor     # .cursorrulesと.cursor/rules/*.mdからインポート
npx rulesync import --copilot    # .github/copilot-instructions.mdと.github/instructions/*.instructions.mdからインポート
npx rulesync import --cline      # .cline/instructions.mdからインポート
npx rulesync import --augmentcode # .augment/rules/*.mdからインポート
npx rulesync import --roo        # .roo/instructions.mdからインポート
npx rulesync import --geminicli  # GEMINI.mdと.gemini/memories/*.mdからインポート
npx rulesync import --junie      # .junie/guidelines.mdからインポート
npx rulesync import --windsurf   # .windsurfrules と .windsurf/rules/*.mdからインポート

# 各ツールを個別にインポート
npx rulesync import --claudecode
npx rulesync import --cursor
npx rulesync import --copilot

# インポート時の詳細出力
npx rulesync import --claudecode --verbose
```

importコマンドの動作：
- カスタムパーサーを使用して各AIツールの既存設定ファイルをパース
- 適切なフロントマターメタデータを付けてrulesync形式に変換
- インポートしたコンテンツと適切なルール分類で新しい`.rulesync/*.md`ファイルを作成
- ファイル名の競合を避けるためツール固有のプレフィックスを使用（例：`claudecode-overview.md`、`cursor-custom-rules.md`）
- 競合が発生した場合はユニークなファイル名を生成
- YAMLフロントマター付きのCursorのMDCファイルなど複雑なフォーマットをサポート
- 複数ファイルのインポート（例：`.claude/memories/`ディレクトリのすべてのファイル）に対応

### Cursorインポートの詳細

Cursorからのインポートでは、以下の4つのルールタイプが自動的に識別されます：

1. **always** (`cursorRuleType: always`)
   - 条件: `alwaysApply: true` が設定されている場合
   - 変換: ルートルール（`root: false`）としてインポート、`globs: ["**/*"]`を設定

2. **manual** (`cursorRuleType: manual`)
   - 条件: description空 + globs空 + `alwaysApply: false`
   - 変換: 空のglobsパターンでインポート（手動適用ルール）

3. **specificFiles** (`cursorRuleType: specificFiles`)
   - 条件: globs指定あり（description有無問わず）
   - 変換: 指定されたglobsパターンを配列として保持、descriptionは空文字に設定

4. **intelligently** (`cursorRuleType: intelligently`)
   - 条件: description指定あり + globs空
   - 変換: descriptionを保持、空のglobsパターンを設定

#### エッジケース処理
- **description非空 + globs非空の場合**: `specificFiles`として処理（globsパターンを優先）
- **判定条件に該当しない場合**: `manual`として処理（デフォルト）

#### Cursorのサポートファイル
- `.cursor/rules/*.mdc` (モダンな推奨形式)
- `.cursorrules` (レガシーな形式)

### 設定ファイル

rulesyncは、繰り返しコマンドライン引数を避けるために設定ファイルをサポートしています。設定は（優先順位順に）以下から読み込まれます：

1. `--config`フラグで指定されたパス
2. `rulesync.jsonc` (コメント付きJSONC形式)
3. `rulesync.ts` (TypeScript形式)
4. `rulesync.config.ts`
5. `rulesync.config.jsonc`
6. `package.json` (`"rulesync"`フィールド内)

#### 設定ファイルの例

**JSONC形式 (`rulesync.jsonc`):**
```jsonc
{
  // 設定を生成するツールのリスト
  "targets": ["copilot", "cursor", "claudecode", "codexcli"],
  
  // 生成から除外するツール（targetsをオーバーライド）
  "exclude": ["roo"],
  
  // 特定ツール用のカスタム出力パス
  "outputPaths": {
    "copilot": ".github/copilot-instructions.md"
  },
  
  // 生成用のベースディレクトリまたはディレクトリ群
  "baseDir": "./packages",
  
  // 生成前に既存ファイルを削除
  "delete": false,
  
  // 詳細出力を有効化
  "verbose": true,
  
  // ルールファイルを含むディレクトリ
  "aiRulesDir": ".rulesync",
  
  // 監視設定
  "watch": {
    "enabled": false,
    "interval": 1000,
    "ignore": ["node_modules/**", ".git/**", "dist/**", "build/**"]
  }
}
```

**TypeScript形式 (`rulesync.ts`):**
```typescript
import type { ConfigOptions } from "rulesync";

const config: ConfigOptions = {
  targets: ["copilot", "cursor", "claudecode", "codexcli"],
  exclude: ["roo"],
  outputPaths: {
    copilot: ".github/copilot-instructions.md"
  },
  baseDir: "./packages",
  delete: false,
  verbose: true
};

export default config;
```

#### 設定オプション

- `targets`: 設定を生成するツールの配列（デフォルトターゲットをオーバーライド）
- `exclude`: 生成から除外するツールの配列
- `outputPaths`: 特定ツール用のカスタム出力パス
- `baseDir`: 生成用のベースディレクトリまたはディレクトリ配列
- `delete`: 生成前に既存ファイルを削除（デフォルト: false）
- `verbose`: 詳細出力を有効化（デフォルト: false）
- `aiRulesDir`: ルールファイルを含むディレクトリ（デフォルト: ".rulesync"）
- `watch`: `enabled`、`interval`、`ignore`オプション付きの監視設定
  - `enabled`: ファイル監視を有効化（デフォルト: false）
  - `interval`: 監視間隔（ミリ秒、デフォルト: 1000）
  - `ignore`: 監視中に無視するパターンの配列

#### 設定の管理

```bash
# 現在の設定を表示
npx rulesync config

# 設定ファイルを初期化
npx rulesync config --init

# 特定の形式で初期化
npx rulesync config --init --format jsonc  # デフォルト、コメントをサポート
npx rulesync config --init --format ts     # 型安全性を持つTypeScript
```

### 5. その他のコマンド

```bash
# サンプルファイルでプロジェクトを初期化
npx rulesync init

# 新しいルールファイルを追加
npx rulesync add <filename>
npx rulesync add typescript-rules
npx rulesync add security.md  # .md拡張子は自動的に処理される

# ルールファイルを検証
npx rulesync validate

# 現在のステータスを確認  
npx rulesync status

# ファイルを監視して自動生成
npx rulesync watch

# 生成されたファイルを.gitignoreに追加
npx rulesync gitignore

# 設定を表示または管理
npx rulesync config
npx rulesync config --init  # 設定ファイルを作成
```

## 設定ファイル構造

```
.rulesync/
├── overview.md          # プロジェクト概要 (root: true, 1つのみ)
├── coding-rules.md      # コーディングルール (root: false)
├── naming-conventions.md # 命名規約 (root: false)
├── architecture.md      # アーキテクチャガイドライン (root: false)  
├── security.md          # セキュリティルール (root: false)
└── custom.md           # プロジェクト固有ルール (root: false)
```

### .rulesyncignoreでファイルを除外

プロジェクトルートに`.rulesyncignore`ファイルを作成することで、特定のルールファイルを処理から除外できます。このファイルはgitignoreスタイルのパターンを使用します。

`.rulesyncignore`の例：
```
# テスト用ルールファイルを無視
**/*.test.md

# 一時ファイルを無視
tmp/**/*

# ドラフトルールを無視
draft-*.md
*-draft.md
```

`.rulesyncignore`が存在する場合、rulesyncは：
1. 処理時にマッチするファイルをスキップ
2. ツール固有のignoreファイルを生成：
   - Cursor用の`.cursorignore`
   - Cline用の`.clineignore`
   - Roo Code用の`.rooignore`
   - GitHub Copilot用の`.copilotignore`（コミュニティツール用）
   - Windsurf用の`.windsurfignore`
   - Gemini CLI用の`.aiexclude`
   - Kiro IDE用の`.aiignore`
   - Claude Code用に`.claude/settings.json`のpermissions.denyに`Read()`ルールを追加

### フロントマタースキーマ

各ルールファイルには以下のフィールドを含むフロントマターが必要です：

```yaml
---
root: true | false               # 必須: ルールレベル (概要の場合true、詳細の場合false)
targets: ["*"]                   # 必須: ターゲットツール (* = すべて、または特定のツール)
description: "簡潔な説明"        # 必須: ルールの説明
globs: ["**/*"]                  # 必須: ファイルパターン (配列形式)
cursorRuleType: "always"         # オプション: Cursor固有のルールタイプ (always, manual, specificFiles, intelligently)
---
```

#### cursorRuleTypeフィールド (オプション)

Cursorツール用の追加メタデータフィールド：

- **`always`**: プロジェクト全体に常に適用されるルール
- **`manual`**: 手動で適用するルール（デフォルト）
- **`specificFiles`**: 特定のファイルパターンに自動適用されるルール
- **`intelligently`**: AIが判断して適用するルール

### ファイル例

**ルートファイル** (`.rulesync/overview.md`):
```markdown
---
root: true
targets: ["*"]
description: "プロジェクト概要と開発思想"
globs: ["src/**/*.ts"]
---

# プロジェクト開発ガイドライン

このプロジェクトはクリーンアーキテクチャの原則に従ったTypeScript-firstの開発を行っています。
```

**非ルートファイル** (`.rulesync/coding-rules.md`):
```markdown
---
root: false
targets: ["copilot", "cursor", "roo"]
description: "TypeScriptコーディング標準"
globs: ["**/*.ts", "**/*.tsx"]
---

# TypeScriptコーディングルール

- 厳密なTypeScript設定を使用
- オブジェクト形状にはtypeよりinterfaceを優先
- 意味のある変数名を使用
```

## 生成される設定ファイル

| ツール             | 出力パス                                                     | フォーマット                  | ルールレベル処理                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GitHub Copilot** | `.github/instructions/*.instructions.md`                     | フロントマター + Markdown     | 両レベルとも同じフォーマットを使用                                                                                                                                                                              |
| **Cursor**         | `.cursor/rules/*.mdc`                                        | MDC (YAMLヘッダー + Markdown) | ルート: `cursorRuleType: always`<br>非ルート: `cursorRuleType: specificFiles` (globs指定時)<br>非ルート: `cursorRuleType: intelligently` (description指定時)<br>非ルート: `cursorRuleType: manual` (デフォルト) |
| **Cline**          | `.clinerules/*.md`                                           | プレーンMarkdown              | 両レベルとも同じフォーマットを使用                                                                                                                                                                              |
| **Claude Code**    | `./CLAUDE.md` (ルート)<br>`.claude/memories/*.md` (非ルート) | プレーンMarkdown              | ルートはCLAUDE.mdに移動<br>非ルートは別メモリファイルに移動<br>CLAUDE.mdは`@filename`参照を含む                                                                                                                 |
| **OpenAI Codex CLI** | `codex.md` (ルート)<br>`<filename>.md` (非ルート) | プレーンMarkdown | ルートはcodex.mdに移動<br>非ルートは別インストラクションファイルに移動<br>階層メモリシステム |
| **AugmentCode**    | `.augment/rules/*.md`                                        | YAMLフロントマター + Markdown | ルート: `type: always`<br>非ルート: `type: auto` (description指定時) または `type: manual` (デフォルト)                                                                                                        |
| **Roo Code**       | `.roo/rules/*.md`                                            | プレーンMarkdown              | 両レベルとも説明ヘッダー付きの同じフォーマットを使用                                                                                                                                                            |
| **Gemini CLI**     | `GEMINI.md` (ルート)<br>`.gemini/memories/*.md` (非ルート)   | プレーンMarkdown              | ルートはGEMINI.mdに移動<br>非ルートは別メモリファイルに移動<br>GEMINI.mdは`@filename`参照を含む                                                      |
| **JetBrains Junie** | `.junie/guidelines.md`                                      | プレーンMarkdown              | すべてのルールを単一のガイドラインファイルに統合                                                                                                                                                                |
| **Windsurf**       | `.windsurf/rules/*.md` (ルート)<br>`.windsurf/rules/*.md` (非ルート) | プレーンMarkdown           | 両レベルとも`.windsurf/rules/`ディレクトリに統合<br>MCP設定とignoreファイルを含む包括的統合                                                                                              |
| **Kiro IDE**       | `.kiro/steering/*.md` + `.aiignore`                          | プレーンMarkdown + 除外パターン | カスタムステアリングドキュメントで両レベルとも同じフォーマット使用<br>AI除外ファイルで機密パターンを除外                                                                                                       |

## バリデーション

rulesyncはルールファイルを検証し、有用なエラーメッセージを提供します：

```bash
npx rulesync validate
```

一般的なバリデーションルール：
- プロジェクトごとに1つのルートファイル（root: true）のみ許可
- すべてのフロントマターフィールドが必須で適切にフォーマットされている
- ファイルパターン（globs）が有効な構文を使用
- ターゲットツールが認識される値である

## MCP（Model Context Protocol）サポート

rulesyncは、対応するAIツール用のMCPサーバー設定も管理できます。これにより、言語サーバーやその他のMCP互換サービスを一度設定すれば、複数のAIコーディングアシスタントにデプロイできます。

### MCPをサポートするツール

- **Claude Code** (`.mcp.json`)
- **GitHub Copilot** (`.vscode/mcp.json`)
- **Cursor** (`.cursor/mcp.json`)
- **Cline** (`.cline/mcp.json`)
- **OpenAI Codex CLI** (`.codex/mcp-config.json`)
- **Gemini CLI** (`.gemini/settings.json`)
- **JetBrains Junie** (`.junie/mcp.json`)
- **Windsurf** (`.windsurf/mcp.json`)
- **Kiro IDE** (`.kiro/mcp.json`)
- **Roo Code** (`.roo/mcp.json`)

### MCP設定

プロジェクトに`.rulesync/.mcp.json`ファイルを作成：

```json
{
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {},
      "targets": ["*"]
    }
  }
}
```

### MCP設定フィールド

- **`mcpServers`**: MCPサーバー設定を含むオブジェクト
  - **`command`**: stdioベースのサーバー用の実行可能コマンド
  - **`args`**: コマンド引数
  - **`url`**: HTTP/SSEベースのサーバー用URL
  - **`env`**: サーバーに渡す環境変数
  - **`targets`**: このサーバーをデプロイするツール名の配列
    - 特定のツール名を使用: `["claude", "cursor", "copilot"]`
    - すべてのサポートツールにデプロイするには`["*"]`を使用
    - 省略した場合、デフォルトですべてのツールにデプロイ

### Kiro IDE固有のMCPフィールド

Kiro IDEでは、追加の設定フィールドを使用できます：

- **`kiroAutoApprove`**: ユーザープロンプトなしで自動承認するツール名の配列
- **`kiroAutoBlock`**: 自動的にブロックするツール名の配列

Kiro固有フィールドの例：
```json
{
  "mcpServers": {
    "aws-tools": {
      "command": "python",
      "args": ["-m", "aws_mcp_server"],
      "env": {
        "AWS_PROFILE": "dev",
        "AWS_REGION": "us-east-1"
      },
      "kiroAutoApprove": ["describe_instances", "list_buckets"],
      "kiroAutoBlock": ["delete_bucket", "terminate_instances"],
      "targets": ["kiro"]
    }
  }
}
```

### MCP設定の生成

MCP設定はルールファイルと一緒に生成されます：

```bash
# ルールとMCP設定の両方を生成
npx rulesync generate

# 特定のツールのみ生成
npx rulesync generate --claudecode --cursor --codexcli --windsurf --junie --kiro

# 特定のディレクトリに生成（monorepo）
npx rulesync generate --base-dir ./packages/frontend
```

MCP設定は各ツールの適切な場所に生成され、ツールは起動時に自動的にそれらを読み込みます。

## ライセンス

MIT License

## 貢献

Issues と Pull Requests を歓迎します！

開発環境の設定と貢献ガイドラインについては、[CONTRIBUTING.ja.md](./CONTRIBUTING.ja.md)を参照してください。

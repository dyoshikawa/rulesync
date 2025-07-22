---
root: false
targets: ["copilot"]
description: "GitHub Copilot の Content exclusion 機能に関する仕様書"
globs: ["**/*.yml", "**/*.yaml"]
---

# GitHub Copilot Ignore ファイル仕様

## 重要な前提

**GitHub Copilotには従来の「ignoreファイル」は存在しません。**
- `.gitignore`のようなファイルベースの無視設定はサポートされていない
- 代わりに「Content exclusion（コンテンツ除外）」機能を使用
- 設定はGitHubのWeb UI上でYAML形式で管理

## Content exclusion の仕様

### 利用条件
- **対象プラン**: Copilot Business または Copilot Enterprise
- **権限**: Repository Admin / Organization Owner / Enterprise Owner
- **対象IDE**: VS Code、Visual Studio、JetBrains IDE等（Vimは補完のみ）
- **反映時間**: 設定変更後30分以内に自動配信

### 制限事項
- シンボリックリンクは使用不可
- IDEが推論的に取得した型情報は完全遮断不可

## 設定場所と方法

### 1. リポジトリ設定（最も一般的）
- **場所**: GitHub → Settings → Copilot → Content exclusion
- **項目**: "Paths to exclude in this repository"
- **形式**: YAML リスト形式

### 2. 組織設定
- **場所**: Organization Settings → Copilot → Content exclusion
- **範囲**: 組織内の複数リポジトリに適用

### 3. Enterprise設定
- **場所**: Enterprise Policies → Copilot → Content exclusion
- **範囲**: Enterprise全体に適用

## YAML設定の構文

### 基本ルール
- 各行は `- "パターン"` 形式（必ず引用符で囲む）
- コメントは `#` から行末まで
- 大文字小文字を区別しない（fnmatch準拠）

### パスパターン
- `先頭/` : リポジトリルート基準の絶対パス
- `*` : ファイル名または1階層の任意文字列
- `**` : 階層をまたいだ任意ディレクトリ
- `?` : 任意の1文字

### リポジトリ設定例
```yaml
# 特定ファイルを除外
- "/src/some-dir/kernel.rs"

# どこにあってもsecrets.jsonを除外
- "secrets.json"

# ワイルドカードパターン
- "secret*"
- "*.cfg"

# ディレクトリを再帰的に除外
- "/scripts/**"
```

### 組織/Enterprise設定例

#### 任意の場所を除外
```yaml
"*":
  - "/home/runner/.ssh/**"
  - "/etc/**"
```

#### 特定リポジトリ内のみ除外
```yaml
https://github.com/org/example-repo.git:
  - "/internal/**"
  - "private*.md"
```

### リポジトリ参照の注意点
- HTTP(S) / git:// / SSH等の形式すべて対応
- ユーザ名やポート番号は無視される

## 設定の反映確認

### VS Code
```
Command Palette → "Developer: Reload Window"
```

### その他IDE
- 再起動で設定取得

## 非公式の`.copilotignore`について

### コミュニティ実装
- **mattickx/copilotignore-vscode** (VS Code拡張)
- **panozzaj/vim-copilot-ignore** (Vim プラグイン)

### 制限事項
- 公式サポートなし
- ローカルでのCopilot無効化のみ
- 他の開発者には効果なし
- GitHubサーバ側の除外ではない

## ベストプラクティス

### セキュリティ
1. 機密情報は必ずContent exclusionで除外
2. 組織レベルでの一貫した除外ルール設定
3. 定期的な除外設定の見直し

### パフォーマンス
1. 大きなバイナリファイルや生成されたファイルを除外
2. テストフィクスチャやモックデータの除外
3. サードパーティライブラリの除外

### 管理運用
1. 除外パターンの文書化
2. チーム内での除外ルール共有
3. 設定変更時の影響範囲確認

## 技術仕様詳細
- **パターンマッチング**: fnmatch準拠
- **文字エンコーディング**: UTF-8
- **パス区切り**: `/`（Windows環境でも統一）
- **最大設定数**: 公式制限は未公表（実用的な範囲で制限あり）
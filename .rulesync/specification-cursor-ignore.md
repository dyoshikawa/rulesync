---
root: false
targets: ["cursor"]
description: "Cursor IDE の .cursorignore および .cursorindexingignore ファイルに関する仕様書"
globs: ["**/.cursorignore", "**/.cursorindexingignore"]
---

# Cursor IDE Ignore ファイル仕様

## ファイルの配置場所とファイル名

### プロジェクト単位のIgnoreファイル
- **`.cursorignore`** 
  - 配置場所: ワークスペース/プロジェクトのルートディレクトリ
  - 効果: インデックスとAI機能の両方から除外

- **`.cursorindexingignore`**
  - 配置場所: ワークスペース/プロジェクトのルートディレクトリ  
  - 効果: インデックスからのみ除外、AI機能では参照可能

### 階層的Ignore設定
- 設定: Settings › Features › Editor › "Hierarchical Cursor Ignore" を有効化
- 効果: ルートから上位ディレクトリの複数の `.cursorignore` を合成

### グローバルIgnore設定
- 設定: アプリ設定の「Global Ignore Files」
- 効果: すべてのプロジェクトに共通適用

## ファイル内容の仕様

### 構文（`.gitignore`と同一）
- 空行は無視
- `#` から行末まではコメント
- パターンは `.cursorignore` の配置場所を基準とした相対パス
- 後に書いたパターンが優先（後勝ち）

### パターンマッチング規則
- `末尾/` : ディレクトリ指定
- `!` : 否定（無視を解除）
- `*` : 任意の0文字以上（スラッシュを除く）
- `**` : 任意階層ディレクトリ横断
- `?` : 任意1文字
- `[abc]` : 文字クラス

### 基本例
```
# 特定ファイル
config.json

# ディレクトリごと
dist/

# 拡張子
*.log
```

### 高度な例
```
# いったん全部無視
*

# app/ だけは対象に戻す
!app/

# logs フォルダをツリー全域で無視
**/logs
```

## デフォルトで無視されるファイル

Cursorは以下を自動的に除外:
1. ルートの `.gitignore` に列挙されたもの
2. Default Ignore List:
   - `node_modules/`
   - `package-lock.json`
   - `*.lock`
   - `.env*`
   - 画像/動画/バイナリファイル各種

## ファイル種類別の動作

| ファイル                    | インデックス | AI機能での参照 |
|----------------------------|-------------|----------------|
| `.cursorignore`            | 除外        | 除外           |
| `.cursorindexingignore`    | 除外        | 参照可能       |

## トラブルシューティング

除外設定の確認方法:
```bash
git check-ignore -v <path/to/file>
```

## 注意事項
- ChatからTerminalや外部ツールを呼び出した場合、`.cursorignore`は完全には強制されない
- 意図した通りに除外されているかの確認が重要
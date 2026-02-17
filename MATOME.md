# Commands サブディレクトリ対応: supportsSubdirectory フラグ追加

## 対応 Issue

https://github.com/dyoshikawa/rulesync/issues/1079

## 課題

Claude Code など一部のツールは `.claude/commands/pj/test.md` のようにサブディレクトリにコマンドを配置できるが、`rulesync import` はトップレベルのファイルしか取り込めなかった（Issue の主題）。

一方で、サブディレクトリを import できるようにすると、今度は generate 時にサブディレクトリ非対応のツール（cursor 等）にもそのパスがそのまま渡ってしまう。ツールごとにサブディレクトリ対応の有無が異なるため、import と generate の両方でツール単位の制御が必要になる。

## 解決方法

`ToolCommandFactory.meta` に `supportsSubdirectory` フラグを追加し、ツールごとにサブディレクトリ対応の有無を宣言する。

|          | `supportsSubdirectory=true`（新規動作） | `supportsSubdirectory=false`（変更前と同じ動作） |
| -------- | --------------------------------------- | ------------------------------------------------ |
| Import   | `**/*.md` で再帰的に検索                | `*.md` でトップレベルのみ検索                    |
| Generate | `pj/test.md` をそのまま保持             | `pj/test.md` を `test.md` に flatten             |

## 各ツールの supportsSubdirectory 設定値と根拠

### `true` に設定したツール

| ツール     | 根拠                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| claudecode | [公式ドキュメント](https://docs.anthropic.com/en/docs/claude-code/slash-commands)でサブディレクトリ対応を明記                 |
| geminicli  | [公式ドキュメント](https://googlegemini.wiki/gemini-cli/custom-commands/)でサブディレクトリがネームスペースに変換されると明記 |
| roo        | [公式ドキュメント](https://docs.roocode.com/features/slash-commands)でサブディレクトリの再帰読み取りを明記                    |
| opencode   | [ソースコード](https://github.com/opencode-ai/opencode)で glob が `**/*.md` であることを確認                                  |

### `false` に設定したツール

| ツール       | 根拠                                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| codexcli     | [公式ドキュメント](https://openai.github.io/codex-cli/)でトップレベルのみと明記                                                                                            |
| factorydroid | [公式ドキュメント](https://docs.factory.ai/reference/cli-reference)でフラット構造のみ記載                                                                                  |
| kilo         | [公式ドキュメント](https://kilo.ai/docs/features/slash-commands/workflows)でファイル名ベースの呼び出しのみ記載、サブディレクトリの言及なし                                 |
| cursor       | [公式ドキュメント](https://docs.cursor.com/)にコマンドのサブディレクトリに関する記載なし。フラット構造の例のみ                                                             |
| copilot      | [VS Code Issue #268780](https://github.com/microsoft/vscode/issues/268780) でデフォルト非対応と確認済み。設定変更で対応可能だが、Rulesync としてはデフォルト挙動に合わせる |
| cline        | [公式ドキュメント](https://docs.cline.bot/features/slash-commands/workflows)にサブディレクトリの言及なし                                                                   |
| kiro         | [公式ドキュメント](https://kiro.dev/docs/cli/reference/slash-commands/)にサブディレクトリの言及なし                                                                        |
| antigravity  | 公式ドキュメント（antigravity.google）が取得不可。[ブログ記事](https://atamel.dev/posts/2025/11-25_customize_antigravity_rules_workflows/)ではフラット構造の例のみ         |

※ agentsmd, factorydroid はシミュレーション対象、claudecode-legacy は claudecode と同一実装のため省略。コード上はそれぞれ設定済み。

## 設計上の責務分担

flatten（`pj/test.md` → `test.md`）は `commands-processor.ts` が `supportsSubdirectory` フラグを見て行う。各コマンドクラス（`cursor-command.ts` 等）は渡された `relativeFilePath` をそのまま保持するだけで、flatten の判断はしない。

変更前は各コマンドクラスの `fromFile` 内で `basename()` していたが、この PR でそれを削除し、processor に責務を集約した。そのため各コマンドクラスのテストでは `fromFile` にサブディレクトリパスを渡すとそのまま保持されることを検証している（flatten は processor のテストで検証）。

## 検証

```bash
pnpm cicheck  # lint, typecheck, 全テスト, spell, secretlint 全通過
```

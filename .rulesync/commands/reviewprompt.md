---
description: 'Reviewprompt'
targets:
  - claudecode
---

pr_url = $ARGUMENTS

pr_urlが渡されなかった場合、現在のブランチに紐づくPRを取得してください。

reviewpromptは、GitHub PRのレビューコメントからあなたへの指示を抽出し、1つのプロンプトとして出力するNode.js製のCLIツールです。

以下のように実行して、出力の指示に従って修正してください。

```bash
npx reviewprompt --resolve --all $pr_url
```

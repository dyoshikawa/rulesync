# Contributing

Issues and Pull Requests are welcome!

## Pull Request Guidelines

- For external contributors, keep the number of changed lines in a PR under 400-500 whenever possible.
- Please note that the maintainer may add additional commits on top of your commits before merging at their discretion. In such cases, your original commits will still be preserved as your contribution.

## Development Setup

```bash
git clone https://github.com/dyoshikawa/rulesync # Should be your fork repository url actually
cd rulesync
pnpm i
pnpm cicheck # Run code style check, type check, and tests

# Manual test using current code
pnpm dev generate -t claudecode -f "*"
pnpm dev import -t claudecode -f "*"

# Once you create .rulesync/rules/my-language.md and `pnpm dev generate`, you can use coding agents with your language.
# Japanese setting example:
cat << 'EOF' > .rulesync/rules/my-language.md
---
root: false
targets: ['*']
description: "It's a rule about language. If the rule file exists, you must always follow this."
globs: ["**/*"]
---

I'm a Japanese developer. So you must always answer in Japanese. On the other hand, reasoning(thinking) should be in English to improve token efficiency.

However, this project is for English speaking people. So when you write any code, comments, documentation, commit messages, PR title and PR descriptions, you must always use English.
EOF
pnpm dev generate
```

## How to add support for a new Tool/Feature

To add support for a new Tool/Feature, you can follow these steps:

1. Create `src/features/{feature}/{tool}-{feature}.ts` and implement with reference to existing files.
2. Modify `src/features/{feature}/{feature}-processor.ts` to incorporate the `{tool}-{feature}.ts` implementation.
3. With reference to [.rulesync/rules/feature-change-guidelines.md](.rulesync/rules/feature-change-guidelines.md), modify related files such as `README.md` and `src/cli/commands/gitignore.ts` especially.

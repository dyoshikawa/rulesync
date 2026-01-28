# Contributing

Issues and Pull Requests are welcome!

## Understanding the Codebase

If you're new to the project, you can ask [DeepWiki](https://deepwiki.com/dyoshikawa/rulesync) questions to quickly understand the overall architecture and codebase structure.

## Pull Request Guidelines

- For external contributors, keep the number of changed lines in a PR under 400-500 whenever possible.
- Please note that the maintainer may add additional commits on top of your commits before merging at their discretion. In such cases, your original commits will still be preserved as your contribution.
- Before marking your PR as "Ready for Review", run the `/review-pr` command with an AI agent (e.g., Claude Code) in this repository to get automated feedback and address any issues.

## Development Setup

```bash
git clone https://github.com/dyoshikawa/rulesync # Should be your fork repository url actually
cd rulesync
pnpm i
pnpm cicheck # Run code style check, type check, and tests

# Manual test using current code
pnpm dev generate -t claudecode -f "*"
pnpm dev import -t claudecode -f "*"

pnpm dev generate
```

## How to add support for a new Tool/Feature

To add support for a new Tool/Feature (e.g., rules), modify these files:

1. `src/features/{feature}/{tool}-{feature}.ts` - create implementation
2. `src/features/{feature}/{tool}-{feature}.test.ts` - create tests
3. `src/types/tool-targets.ts` - add to `ALL_TOOL_TARGETS`
4. `src/types/tool-targets.test.ts` - add to expected targets
5. `src/features/{feature}/{feature}-processor.ts` - register in factory
6. `src/cli/commands/gitignore.ts` - add output file pattern
7. `src/cli/commands/gitignore.test.ts` - update test
8. `README.md` - add to Supported Tools table
9. Run `pnpm dev gitignore` to update project `.gitignore`

See [.rulesync/rules/feature-change-guidelines.md](.rulesync/rules/feature-change-guidelines.md) for additional guidance.

## Local Configuration for Your Preferences

You can create a `rulesync.local.jsonc` file to customize your Rulesync configuration for your personal preferences without affecting the shared project configuration. This file is automatically added to `.gitignore` by `rulesync gitignore` and should not be committed to the repository. See the [Local Configuration](README.md#local-configuration) section in the README for details.

You can also create `.rulesync/rules/overview.local.md` to configure language preferences and other personal rules. For example, if you are a Japanese developer:

```md
---
root: false
targets: ['*']
description: "It's a rule about language. If the rule file exists, you must always follow this."
globs: ["**/*"]
---

I'm a Japanese developer. So you must always answer in Japanese. On the other hand, reasoning(thinking) should be in English to improve token efficiency.

However, this project is for English speaking people. So when you write any code, comments, documentation, commit messages, PR title and PR descriptions, you must always use English.
```

After creating the file, run `pnpm dev generate` to apply your local rules.

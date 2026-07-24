# Contributing

Issues and Pull Requests are welcome!

## Understanding the Codebase

If you're new to the project, you can ask [DeepWiki](https://deepwiki.com/dyoshikawa/rulesync) questions to quickly understand the overall architecture and codebase structure.

## Pull Request Guidelines

- For external contributors, keep the number of added lines in a PR to around 400 lines or fewer. The hard limit is 1,000 lines — PRs exceeding it will be automatically closed by our CI.
- External contributors may have up to 2 open PRs at a time. This limit is automatically enforced — a third PR will be closed by our CI. If you want to open more, please either temporarily close an existing PR or wait until an existing PR has been reviewed by a maintainer.
- Please note that the maintainer may add additional commits on top of your commits before merging at their discretion. In such cases, your original commits will still be preserved as your contribution.
- Before marking your PR as "Ready for Review", use the `review-pr` skill with an AI agent (e.g., Claude Code) in this repository to get automated feedback and address any issues.

## Development Setup

```bash
git clone https://github.com/dyoshikawa/rulesync # Should be your fork repository URL actually
cd rulesync
pnpm i
pnpm cicheck # Run code style check, type check, and tests

# Manual test using current code
pnpm dev generate -t claudecode -f "*"
pnpm dev import -t claudecode -f "*"

pnpm dev generate
```

## How to Add Support for a New Tool/Feature

To add support for a new Tool/Feature (e.g., rules), follow these steps:

1. `src/features/{feature}/{tool}-{feature}.ts` - create implementation.
2. `src/features/{feature}/{tool}-{feature}.test.ts` - create tests.
3. `src/types/tool-target-tuples.ts` - add the target to the feature-specific tuple. `ALL_TOOL_TARGETS` is derived from these tuples. For a brand-new non-legacy target, also register its display metadata in `src/types/tool-display.ts`.
4. Update the feature processor tests. Update the expected targets in `src/types/tool-targets.test.ts` only when adding a brand-new target.
5. `src/features/{feature}/{feature}-processor.ts` - register the implementation in the factory.
6. Define each scope the tool supports through `getSettablePaths`, based on the tool's official documentation. Ordinary project-scope gitignore entries are derived from the paths returned for `global: false`. Only add exceptional third-party by-products, shared trees, or global-only paths to `HAND_MAINTAINED_GITIGNORE_ENTRIES` in `src/cli/commands/gitignore-entries.ts`.
7. Add or preserve end-to-end happy-path coverage for the Tool × Feature combination.
8. Run `pnpm dev gitignore` to update the project `.gitignore`.
9. Run `pnpm run generate:tables` to update the generated supported-tools tables in `README.md` and `docs/reference/supported-tools.md`; do not edit those tables manually.
10. Keep the hand-written file-format documentation synchronized with the implementation, then run `pnpm cicheck`.

See [.rulesync/rules/feature-change-guidelines.md](.rulesync/rules/feature-change-guidelines.md) for additional guidance.

## Local Configuration for Your Preferences

You can create a `rulesync.local.jsonc` file to customize your Rulesync configuration for your personal preferences without affecting the shared project configuration. This file is automatically added to `.gitignore` by `rulesync gitignore` and should not be committed to the repository. See the [Local Configuration](README.md#local-configuration) section in the README for details.

You can also create `.rulesync/rules/overview.local.md` to configure language preferences and other personal rules. For example, if you are a Japanese developer:

```md
---
root: false
localRoot: true
targets: ["*"]
description: "It's a rule about language. If the rule file exists, you must always follow this."
globs: ["**/*"]
---

I'm a Japanese developer. So you must always answer in Japanese. On the other hand, reasoning(thinking) should be in English to improve token efficiency.

However, this project is for English speaking people. So when you write any code, comments, documentation, commit messages, PR title and PR descriptions, you must always use English.
```

After creating the file, run `pnpm dev generate` to apply your local rules.

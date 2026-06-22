---
root: false
targets: ["*"]
description: "When you add or change features, must follow these guidelines."
---

# Guidelines for Adding or Modifying Features

- Check whether `rules-processor.ts` needs an updated Additional Convention, especially values within `additionalConvention`. For example, if you remove support for Cursor's Skill feature simulation, remove `skills: { skillClass: CursorSkill }` within convention entry for Cursor.
- Review frontmatter in both rulesync files (`rulesync-{feature}.ts`) and tool files (`{tool}-{feature}.ts`). For overlapping parameters (e.g., `description`), prefer the rulesync value by default, but if the tool file defines the parameter, that tool-specific value takes precedence.
- Gitignore entries are derived from each tool's `getSettablePaths` in `gitignore-derive.ts`, so they update automatically; only add to `HAND_MAINTAINED_GITIGNORE_ENTRIES` in `gitignore-entries.ts` for paths a tool does not emit itself (third-party by-products, shared or global-only trees). Run `pnpm dev gitignore` to update the project `.gitignore`.
- Consider project scope and global scope support. Simulated support should cover project scope only. For native support, implement both project and global scope when the target tool supports them. Consult the tool’s official documentation to decide scope support.
- The `Supported Tools and Features` matrix in `README.md` and `docs/reference/supported-tools.md` is generated from each feature's `getToolTargets` by `scripts/generate-supported-tools-tables.ts` (run `pnpm run generate:tables`; CI fails on drift), so it never needs manual editing — only keep the `Each File Format` prose synchronized by hand.
- Always preserve the existence of end-to-end happy-path test cases that cover the Tool × Feature matrix.

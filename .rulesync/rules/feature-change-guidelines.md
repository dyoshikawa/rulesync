---
root: false
targets: ["*"]
description: "When you add or change features, must follow these guidelines."
globs: ["**/*"]
---

# Guidelines for Adding or Modifying Features

- Check whether `rules-processor.ts` needs an updated Additional Convention, especially values within `additionalConvention`. For example, if you remove support for Cursor's Skill feature simulation, remove `skills: { skillClass: CursorSkill }` within convention entry for Cursor.
- Review frontmatter in both rulesync files (`rulesync-*.ts`) and tool files (`[toolname]-*.ts`). For overlapping parameters (e.g., `description`), prefer the rulesync value by default, but if the tool file defines the parameter, that tool-specific value takes precedence.
- Evaluate whether `gitignore.ts` needs additions or changes in its generated output. And `pnpm dev gitignore` should be run to update `.gitignore` in the project.
- Consider project scope and global scope support. Simulated support should cover project scope only. For native support, implement both project and global scope when the target tool supports them. Consult the tool’s official documentation to decide scope support.
- Keep the README star table and the `"Each File Format"` section in the README synchronized with the implemented functionality.

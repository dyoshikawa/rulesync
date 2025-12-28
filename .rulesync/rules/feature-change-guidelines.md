---
root: false
targets: ["*"]
description: "Guidelines when adding or changing functionality"
globs: ["**/*"]
---

# Guidelines for Adding or Modifying Features

- Keep the README star table and the “Each File Format” section in the README synchronized with the implemented functionality.
- Check whether `rules-processor.ts` needs an updated Additional Convention, especially the `supportsSimulated` and `supportsGlobal` values within `additionalConvention`.
- Review frontmatter in both rulesync files (`rulesync-*.ts`) and tool files (`[toolname]-*.ts`). For overlapping parameters (e.g., `description`), prefer the rulesync value by default, but if the tool file defines the parameter, that tool-specific value takes precedence.
- Evaluate whether `gitignore.ts` needs additions or changes in its generated output.
- Consider project scope and global scope support. Simulated support should cover project scope only. For native support, implement both project and global scope when the target tool supports them. Consult the tool’s official documentation to decide scope support.

---
root: false
targets: ['*']
description: "coding guides for this project"
globs: ["**/*.ts"]
---

- If the arguments are multiple, you should use object as the argument.
    - Not only function arguments, but also class constructor those.
- Test code files should be placed next to the implementation file.
    - For example, if the implementation file is `src/a.ts`, the test code file should be `src/a.test.ts`.
- If you have to write validation logics, please consider using `zod/mini` to do it actively.   
    - `zod/mini` is a subset of `zod` to minimize the bundle size.
- To import codes, you should always use static imports. You should not use dynamic imports.
    - Because static imports are easier to analyze and optimize by bundlers such as tree-shaking.
- TypeScript file names should be in kebab-case, even for class implementation files.

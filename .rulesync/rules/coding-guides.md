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
- If you have to write validation logics, please consider using `zod` to do it actively.   
    - Precisely, you should consider using `zod/mini` to minimize the bundle size, though.

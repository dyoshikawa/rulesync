---
root: false
targets: ['*']
description: "When you write any code, must follow these guidelines."
globs: ["**/*.ts"]
---

# Coding Guidelines

- If the arguments are multiple, you should use object as the argument.
    - Not only function arguments, but also class constructor those.
- If you have to write validation logics, please consider using `zod/mini` to do it actively.   
    - `zod/mini` is a subset of `zod` to minimize the bundle size.
- To import codes, you should always use static imports. You should not use dynamic imports.
    - Because static imports are easier to analyze and optimize by bundlers such as tree-shaking.
- TypeScript file names should be in kebab-case, even for class implementation files.
- Don't create ballel files. Please always direct import the implementation file.
    - The maintainer thinks that ballel files are harmful to tree-shaking and import path transparency.

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
- The default value of `baseDir` should be `process.cwd()` because it is easier to mock in tests compared to hardcoding `"."`. However, the default value of `relativeDirPath` should be `"."` because it should be relative path to concatenate with `baseDir`.
- When logging errors, you must use `formatError` function in `src/utils/error.ts` to format the error message.
- When writing any path, you must always use `join` function in `node:path` to join the path because it must support both Windows and Unix-like paths.
- When writing Rulesync file paths, you must condsider using constants in `src/constants/rulesync-paths.ts` to avoid hardcoding paths.


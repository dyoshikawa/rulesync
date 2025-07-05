target_dir = $ARGUMENTS

I want to eliminate all `as` assertions except for `as const`. `as` assertions should be avoided as they compromise type safety. If you absolutely must use `as` assertions to pass type checking, you should validate with zod schemas since the value types cannot be guaranteed.

Please execute the following tasks:

1. Search for all occurrences of `as` assertions in `{target_dir}/**/*.ts` files.
    - Exclude test files (`**/*.test.ts`) as type safety is not as critical as in production code.
2. Fix the places using `as` assertions.
    - Replace with `as const` or `satisfies` if they can resolve the issue.
    - If the value format should be validated in the first place, add validation using zod schemas. If zod schemas exist in `src/types/*.ts`, import and use them. If they don't exist, create new zod schemas and type definitions derived with `z.infer()` in `src/types/*.ts`.
3. After fixing, confirm that various checks pass.
     - `pnpm fix`
     - `pnpm test`
4. If there are no issues, commit the changes.

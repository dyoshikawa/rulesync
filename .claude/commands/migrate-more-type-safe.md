target_dir = $ARGUMENTS

I want to eliminate all `as` assertions except for `as const`. `as` assertions should be avoided as they compromise type safety. If you absolutely must use `as` assertions to pass type checking, you should validate with zod schemas since the value types cannot be guaranteed.

Please execute the following tasks:

1. Execute `pnpm exec eslint` on `target_dir/**/*.ts` files to detect locations using `as` assertions.
2. Fix locations using `as` assertions.
    - If solvable using `as const` or `satisfies`, replace with those.
    - If value format should be validated, add validation using zod schemas. If zod schemas exist in `src/types/*.ts`, import and use them. If they don't exist, create new zod schemas and type definitions derived with `z.infer()` in `src/type/*.ts`.
3. After fixes, verify that all checks pass:
     - `pnpm fix`
     - `pnpm test`
4. If there are no issues, commit the changes.

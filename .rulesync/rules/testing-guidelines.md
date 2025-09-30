---
root: false
targets: ["*"]
description: "Testing directory unification rules"
globs: ["**/*.test.ts"]
---

# Testing Guidelines

- Test code files should be placed next to the implementation. This is called the co-location pattern.
    - For example, if the implementation file is `src/a.ts`, the test code file should be `src/a.test.ts`.
- For all test code, where directories are specified for actual file generation, use the unified pattern of targeting `/tmp/tests/projects/{VITEST_WORKER_ID}` as the project directory or `/tmp/tests/home/{VITEST_WORKER_ID}` as the pseudo-home directory.
    - To use the unified test directory, you should use the `setupTestDirectory` function from `src/test-utils/test-directories.ts`. If you want to test some behavior in global mode, use the pseudo-home directory by `setupTestDirectory({ global: true })`.
    ```typescript
    // Example
    describe("Test Name", () => {
      let testDir: string;
      let cleanup: () => Promise<void>;

      beforeEach(async () => {
        ({ testDir, cleanup } = await setupTestDirectory()); // or `setupTestDirectory({ global: true })`
      });

      afterEach(async () => {
        await cleanup();
      });

      it("Test Case", async () => {
        // Run test using testDir
        const subDir = join(testDir, "subdir");
        await ensureDir(subDir);
        // ...
      });
    });
    ```
- When `NODE_ENV` is `test`:
  - All logs by `Logger` in `src/utils/logger.ts` are suppressed.
  - `getHomeDirectory()` in `src/utils/file.ts` returns `/tmp/tests/home/{VITEST_WORKER_ID}`.

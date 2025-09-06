---
root: false
targets: ["*"]
description: "Testing directory unification rules"
globs: ["**/*.test.ts"]
---

# Testing Guidelines

- Test code files should be placed next to the implementation. This is called the co-location pattern.
    - For example, if the implementation file is `src/a.ts`, the test code file should be `src/a.test.ts`.
- For all test code, where directories are specified for actual file generation, use the unified pattern of targeting `/tmp/tests/{random-string}` as the directory.
    - To use the unified test directory, you should use the `setupTestDirectory` function from `src/test-utils/test-directories.ts`.
    ```typescript
    // Example
    describe("Test Name", () => {
      let testDir: string;
      let cleanup: () => Promise<void>;

      beforeEach(async () => {
        ({ testDir, cleanup } = await setupTestDirectory());
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

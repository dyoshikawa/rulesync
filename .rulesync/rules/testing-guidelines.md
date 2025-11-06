---
root: false
targets: ["*"]
description: "Testing directory unification rules"
globs: ["**/*.test.ts"]
---

# Testing Guidelines

- Test code files should be placed next to the implementation. This is called the co-location pattern.
    - For example, if the implementation file is `src/a.ts`, the test code file should be `src/a.test.ts`.
- For all test code, where directories are specified for actual file generation, use the unified pattern of targeting `./tmp/tests/projects/{RANDOM_STRING}` as the project directory or `./tmp/tests/home/{VITEST_WORKER_ID}` as the pseudo-home directory.
    - To use the unified test directory, you should use the `setupTestDirectory` function from `src/test-utils/test-directories.ts` and mock `process.cwd()` to return the test directory. If you want to test some behavior in global mode, use the pseudo-home directory by `setupTestDirectory({ home: true })` and mock `getHomeDirectory()` to return the pseudo-home directory.
    ```typescript
    // Example with project directory
    describe("Test Name", () => {
      let testDir: string;
      let cleanup: () => Promise<void>;

      beforeEach(async () => {
        ({ testDir, cleanup } = await setupTestDirectory());
        vi.spyOn(process, "cwd").mockReturnValue(testDir);
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
    ```typescript
    // Example with pseudo-home directory
    const { getHomeDirectoryMock } = vi.hoisted(() => {
      return {
        getHomeDirectoryMock: vi.fn(),
      }
    })
    vi.mock("src/utils/file.ts", () => ({
      getHomeDirectory: getHomeDirectoryMock,
    }));

    describe("Test Name", () => {
      let testDir: string;
      let cleanup: () => Promise<void>;

      beforeEach(async () => {
        ({ testDir, cleanup } = await setupTestDirectory({ home: true }));
        getHomeDirectoryMock.mockReturnValue(testDir);
      });

      afterEach(async () => {
        await cleanup();
        getHomeDirectoryMock.mockClear();
      });

      it("Test Case", async () => {
        // Run test using testDir
        const subDir = join(testDir, "subdir");
        await ensureDir(subDir);
        // ...
      });
    });
    ```
- In test, don't change dirs or files out of the project directory even though it's in global mode to make it easier to test some behavior and avoid polluting those.
- When `NODE_ENV` is `test`:
  - All logs by `Logger` in `src/utils/logger.ts` are suppressed.
  - `getHomeDirectory()` in `src/utils/file.ts` returns `./tmp/tests/home/{VITEST_WORKER_ID}`.
  - `getBaseDirInLightOfGlobal()` in `src/utils/file.ts` always returns `./{baseDir}` even though it's in global mode.

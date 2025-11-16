# Testing Guidelines

- Test code files should be placed next to the implementation. This is called the co-location pattern.
    - For example, if the implementation file is `src/a.ts`, the test code file should be `src/a.test.ts`.
- For all test code, to avoid polluting the git managed files, must use the unified pattern of targeting ./tmp/tests/projects/{RANDOM_STRING} as the project directory or ./tmp/tests/home/{RANDOM_STRING} as the pseudo-home directory.
    - To use the unified test directory, you should use the `setupTestDirectory` function from `src/test-utils/test-directories.ts` and mock `process.cwd()` to return the test directory. You must not use `process.chdir()` instead of mocking `process.cwd()` because `process.chdir()` changes the current working directory globally and affects other tests. If you want to test some behavior in global mode, use the pseudo-home directory by `setupTestDirectory({ home: true })` and mock `getHomeDirectory()` to return the pseudo-home directory.
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
          await RulesyncRule.fromFile({
            baseDir: testDir,
            relativeFilePath: "test.md",
          });
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
      vi.mock("../utils/file.js", async () => {
        const actual = await vi.importActual<typeof import("../utils/file.js")>("../utils/file.js");
        return {
          ...actual,
          getHomeDirectory: getHomeDirectoryMock,
        };
      });

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
    - Exceptionally, in E2E testing, you can use process.chdir() to change the current working directory to the test directory because E2E tests are intended to simulate conditions that are as close as possible to real user operations.
- In test, don't change dirs or files out of the project directory even though it's in global mode to make it easier to test some behavior and avoid polluting those.
- When `NODE_ENV` is `test`:
  - All logs by `Logger` in `src/utils/logger.ts` are suppressed.
    - When you want to log in test, use `console.log` and run `npx vitest run --silent=false` to see the logs.
  - `getHomeDirectory()` in `src/utils/file.ts` throws an error to enforce explicit mocking.

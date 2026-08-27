import { realpath, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import {
  addTrailingNewline,
  assertDirectoryIfExists,
  assertTreeContainsNoSymlinks,
  assertWritablePathInsideRoot,
  checkPathTraversal,
  createPathResolver,
  directoryExists,
  directoryExistsStrict,
  ensureDir,
  filterOutPathsInGitIgnoredDirectories,
  fileExists,
  fileExistsStrict,
  findFiles,
  findFilesByGlobs,
  findRuleFiles,
  getHomeDirectory,
  isFileNotFoundError,
  isFileSystemError,
  isPresentButUnresolvable,
  listDirectoryFiles,
  listFileNames,
  listSubdirectoryNames,
  readFileBufferOrNull,
  readFileContent,
  readJsonFile,
  removeDirectory,
  removeFile,
  removeTempDirectory,
  runWithDirectoryRollback,
  resolvePath,
  toKebabCaseFilename,
  toPosixPath,
  validateOutputRoot,
  writeFileBuffer,
  writeFileContent,
  writeJsonFile,
} from "./file.js";

describe("file utilities", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("ensureDir", () => {
    it("should create directory if it doesn't exist", async () => {
      const dirPath = join(testDir, "newdir");

      await ensureDir(dirPath);

      expect(await directoryExists(dirPath)).toBe(true);
    });

    it("should not fail if directory already exists", async () => {
      const dirPath = join(testDir, "existingdir");
      await ensureDir(dirPath);

      await expect(ensureDir(dirPath)).resolves.toBeUndefined();
      expect(await directoryExists(dirPath)).toBe(true);
    });
  });

  describe.skipIf(process.platform === "win32")("safe writable paths", () => {
    it("should reject a curated directory that is a symbolic link", async () => {
      const actualDir = join(testDir, "actual");
      const linkedDir = join(testDir, "linked");
      await ensureDir(actualDir);
      await symlink(actualDir, linkedDir);

      await expect(
        assertWritablePathInsideRoot({ rootPath: testDir, targetPath: linkedDir }),
      ).rejects.toThrow("Refusing to write through a symbolic link");
    });

    it("should reject a symbolic link in a writable path's ancestor", async () => {
      const actualDir = join(testDir, "actual");
      const linkedDir = join(testDir, "linked");
      await ensureDir(actualDir);
      await symlink(actualDir, linkedDir);

      await expect(
        assertWritablePathInsideRoot({
          rootPath: testDir,
          targetPath: join(linkedDir, "nested", "rules"),
        }),
      ).rejects.toThrow("Refusing to write through a symbolic link");
    });

    it("should reject a symbolic link nested in a writable tree", async () => {
      const treeDir = join(testDir, "tree");
      const actualFile = join(testDir, "actual.md");
      await ensureDir(treeDir);
      await writeFileContent(actualFile, "content");
      await symlink(actualFile, join(treeDir, "linked.md"));

      await expect(assertTreeContainsNoSymlinks(treeDir)).rejects.toThrow(
        "tree containing a symbolic link",
      );
    });

    it("should reject a file where a writable directory is expected", async () => {
      const filePath = join(testDir, "not-a-directory");
      await writeFileContent(filePath, "content");

      await expect(assertDirectoryIfExists(filePath)).rejects.toThrow("Expected a directory");
    });
  });

  describe("runWithDirectoryRollback", () => {
    it("should restore all directories when an action fails", async () => {
      const skillsDir = join(testDir, "curated-skills");
      const rulesDir = join(testDir, "curated-rules");
      const oldSkillPath = join(skillsDir, "old", "SKILL.md");
      const oldRulePath = join(rulesDir, "old.md");
      await writeFileContent(oldSkillPath, "old skill");
      await writeFileContent(oldRulePath, "old rule");

      await expect(
        runWithDirectoryRollback({
          directoryPaths: [skillsDir, rulesDir],
          action: async () => {
            await removeDirectory(skillsDir);
            await removeDirectory(rulesDir);
            await writeFileContent(join(skillsDir, "new", "SKILL.md"), "new skill");
            await writeFileContent(join(rulesDir, "new.md"), "new rule");
            throw new Error("source failed");
          },
        }),
      ).rejects.toThrow("source failed");

      expect(await readFileContent(oldSkillPath)).toBe("old skill");
      expect(await readFileContent(oldRulePath)).toBe("old rule");
      expect(await fileExists(join(skillsDir, "new", "SKILL.md"))).toBe(false);
      expect(await fileExists(join(rulesDir, "new.md"))).toBe(false);
    });

    it("should preserve the backup when rollback also fails", async () => {
      const parentPath = join(testDir, "blocked-parent");
      const curatedDir = join(parentPath, "curated");
      await writeFileContent(join(curatedDir, "old.md"), "old content");

      let caughtError: unknown;
      try {
        await runWithDirectoryRollback({
          directoryPaths: [curatedDir],
          action: async () => {
            await removeDirectory(parentPath);
            await writeFileContent(parentPath, "blocking file");
            throw new Error("source failed");
          },
        });
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBeInstanceOf(AggregateError);
      const backupPath = (caughtError as Error).message.match(/Backup preserved at (.+)\.$/)?.[1];
      expect(backupPath).toBeDefined();
      expect(await directoryExists(backupPath!)).toBe(true);
      await removeTempDirectory(backupPath!);
    });
  });

  describe("toPosixPath", () => {
    it.each([
      ["backslashes to forward slashes", "packages\\shared\\nested", "packages/shared/nested"],
      ["already POSIX path unchanged", "packages/shared/nested", "packages/shared/nested"],
      ["mixed separators", "packages/shared\\nested", "packages/shared/nested"],
      ["consecutive backslashes", "packages\\\\shared", "packages//shared"],
      ["empty string", "", ""],
      ["single backslash", "\\", "/"],
      ["root-like path", "\\packages\\shared", "/packages/shared"],
    ])("should convert %s", (_label, input, expected) => {
      expect(toPosixPath(input)).toBe(expected);
    });
  });

  describe("addTrailingNewline", () => {
    it("should add newline to content without trailing newline", () => {
      const result = addTrailingNewline("content");
      expect(result).toBe("content\n");
    });

    it("should keep single newline if already present", () => {
      const result = addTrailingNewline("content\n");
      expect(result).toBe("content\n");
    });

    it("should reduce multiple trailing newlines to one", () => {
      const result = addTrailingNewline("content\n\n\n");
      expect(result).toBe("content\n");
    });

    it("should handle empty string", () => {
      const result = addTrailingNewline("");
      expect(result).toBe("\n");
    });

    it("should remove trailing spaces and tabs before newline", () => {
      const result = addTrailingNewline("content  \t  ");
      expect(result).toBe("content\n");
    });

    it("should handle content with mixed trailing whitespace", () => {
      const result = addTrailingNewline("content \n \t\n");
      expect(result).toBe("content\n");
    });

    it("should handle Windows line endings", () => {
      const result = addTrailingNewline("content\r\n");
      expect(result).toBe("content\n");
    });

    it("should normalize Windows line endings throughout the content", () => {
      const result = addTrailingNewline("line1\r\nline2\r\nline3\r\n");
      expect(result).toBe("line1\nline2\nline3\n");
    });

    it("should normalize standalone carriage returns", () => {
      const result = addTrailingNewline("line1\rline2\r");
      expect(result).toBe("line1\nline2\n");
    });

    it("should handle multiple lines with trailing whitespace", () => {
      const result = addTrailingNewline("line1\nline2  \t");
      expect(result).toBe("line1\nline2\n");
    });
  });

  describe("resolvePath", () => {
    it("should return path as-is when no outputRoot provided", () => {
      const path = "some/path";
      expect(resolvePath(path)).toBe(path);
    });

    it("should resolve relative path correctly", () => {
      const resolved = resolvePath("subdir/file.txt", testDir);
      expect(resolved).toBe(resolve(testDir, "subdir/file.txt"));
    });

    it("should prevent path traversal attacks", () => {
      expect(() => resolvePath("../../../etc/passwd", testDir)).toThrow("Path traversal detected");
      expect(() => resolvePath("../outside", testDir)).toThrow("Path traversal detected");
    });

    it("should handle absolute paths safely", () => {
      const absolutePath = join(testDir, "safe", "path");
      const resolved = resolvePath(absolutePath, testDir);
      expect(resolved).toBe(resolve(testDir, absolutePath));
    });
  });

  describe("createPathResolver", () => {
    it("should create a resolver function bound to outputRoot", () => {
      const resolver = createPathResolver(testDir);
      const resolved = resolver("subdir/file.txt");
      expect(resolved).toBe(resolve(testDir, "subdir/file.txt"));
    });

    it("should work without outputRoot", () => {
      const resolver = createPathResolver();
      const path = "some/path";
      expect(resolver(path)).toBe(path);
    });
  });

  describe("JSON file operations", () => {
    let testJsonPath: string;
    const testData = { name: "test", value: 42, nested: { array: [1, 2, 3] } };

    beforeEach(() => {
      testJsonPath = join(testDir, "test.json");
    });

    describe("writeJsonFile", () => {
      it("should write JSON file with default formatting", async () => {
        await writeJsonFile(testJsonPath, testData);

        const content = await readFileContent(testJsonPath);
        expect(content).toContain('"name": "test"');
        expect(JSON.parse(content)).toEqual(testData);
      });

      it("should write JSON file with custom indentation", async () => {
        await writeJsonFile(testJsonPath, testData, 4);

        const content = await readFileContent(testJsonPath);
        expect(content).toContain('    "name": "test"');
      });
    });

    describe("readJsonFile", () => {
      beforeEach(async () => {
        await writeJsonFile(testJsonPath, testData);
      });

      it("should read and parse JSON file correctly", async () => {
        const result = await readJsonFile(testJsonPath);
        expect(result).toEqual(testData);
      });

      it("should return typed result", async () => {
        type TestType = {
          name: string;
          value: number;
        };

        const result = await readJsonFile<TestType>(testJsonPath);
        expect(result.name).toBe("test");
        expect(result.value).toBe(42);
      });

      it("should return default value when file doesn't exist", async () => {
        const defaultValue = { default: true };
        const result = await readJsonFile("nonexistent.json", defaultValue);
        expect(result).toEqual(defaultValue);
      });

      it("should throw error when file doesn't exist and no default provided", async () => {
        await expect(readJsonFile("nonexistent.json")).rejects.toThrow();
      });

      it("should throw error for invalid JSON", async () => {
        await writeFileContent(testJsonPath, "invalid json content");
        await expect(readJsonFile(testJsonPath)).rejects.toThrow();
      });

      it("should return default for invalid JSON when default provided", async () => {
        await writeFileContent(testJsonPath, "invalid json content");
        const defaultValue = { error: "fallback" };
        const result = await readJsonFile(testJsonPath, defaultValue);
        expect(result).toEqual(defaultValue);
      });
    });
  });

  describe("directoryExists", () => {
    it("should return true for existing directory", async () => {
      expect(await directoryExists(testDir)).toBe(true);
    });

    it("should return false for non-existent directory", async () => {
      expect(await directoryExists(join(testDir, "nonexistent"))).toBe(false);
    });

    it("should return false for a file (not directory)", async () => {
      const filePath = join(testDir, "file.txt");
      await writeFileContent(filePath, "content");

      expect(await directoryExists(filePath)).toBe(false);
    });
  });

  describe("file operations", () => {
    describe("readFileContent and writeFileContent", () => {
      let testFilePath: string;
      const testContent = "Hello, World!\nLine 2\n";

      beforeEach(() => {
        testFilePath = join(testDir, "nested", "file.txt");
      });

      it("should write and read file content correctly", async () => {
        await writeFileContent(testFilePath, testContent);

        const content = await readFileContent(testFilePath);
        expect(content).toBe(testContent);
      });

      it("should create nested directories when writing", async () => {
        await writeFileContent(testFilePath, testContent);

        expect(await directoryExists(join(testDir, "nested"))).toBe(true);
        expect(await fileExists(testFilePath)).toBe(true);
      });
    });

    describe("readFileBufferOrNull", () => {
      it("should return null when the file does not exist", async () => {
        expect(await readFileBufferOrNull(join(testDir, "missing", "file.bin"))).toBeNull();
      });

      it("should return the exact bytes of an existing file", async () => {
        const filePath = join(testDir, "binary.bin");
        const fileBuffer = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0xfe]);
        await writeFileBuffer(filePath, fileBuffer);

        const result = await readFileBufferOrNull(filePath);

        expect(result).not.toBeNull();
        expect(result?.equals(fileBuffer)).toBe(true);
      });
    });

    describe("filterOutPathsInGitIgnoredDirectories", () => {
      it("should drop files inside an ignored directory but keep the rest", async () => {
        await writeFileContent(join(testDir, ".gitignore"), "vendored/\n");
        const kept = join(testDir, "packages", "api", "AGENTS.md");
        const dropped = join(testDir, "vendored", "dep", "AGENTS.md");
        await writeFileContent(kept, "keep");
        await writeFileContent(dropped, "drop");

        expect(
          filterOutPathsInGitIgnoredDirectories({ rootDir: testDir, filePaths: [kept, dropped] }),
        ).toEqual([kept]);
      });

      it("should ignore a rule that matches the files themselves", async () => {
        // `rulesync gitignore` writes `**/AGENTS.md` for its own output; testing
        // the files rather than their directories would disable every scan.
        await writeFileContent(join(testDir, ".gitignore"), "**/AGENTS.md\n");
        const filePath = join(testDir, "packages", "api", "AGENTS.md");
        await writeFileContent(filePath, "keep");

        expect(
          filterOutPathsInGitIgnoredDirectories({ rootDir: testDir, filePaths: [filePath] }),
        ).toEqual([filePath]);
      });

      it("should not recurse forever for a path outside the root", () => {
        // `dirname("/")` is `"/"`, so walking ancestors would not terminate.
        expect(
          filterOutPathsInGitIgnoredDirectories({
            rootDir: join(testDir, "nested"),
            filePaths: ["/etc/hostname"],
          }),
        ).toEqual(["/etc/hostname"]);
      });

      it("should keep everything when the project has no ignore rules", async () => {
        const filePath = join(testDir, "packages", "api", "AGENTS.md");
        await writeFileContent(filePath, "keep");

        expect(
          filterOutPathsInGitIgnoredDirectories({ rootDir: testDir, filePaths: [filePath] }),
        ).toEqual([filePath]);
      });
    });

    describe("fileExists", () => {
      it("should return true for existing file", async () => {
        const filePath = join(testDir, "exists.txt");
        await writeFileContent(filePath, "content");

        expect(await fileExists(filePath)).toBe(true);
      });

      it("should return false for non-existent file", async () => {
        expect(await fileExists(join(testDir, "nonexistent.txt"))).toBe(false);
      });

      it("should return true for directory", async () => {
        expect(await fileExists(testDir)).toBe(true);
      });
    });

    describe("isFileNotFoundError", () => {
      it("should recognize an ENOENT error", async () => {
        const error = await readFileContent(join(testDir, "nonexistent.txt")).catch(
          (caught: unknown) => caught,
        );

        expect(isFileNotFoundError(error)).toBe(true);
      });

      it("should recognize an ENOENT error wrapped as a cause", () => {
        const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });

        expect(isFileNotFoundError(new Error("failed to read", { cause: enoent }))).toBe(true);
      });

      it("should reject errors that are not about a missing path", () => {
        expect(isFileNotFoundError(new Error("invalid schema"))).toBe(false);
        expect(isFileNotFoundError(Object.assign(new Error("denied"), { code: "EACCES" }))).toBe(
          false,
        );
        expect(isFileNotFoundError("ENOENT")).toBe(false);
        expect(isFileNotFoundError(undefined)).toBe(false);
      });
    });
  });

  describe("directory listing", () => {
    describe("listDirectoryFiles", () => {
      beforeEach(async () => {
        await writeFileContent(join(testDir, "file1.txt"), "content1");
        await writeFileContent(join(testDir, "file2.md"), "content2");
        await ensureDir(join(testDir, "subdir"));
      });

      it("should list files and directories", async () => {
        const files = await listDirectoryFiles(testDir);

        expect(files).toContain("file1.txt");
        expect(files).toContain("file2.md");
        expect(files).toContain("subdir");
        expect(files).toHaveLength(3);
      });

      it("should return empty array for non-existent directory", async () => {
        const files = await listDirectoryFiles(join(testDir, "nonexistent"));
        expect(files).toEqual([]);
      });
    });

    describe("findFiles", () => {
      beforeEach(async () => {
        await writeFileContent(join(testDir, "file1.md"), "content1");
        await writeFileContent(join(testDir, "file2.txt"), "content2");
        await writeFileContent(join(testDir, "file3.md"), "content3");
      });

      it("should find files with default extension (.md)", async () => {
        const files = await findFiles(testDir);

        expect(files).toHaveLength(2);
        expect(files).toContain(join(testDir, "file1.md"));
        expect(files).toContain(join(testDir, "file3.md"));
      });

      it("should find files with custom extension", async () => {
        const files = await findFiles(testDir, ".txt");

        expect(files).toHaveLength(1);
        expect(files).toContain(join(testDir, "file2.txt"));
      });

      it("should return empty array for non-existent directory", async () => {
        const files = await findFiles(join(testDir, "nonexistent"));
        expect(files).toEqual([]);
      });
    });

    describe("listSubdirectoryNames and listFileNames", () => {
      it("should keep a name containing a backslash, which a glob rewrites", async () => {
        // The bug this exists for: globby reads the backslash as a separator and
        // returns `<root>/back/slash`, whose basename names nothing on disk.
        await ensureDir(join(testDir, "back\\slash"));
        await ensureDir(join(testDir, "plain"));
        await writeFileContent(join(testDir, "back\\slash.md"), "content");

        expect(await listSubdirectoryNames(testDir)).toEqual(["back\\slash", "plain"]);
        expect(await listFileNames(testDir)).toEqual(["back\\slash.md"]);
      });

      it("should follow a symbolic link to a directory by default", async () => {
        const shared = join(testDir, "outside", "shared");
        await ensureDir(shared);
        const root = join(testDir, "root");
        await ensureDir(root);
        await symlink(shared, join(root, "linked"));

        expect(await listSubdirectoryNames(root)).toEqual(["linked"]);
      });

      it("should leave a symbolic link out when told not to follow", async () => {
        const shared = join(testDir, "outside", "shared");
        await ensureDir(shared);
        const root = join(testDir, "root");
        await ensureDir(root);
        await symlink(shared, join(root, "linked"));
        await ensureDir(join(root, "real"));

        expect(await listSubdirectoryNames(root, { followSymbolicLinks: false })).toEqual(["real"]);
      });

      it("should leave out a link that leads nowhere", async () => {
        const root = join(testDir, "root");
        await ensureDir(root);
        await symlink(join(testDir, "gone"), join(root, "dangling"));

        expect(await listSubdirectoryNames(root)).toEqual([]);
        expect(await listFileNames(root)).toEqual([]);
      });

      it("should follow a symbolic link to a file by default and not when told not to", async () => {
        const root = join(testDir, "root");
        await writeFileContent(join(testDir, "outside", "shared.md"), "content");
        await writeFileContent(join(root, "real.md"), "content");
        await symlink(join(testDir, "outside", "shared.md"), join(root, "linked.md"));

        expect(await listFileNames(root)).toEqual(["linked.md", "real.md"]);
        expect(await listFileNames(root, { followSymbolicLinks: false })).toEqual(["real.md"]);
      });

      it("should leave hidden entries out unless asked for them", async () => {
        // The glob these replaced ran with `dot: false`. Callers sweep what they
        // are given, so a `.git` beside the entries must not appear by default.
        const root = join(testDir, "root");
        await ensureDir(join(root, ".git"));
        await ensureDir(join(root, "plain"));
        await writeFileContent(join(root, ".hidden.md"), "content");
        await writeFileContent(join(root, "plain.md"), "content");

        expect(await listSubdirectoryNames(root)).toEqual(["plain"]);
        expect(await listFileNames(root)).toEqual(["plain.md"]);
        expect(await listSubdirectoryNames(root, { includeHidden: true })).toEqual([
          ".git",
          "plain",
        ]);
        expect(await listFileNames(root, { includeHidden: true })).toEqual([
          ".hidden.md",
          "plain.md",
        ]);
      });

      it("should report a directory once when a link beside it stands for it", async () => {
        // `findFilesByGlobs` collapses the paths that resolve to one entry, and a
        // caller that lost that would read the same skill twice. The real name
        // wins over the link, so the entry keeps the name it is stored under.
        const root = join(testDir, "root");
        await ensureDir(join(root, "zzz"));
        await symlink(join(root, "zzz"), join(root, "aaa"));

        expect(await listSubdirectoryNames(root)).toEqual(["zzz"]);
      });

      it("should keep a link whose target is not among the entries", async () => {
        const root = join(testDir, "root");
        await ensureDir(join(root, "real"));
        await ensureDir(join(testDir, "outside", "shared"));
        await symlink(join(testDir, "outside", "shared"), join(root, "linked"));

        expect(await listSubdirectoryNames(root)).toEqual(["linked", "real"]);
      });

      it("should reject a directory it cannot read", async () => {
        await expect(listSubdirectoryNames(join(testDir, "missing"))).rejects.toThrow();
      });
    });

    describe("findFilesByGlobs", () => {
      beforeEach(async () => {
        // Create test files
        await writeFileContent(join(testDir, "file1.md"), "content1");
        await writeFileContent(join(testDir, "file2.txt"), "content2");
        await writeFileContent(join(testDir, "nested", "file3.md"), "content3");
        // Create test directories
        await ensureDir(join(testDir, "emptyDir"));
        await ensureDir(join(testDir, "nested", "subdir"));
      });

      describe("type filtering", () => {
        it("should find only files when type is 'file'", async () => {
          const results = await findFilesByGlobs(join(testDir, "**/*"), { type: "file" });

          expect(results.length).toBeGreaterThan(0);
          expect(results).toContain(join(testDir, "file1.md"));
          expect(results).toContain(join(testDir, "file2.txt"));
          expect(results).toContain(join(testDir, "nested", "file3.md"));
          // Should not contain directories
          expect(results).not.toContain(join(testDir, "emptyDir"));
          expect(results).not.toContain(join(testDir, "nested"));
          expect(results).not.toContain(join(testDir, "nested", "subdir"));
        });

        it("should find only directories when type is 'dir'", async () => {
          const results = await findFilesByGlobs(join(testDir, "**/*"), { type: "dir" });

          expect(results.length).toBeGreaterThan(0);
          expect(results).toContain(join(testDir, "emptyDir"));
          expect(results).toContain(join(testDir, "nested"));
          expect(results).toContain(join(testDir, "nested", "subdir"));
          // Should not contain files
          expect(results).not.toContain(join(testDir, "file1.md"));
          expect(results).not.toContain(join(testDir, "file2.txt"));
          expect(results).not.toContain(join(testDir, "nested", "file3.md"));
        });

        it("should find both files and directories when type is 'all'", async () => {
          const results = await findFilesByGlobs(join(testDir, "**/*"), { type: "all" });

          // Should contain files
          expect(results).toContain(join(testDir, "file1.md"));
          expect(results).toContain(join(testDir, "file2.txt"));
          expect(results).toContain(join(testDir, "nested", "file3.md"));
          // Should also contain directories
          expect(results).toContain(join(testDir, "emptyDir"));
          expect(results).toContain(join(testDir, "nested"));
          expect(results).toContain(join(testDir, "nested", "subdir"));
        });

        it("should default to 'all' when type is not specified", async () => {
          const results = await findFilesByGlobs(join(testDir, "**/*"));

          // Should contain both files and directories
          expect(results).toContain(join(testDir, "file1.md"));
          expect(results).toContain(join(testDir, "emptyDir"));
        });
      });

      describe("glob patterns", () => {
        it("should accept a single glob pattern string", async () => {
          const results = await findFilesByGlobs(join(testDir, "*.md"), { type: "file" });

          expect(results).toHaveLength(1);
          expect(results).toContain(join(testDir, "file1.md"));
        });

        it("should accept an array of glob patterns", async () => {
          const results = await findFilesByGlobs([join(testDir, "*.md"), join(testDir, "*.txt")], {
            type: "file",
          });

          expect(results).toHaveLength(2);
          expect(results).toContain(join(testDir, "file1.md"));
          expect(results).toContain(join(testDir, "file2.txt"));
        });

        it("should find files in nested directories with ** pattern", async () => {
          const results = await findFilesByGlobs(join(testDir, "**/*.md"), { type: "file" });

          expect(results).toHaveLength(2);
          expect(results).toContain(join(testDir, "file1.md"));
          expect(results).toContain(join(testDir, "nested", "file3.md"));
        });
      });

      describe("Windows path normalization", () => {
        it("should normalize Windows-style backslashes to forward slashes for single pattern", async () => {
          // Simulate Windows path with backslashes
          const windowsPattern = testDir.replaceAll("/", "\\") + "\\*.md";
          const results = await findFilesByGlobs(windowsPattern, { type: "file" });

          expect(results).toHaveLength(1);
          expect(results).toContain(join(testDir, "file1.md"));
        });

        it("should normalize Windows-style backslashes in array of patterns", async () => {
          const windowsPatterns = [
            testDir.replaceAll("/", "\\") + "\\*.md",
            testDir.replaceAll("/", "\\") + "\\*.txt",
          ];
          const results = await findFilesByGlobs(windowsPatterns, { type: "file" });

          expect(results).toHaveLength(2);
          expect(results).toContain(join(testDir, "file1.md"));
          expect(results).toContain(join(testDir, "file2.txt"));
        });
      });

      describe("result ordering", () => {
        it("should return sorted results for consistent ordering", async () => {
          const results = await findFilesByGlobs(join(testDir, "**/*.md"), { type: "file" });

          // Results should be sorted alphabetically
          const sortedResults = [...results].toSorted();
          expect(results).toEqual(sortedResults);
        });
      });

      describe("edge cases", () => {
        it("should return empty array when no matches found", async () => {
          const results = await findFilesByGlobs(join(testDir, "*.nonexistent"), { type: "file" });

          expect(results).toEqual([]);
        });

        it("should return absolute paths", async () => {
          const results = await findFilesByGlobs(join(testDir, "*.md"), { type: "file" });

          expect(results.length).toBeGreaterThan(0);
          for (const result of results) {
            expect(result.startsWith("/") || /^[A-Za-z]:/.test(result)).toBe(true);
          }
        });

        it("should skip dot-prefixed entries by default", async () => {
          const dotDir = join(testDir, "dot-default");
          await writeFileContent(join(dotDir, "visible.md"), "visible");
          await writeFileContent(join(dotDir, ".hidden.md"), "hidden");
          await writeFileContent(join(dotDir, ".hidden-dir", "inside.md"), "inside");

          const results = await findFilesByGlobs(join(dotDir, "**/*.md"), { type: "file" });

          expect(results).toEqual([join(dotDir, "visible.md")]);
        });

        it("should include dot-prefixed files and directories when dot is enabled", async () => {
          const dotDir = join(testDir, "dot-enabled");
          await writeFileContent(join(dotDir, "visible.md"), "visible");
          await writeFileContent(join(dotDir, ".hidden.md"), "hidden");
          await writeFileContent(join(dotDir, ".hidden-dir", "inside.md"), "inside");

          const results = await findFilesByGlobs(join(dotDir, "**/*.md"), {
            type: "file",
            dot: true,
          });

          expect(results.toSorted()).toEqual(
            [
              join(dotDir, "visible.md"),
              join(dotDir, ".hidden.md"),
              join(dotDir, ".hidden-dir", "inside.md"),
            ].toSorted(),
          );
        });

        it("should still apply ignore patterns to dot-prefixed entries", async () => {
          const dotDir = join(testDir, "dot-ignored");
          await writeFileContent(join(dotDir, "visible.md"), "visible");
          await writeFileContent(join(dotDir, ".git", "HEAD"), "ref: refs/heads/main");

          const results = await findFilesByGlobs(join(dotDir, "**/*"), {
            type: "file",
            dot: true,
            ignore: ["**/.git/**"],
          });

          expect(results).toEqual([join(dotDir, "visible.md")]);
        });

        // fs.symlink with the default/file type needs admin or Developer Mode on Windows.
        it.skipIf(process.platform === "win32")(
          "should represent a real file by its named alias rather than a hidden one",
          async () => {
            const sharedDir = join(testDir, "alias-shared");
            await writeFileContent(join(sharedDir, "note.md"), "note");
            const aliasDir = join(testDir, "alias-root");
            await ensureDir(aliasDir);
            await symlink(sharedDir, join(aliasDir, ".hidden-link"));
            await symlink(sharedDir, join(aliasDir, "docs"));

            const results = await findFilesByGlobs(join(aliasDir, "**/*"), {
              type: "file",
              dot: true,
            });

            // Both links reach the same file, so only one path is returned; it
            // has to be the named one, which is what a caller asked about.
            expect(results).toEqual([join(aliasDir, "docs", "note.md")]);
          },
        );
      });

      // fs.symlink with the default/file type needs admin or Developer Mode on Windows, so
      // these tests are skipped there (CI unit tests run on ubuntu). See issue #1808 #5.
      describe.skipIf(process.platform === "win32")("symlink support", () => {
        it("should include a symlinked file in results", async () => {
          const realFile = join(testDir, "outside.md");
          const linkedFile = join(testDir, "linked.md");
          await writeFileContent(realFile, "content");
          await symlink(realFile, linkedFile);

          // The link is the only path matching the glob, so nothing else can
          // represent the file it reaches.
          const results = await findFilesByGlobs(join(testDir, "linked*.md"), { type: "file" });

          expect(results).toContain(linkedFile);
        });

        it("should include a symlinked directory and files inside it in results", async () => {
          const realDir = join(testDir, "real-skill");
          await ensureDir(realDir);
          await writeFileContent(join(realDir, "SKILL.md"), "skill content");

          const skillsDir = join(testDir, "skills");
          await ensureDir(skillsDir);
          const linkedDir = join(skillsDir, "linked-skill");
          await symlink(realDir, linkedDir);

          const dirResults = await findFilesByGlobs(join(skillsDir, "*"), { type: "dir" });
          expect(dirResults).toContain(linkedDir);

          const fileResults = await findFilesByGlobs(join(skillsDir, "**", "*.md"), {
            type: "file",
          });
          expect(fileResults).toContain(join(linkedDir, "SKILL.md"));
        });

        it("should not produce duplicated entries when a directory symlink cycle exists", async () => {
          // skills/a contains a real file and a link back to skills/, forming a cycle that
          // globby follows up to the kernel ELOOP limit. Deduplication by real path collapses it.
          const skillsDir = join(testDir, "skills");
          const skillA = join(skillsDir, "a");
          await ensureDir(skillA);
          await writeFileContent(join(skillA, "SKILL.md"), "skill content");
          await symlink(skillsDir, join(skillA, "loop"));

          const fileResults = await findFilesByGlobs(join(skillsDir, "**", "*.md"), {
            type: "file",
          });

          // Exactly one entry survives per real file despite the cycle (no ~40x blowup).
          const uniqueRealPaths = new Set(await Promise.all(fileResults.map((p) => realpath(p))));
          expect(uniqueRealPaths.size).toBe(fileResults.length);
          expect(fileResults.length).toBeLessThan(5);
        });

        it("should represent a file by its real path rather than by a directory alias", async () => {
          // The alias sorts before the real directory, so a representative
          // chosen by sort order alone would hide `zzz` entirely and leave the
          // generated tree without the path the SKILL.md refers to.
          const aliasDir = join(testDir, "real-over-alias");
          const realSubDir = join(aliasDir, "zzz");
          await writeFileContent(join(realSubDir, "x.md"), "content");
          await symlink(realSubDir, join(aliasDir, "aaa"));

          const results = await findFilesByGlobs(join(aliasDir, "**", "*"), {
            type: "file",
            dot: true,
          });

          expect(results).toEqual([join(realSubDir, "x.md")]);
        });

        it("should represent a file by its flat real path rather than through a cycle", async () => {
          // The link name sorts before the file name, so the deepest path the
          // cycle produces would otherwise win and be written out as a real
          // directory chain on generate.
          const cycleDir = join(testDir, "real-over-cycle");
          const nestedDir = join(cycleDir, "sub");
          await writeFileContent(join(nestedDir, "note.md"), "note");
          await symlink(cycleDir, join(nestedDir, "aaa"));

          const results = await findFilesByGlobs(join(cycleDir, "**", "*"), {
            type: "file",
            dot: true,
          });

          expect(results).toEqual([join(nestedDir, "note.md")]);
        });

        it("should return one path when a link and the file it points at sit side by side", async () => {
          const sideBySideDir = join(testDir, "side-by-side");
          const realFile = join(sideBySideDir, "real.md");
          const linkedFile = join(sideBySideDir, "linked.md");
          await writeFileContent(realFile, "content");
          await symlink(realFile, linkedFile);

          const results = await findFilesByGlobs(join(sideBySideDir, "*.md"), { type: "file" });

          // One file is one result, however many names reach it: a discovery glob
          // asks what exists, and reading the same bytes once per link is what a
          // tree of links to one file would otherwise cost. A skill directory,
          // which does carry every name it ships, walks its own tree instead.
          expect(results).toEqual([realFile]);
        });

        it("should represent an aliased path in a subdirectory by the file it points at", async () => {
          const skillDir = join(testDir, "alias-skill");
          const realFile = join(skillDir, "reference.md");
          const docsDir = join(skillDir, "docs");
          await writeFileContent(realFile, "reference");
          await ensureDir(docsDir);
          await symlink(realFile, join(docsDir, "reference.md"));

          const results = await findFilesByGlobs(join(skillDir, "**/*.md"), { type: "file" });

          // The alias resolves to the file above it, so the real path represents
          // it. (A skill that ships both names keeps both: its supporting files
          // come from its own walk, not from here.)
          expect(results).toEqual([realFile]);
        });

        it("should represent a plainly named link by the hidden file it points at", async () => {
          const realFile = join(testDir, ".env.example");
          const aliasFile = join(testDir, "zz-alias.example");
          await writeFileContent(realFile, "TOKEN=");
          await symlink(realFile, aliasFile);

          const results = await findFilesByGlobs(join(testDir, "*.example"), {
            type: "file",
            dot: true,
          });

          // Both names reach one file, and the real one represents it.
          expect(results).toEqual([realFile]);
        });
      });
    });
  });

  describe("findRuleFiles", () => {
    it("should only return files from the rules directory", async () => {
      const aiRulesDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);

      await writeFileContent(join(aiRulesDir, "common.md"), "legacy content");
      await writeFileContent(join(rulesDir, "common.md"), "new content");
      await writeFileContent(join(rulesDir, "new-only.md"), "new only");

      const ruleFiles = await findRuleFiles(aiRulesDir);

      expect(ruleFiles).toEqual([join(rulesDir, "common.md"), join(rulesDir, "new-only.md")]);
    });

    it("should handle missing directories gracefully", async () => {
      const aiRulesDir = join(testDir, "nonexistent");
      const ruleFiles = await findRuleFiles(aiRulesDir);
      expect(ruleFiles).toEqual([]);
    });

    it("should return only new location files when legacy is empty", async () => {
      const aiRulesDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);

      await writeFileContent(join(rulesDir, "rule1.md"), "content1");
      await writeFileContent(join(rulesDir, "rule2.md"), "content2");

      const ruleFiles = await findRuleFiles(aiRulesDir);

      expect(ruleFiles).toHaveLength(2);
      expect(ruleFiles.every((f) => f.includes("/rules/"))).toBe(true);
    });
  });

  describe("file removal", () => {
    describe("removeFile", () => {
      it("should remove existing file", async () => {
        const filePath = join(testDir, "toremove.txt");
        await writeFileContent(filePath, "content");

        expect(await fileExists(filePath)).toBe(true);

        await removeFile(filePath);

        expect(await fileExists(filePath)).toBe(false);
      });

      it("should not fail for non-existent file", async () => {
        const filePath = join(testDir, "nonexistent.txt");
        await expect(removeFile(filePath)).resolves.toBeUndefined();
      });
    });

    describe("removeDirectory", () => {
      it("should remove directory and its contents", async () => {
        const dirPath = join(testDir, "toremove");
        await ensureDir(dirPath);
        await writeFileContent(join(dirPath, "file.txt"), "content");

        expect(await directoryExists(dirPath)).toBe(true);

        await removeDirectory(dirPath);

        expect(await directoryExists(dirPath)).toBe(false);
      });

      it("should prevent removal of dangerous paths", async () => {
        const dangerousPaths = [".", "/", "~", "src", "node_modules", ""];

        for (const path of dangerousPaths) {
          await expect(removeDirectory(path)).resolves.toBeUndefined();
        }
      });

      it("should not fail for non-existent directory", async () => {
        const dirPath = join(testDir, "nonexistent");
        await expect(removeDirectory(dirPath)).resolves.toBeUndefined();
      });
    });
  });

  describe("getHomeDirectory", () => {
    it("should throw error in test environment", () => {
      // getHomeDirectory() must be mocked in test environment
      expect(() => getHomeDirectory()).toThrow(
        "getHomeDirectory() must be mocked in test environment",
      );
    });
  });

  describe("validateOutputRoot", () => {
    describe("should allow safe paths", () => {
      it("should allow simple directory names", () => {
        expect(() => validateOutputRoot("src")).not.toThrow();
        expect(() => validateOutputRoot("config")).not.toThrow();
      });

      it("should allow nested relative paths", () => {
        expect(() => validateOutputRoot("path/to/dir")).not.toThrow();
        expect(() => validateOutputRoot("deeply/nested/path/here")).not.toThrow();
      });

      it("should allow paths with dots in names", () => {
        expect(() => validateOutputRoot(RULESYNC_RELATIVE_DIR_PATH)).not.toThrow();
        expect(() => validateOutputRoot("my.project")).not.toThrow();
      });

      it("should allow absolute paths within current directory", () => {
        // Absolute paths are now allowed as outputRoots are resolved to absolute paths
        const safePath = resolve(testDir, "safe/path");
        expect(() => validateOutputRoot(safePath)).not.toThrow();
      });
    });

    describe("should reject path traversal", () => {
      it("should reject parent directory reference", () => {
        expect(() => validateOutputRoot("..")).toThrow("Path traversal detected");
      });

      it("should reject multiple parent directory references", () => {
        expect(() => validateOutputRoot("../..")).toThrow("Path traversal detected");
        expect(() => validateOutputRoot("../../../../../../etc")).toThrow(
          "Path traversal detected",
        );
      });

      it("should reject path traversal in middle of path", () => {
        expect(() => validateOutputRoot("foo/../bar")).toThrow("Path traversal detected");
        expect(() => validateOutputRoot("path/../../sensitive")).toThrow("Path traversal detected");
      });

      it("should reject path traversal at end", () => {
        expect(() => validateOutputRoot("foo/bar/..")).toThrow("Path traversal detected");
      });
    });

    describe("should reject empty strings", () => {
      it("should reject empty string", () => {
        expect(() => validateOutputRoot("")).toThrow("cannot be an empty string");
      });

      it("should reject whitespace-only strings", () => {
        expect(() => validateOutputRoot("   ")).toThrow("cannot be an empty string");
        expect(() => validateOutputRoot("\t")).toThrow("cannot be an empty string");
        expect(() => validateOutputRoot("\n")).toThrow("cannot be an empty string");
      });
    });

    describe("should accept current-directory shortcuts", () => {
      // These are functionally equivalent to omitting the option. Resolver
      // paths normalize them via `resolve()` before validation, but direct
      // programmatic callers can pass them too — accept them to avoid a
      // surprise breaking change.
      it("should accept `.`", () => {
        expect(() => validateOutputRoot(".")).not.toThrow();
      });

      it("should accept `./`", () => {
        expect(() => validateOutputRoot("./")).not.toThrow();
      });

      it("should accept `.\\`", () => {
        expect(() => validateOutputRoot(".\\")).not.toThrow();
      });
    });

    describe("edge cases", () => {
      it("should handle normalized paths correctly", () => {
        // After normalization, these should be caught
        expect(() => validateOutputRoot("./foo/../../../etc")).toThrow("Path traversal detected");
      });

      it("should allow dot directories that are not parent references", () => {
        expect(() => validateOutputRoot(".config")).not.toThrow();
        expect(() => validateOutputRoot(".local/share")).not.toThrow();
      });
    });

    describe("absolute paths", () => {
      it("should allow normalized absolute paths that do not contain '..' segments", () => {
        expect(() => validateOutputRoot("/usr/local/share")).not.toThrow();
        expect(() => validateOutputRoot("/Users/someone/project")).not.toThrow();
      });

      it("should allow absolute paths outside the current working directory", () => {
        // The traversal check intentionally does not apply to absolute paths
        // (callers may point at anything). This guards against over-eager
        // rejection of legitimate central-rules directories.
        expect(() => validateOutputRoot("/tmp")).not.toThrow();
      });

      it("should reject the filesystem root", () => {
        // The filesystem root is almost certainly a misconfiguration, not a
        // real source directory.
        expect(() => validateOutputRoot("/")).toThrow("must not be the filesystem root");
      });

      it("should reject unnormalized absolute paths containing '..' segments", () => {
        // The defense-in-depth segment check catches `..` first.
        expect(() => validateOutputRoot("/foo/../bar")).toThrow("Path traversal detected");
        expect(() => validateOutputRoot("/foo/../../etc")).toThrow("Path traversal detected");
        expect(() => validateOutputRoot("/..")).toThrow("Path traversal detected");
      });

      it("should reject unnormalized absolute paths with redundant segments", () => {
        // Paths without `..` but still unnormalized (e.g. `//`, `/./`) are
        // rejected by the normalized-equality check.
        expect(() => validateOutputRoot("/foo//bar")).toThrow("must be a normalized absolute path");
        expect(() => validateOutputRoot("/foo/./bar")).toThrow(
          "must be a normalized absolute path",
        );
      });

      it("should accept POSIX absolute paths whose components contain literal backslashes", () => {
        // On POSIX `\` is a regular filename character, not a separator. The
        // segment check intentionally only treats `/` as a separator on POSIX
        // so that legitimate filenames like `/srv/foo\bar` are not falsely
        // rejected. (See platform-aware split in `validateOutputRoot`.) On
        // Windows, the same input would be split on both `/` and `\` and
        // rejected because `..` becomes a segment.
        if (process.platform === "win32") {
          expect(() => validateOutputRoot("/foo\\..\\bar")).toThrow("Path traversal detected");
        } else {
          // On POSIX, the input is `resolve()`-equal to itself (no traversal
          // is collapsed because `\..\` is not a path component), so the
          // normalized-equality check passes too.
          expect(() => validateOutputRoot("/foo\\..\\bar")).not.toThrow();
        }
      });
    });
  });

  describe("toKebabCaseFilename", () => {
    describe("basic conversions", () => {
      it("should convert PascalCase to kebab-case", () => {
        expect(toKebabCaseFilename("CodingGuidelines.md")).toBe("coding-guidelines.md");
        expect(toKebabCaseFilename("MyFile.md")).toBe("my-file.md");
        expect(toKebabCaseFilename("APIReference.md")).toBe("api-reference.md");
      });

      it("should convert camelCase to kebab-case", () => {
        expect(toKebabCaseFilename("codingGuidelines.md")).toBe("coding-guidelines.md");
        expect(toKebabCaseFilename("myFile.md")).toBe("my-file.md");
        expect(toKebabCaseFilename("apiReference.md")).toBe("api-reference.md");
      });

      it("should convert snake_case to kebab-case", () => {
        expect(toKebabCaseFilename("coding_guidelines.md")).toBe("coding-guidelines.md");
        expect(toKebabCaseFilename("my_file.md")).toBe("my-file.md");
        expect(toKebabCaseFilename("api_reference.md")).toBe("api-reference.md");
      });

      it("should convert SCREAMING_SNAKE_CASE to kebab-case", () => {
        expect(toKebabCaseFilename("CODING_GUIDELINES.md")).toBe("coding-guidelines.md");
        expect(toKebabCaseFilename("MY_FILE.md")).toBe("my-file.md");
        expect(toKebabCaseFilename("API_REFERENCE.md")).toBe("api-reference.md");
      });
    });

    describe("mixed formats", () => {
      it("should handle mixed case and underscores", () => {
        // es-toolkit's kebabCase adds hyphens before numbers
        expect(toKebabCaseFilename("API_Guide_v2.md")).toBe("api-guide-v-2.md");
        expect(toKebabCaseFilename("My_CodingStyle.md")).toBe("my-coding-style.md");
      });

      it("should handle spaces", () => {
        expect(toKebabCaseFilename("Coding Guidelines.md")).toBe("coding-guidelines.md");
        expect(toKebabCaseFilename("My File Name.md")).toBe("my-file-name.md");
      });

      it("should handle multiple consecutive separators", () => {
        expect(toKebabCaseFilename("my___file.md")).toBe("my-file.md");
        expect(toKebabCaseFilename("my---file.md")).toBe("my-file.md");
        expect(toKebabCaseFilename("my   file.md")).toBe("my-file.md");
      });
    });

    describe("edge cases", () => {
      it("should preserve already kebab-case filenames", () => {
        expect(toKebabCaseFilename("coding-guidelines.md")).toBe("coding-guidelines.md");
        expect(toKebabCaseFilename("my-file.md")).toBe("my-file.md");
      });

      it("should preserve file extensions", () => {
        expect(toKebabCaseFilename("MyFile.txt")).toBe("my-file.txt");
        // es-toolkit treats everything before the last dot as the name
        expect(toKebabCaseFilename("MyFile.test.ts")).toBe("my-file-test.ts");
        expect(toKebabCaseFilename("MyFile")).toBe("my-file");
      });

      it("should handle filenames with numbers", () => {
        // es-toolkit's kebabCase adds hyphens before numbers
        expect(toKebabCaseFilename("version2.md")).toBe("version-2.md");
        expect(toKebabCaseFilename("File123.md")).toBe("file-123.md");
        expect(toKebabCaseFilename("v2APIGuide.md")).toBe("v-2-api-guide.md");
      });

      it("should remove leading and trailing hyphens", () => {
        expect(toKebabCaseFilename("-MyFile-.md")).toBe("my-file.md");
        expect(toKebabCaseFilename("_MyFile_.md")).toBe("my-file.md");
      });

      it("should handle single word filenames", () => {
        expect(toKebabCaseFilename("README.md")).toBe("readme.md");
        expect(toKebabCaseFilename("file.md")).toBe("file.md");
      });

      it("should handle empty or minimal names", () => {
        // ".md" has no name before extension, so extension becomes the name
        expect(toKebabCaseFilename(".md")).toBe("md");
        expect(toKebabCaseFilename("a.md")).toBe("a.md");
      });
    });

    describe("real-world examples", () => {
      it("should convert typical rule filenames", () => {
        expect(toKebabCaseFilename("CodingGuidelines.md")).toBe("coding-guidelines.md");
        expect(toKebabCaseFilename("TestingStrategy.md")).toBe("testing-strategy.md");
        expect(toKebabCaseFilename("API_Documentation.md")).toBe("api-documentation.md");
        expect(toKebabCaseFilename("ProjectOverview.md")).toBe("project-overview.md");
      });
    });
  });

  describe("checkPathTraversal", () => {
    it("should allow simple relative paths", () => {
      expect(() =>
        checkPathTraversal({ relativePath: "foo.md", intendedRootDir: testDir }),
      ).not.toThrow();
      expect(() =>
        checkPathTraversal({ relativePath: join("sub", "foo.md"), intendedRootDir: testDir }),
      ).not.toThrow();
    });

    it("should allow deeply nested paths", () => {
      expect(() =>
        checkPathTraversal({
          relativePath: join("a", "b", "c", "d", "e", "f.md"),
          intendedRootDir: testDir,
        }),
      ).not.toThrow();
    });

    it("should reject paths with .. segments", () => {
      expect(() =>
        checkPathTraversal({ relativePath: join("..", "escape.md"), intendedRootDir: testDir }),
      ).toThrow("Path traversal detected");
      expect(() =>
        checkPathTraversal({
          relativePath: join("sub", "..", "..", "escape.md"),
          intendedRootDir: testDir,
        }),
      ).toThrow("Path traversal detected");
    });

    it("should reject paths with .. even if they resolve inside root", () => {
      expect(() =>
        checkPathTraversal({
          relativePath: "sub/../file.md",
          intendedRootDir: testDir,
        }),
      ).toThrow("Path traversal detected");
    });
  });

  describe("fileExistsStrict", () => {
    it("should return true for an existing file", async () => {
      const filepath = join(testDir, "present.md");
      await writeFileContent(filepath, "content");

      expect(await fileExistsStrict(filepath)).toBe(true);
    });

    it("should return false for a path that is genuinely absent", async () => {
      expect(await fileExistsStrict(join(testDir, "absent.md"))).toBe(false);
    });

    it("should throw when the path cannot be inspected at all", async () => {
      // A directory used as a parent component makes `stat` fail with ENOTDIR
      // rather than ENOENT, which is the "we cannot tell" case this guards.
      const filepath = join(testDir, "file.md");
      await writeFileContent(filepath, "content");

      await expect(fileExistsStrict(join(filepath, "child.md"))).rejects.toThrow();
    });

    it.skipIf(process.platform === "win32")(
      "should throw for a symlink whose target does not exist",
      async () => {
        const linkPath = join(testDir, "link.md");
        await symlink(join(testDir, "gone.md"), linkPath);

        await expect(fileExistsStrict(linkPath)).rejects.toThrow(
          "is a symbolic link whose target does not exist",
        );
      },
    );
  });

  describe("isPresentButUnresolvable", () => {
    it("should return false for a path that is genuinely absent", async () => {
      expect(await isPresentButUnresolvable(join(testDir, "absent"))).toBe(false);
    });

    it("should return false for a path that resolves", async () => {
      const dirPath = join(testDir, "present");
      await ensureDir(dirPath);

      expect(await isPresentButUnresolvable(dirPath)).toBe(false);
    });

    it.skipIf(process.platform === "win32")(
      "should return true for a symlink whose target does not exist",
      async () => {
        const linkPath = join(testDir, "shared");
        await symlink(join(testDir, "gone"), linkPath);

        expect(await isPresentButUnresolvable(linkPath)).toBe(true);
      },
    );
  });

  describe("isFileSystemError", () => {
    it("should recognize an errno-carrying error", () => {
      expect(isFileSystemError(Object.assign(new Error("denied"), { code: "EACCES" }))).toBe(true);
    });

    it("should recognize an errno buried in the cause chain", () => {
      const cause = Object.assign(new Error("loop"), { code: "ELOOP" });

      expect(isFileSystemError(new Error("could not load", { cause }))).toBe(true);
    });

    it("should not treat a parse failure as a filesystem failure", () => {
      // The whole point of the split: an unparseable file is skipped, an
      // unreadable one fails the run.
      expect(isFileSystemError(new Error("Invalid frontmatter in a.md"))).toBe(false);
    });

    it("should not treat a non-errno code as a filesystem failure", () => {
      expect(isFileSystemError(Object.assign(new Error("nope"), { code: "invalid_value" }))).toBe(
        false,
      );
    });
  });

  describe("directoryExistsStrict", () => {
    it("should return true for an existing directory", async () => {
      const dirPath = join(testDir, "present");
      await ensureDir(dirPath);

      expect(await directoryExistsStrict(dirPath)).toBe(true);
    });

    it("should return false for a path that is genuinely absent", async () => {
      expect(await directoryExistsStrict(join(testDir, "absent"))).toBe(false);
    });

    it("should throw for an existing path that is not a directory", async () => {
      const filepath = join(testDir, "file.md");
      await writeFileContent(filepath, "content");

      // Answering `false` here would put a misconfigured source path back in
      // the same bucket as an empty source tree, which is what the strict
      // variant exists to separate.
      await expect(directoryExistsStrict(filepath)).rejects.toThrow(
        "exists but is not a directory",
      );
    });

    it.skipIf(process.platform === "win32")(
      "should throw for a directory symlink whose target does not exist",
      async () => {
        const linkPath = join(testDir, "shared");
        await symlink(join(testDir, "gone"), linkPath);

        await expect(directoryExistsStrict(linkPath)).rejects.toThrow(
          "is a symbolic link whose target does not exist",
        );
      },
    );
  });
});

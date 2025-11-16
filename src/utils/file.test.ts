import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import {
  addTrailingNewline,
  createPathResolver,
  directoryExists,
  ensureDir,
  fileExists,
  findFiles,
  findRuleFiles,
  getHomeDirectory,
  isFile,
  listDirectoryFiles,
  readFileContent,
  readJsonFile,
  readOrInitializeFileContent,
  removeDirectory,
  removeFile,
  resolvePath,
  validateBaseDir,
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

    it("should handle multiple lines with trailing whitespace", () => {
      const result = addTrailingNewline("line1\nline2  \t");
      expect(result).toBe("line1\nline2\n");
    });
  });

  describe("resolvePath", () => {
    it("should return path as-is when no baseDir provided", () => {
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
    it("should create a resolver function bound to baseDir", () => {
      const resolver = createPathResolver(testDir);
      const resolved = resolver("subdir/file.txt");
      expect(resolved).toBe(resolve(testDir, "subdir/file.txt"));
    });

    it("should work without baseDir", () => {
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

    describe("readOrInitializeFileContent", () => {
      it("should return existing file content if file exists", async () => {
        const filePath = join(testDir, "existing.txt");
        const existingContent = "existing content";
        await writeFileContent(filePath, existingContent);

        const content = await readOrInitializeFileContent(filePath, "initial content");

        expect(content).toBe(existingContent);
      });

      it("should return initial content if file does not exist", async () => {
        const filePath = join(testDir, "nonexistent.txt");
        const initialContent = "initial content";

        const content = await readOrInitializeFileContent(filePath, initialContent);

        expect(content).toBe(initialContent);
      });

      it("should create file with initial content when file does not exist", async () => {
        const filePath = join(testDir, "nonexistent.txt");
        const initialContent = "initial content";

        const content = await readOrInitializeFileContent(filePath, initialContent);

        expect(await fileExists(filePath)).toBe(true);
        expect(content).toBe(initialContent);
        expect(await readFileContent(filePath)).toBe(initialContent);
      });

      it("should create parent directories when file does not exist", async () => {
        const filePath = join(testDir, "nested", "deep", "file.txt");
        const initialContent = "initial content";

        await readOrInitializeFileContent(filePath, initialContent);

        expect(await directoryExists(join(testDir, "nested", "deep"))).toBe(true);
      });

      it("should handle empty existing file", async () => {
        const filePath = join(testDir, "empty.txt");
        await writeFileContent(filePath, "");

        const content = await readOrInitializeFileContent(filePath, "initial content");

        expect(content).toBe("");
      });

      it("should handle empty initial content", async () => {
        const filePath = join(testDir, "new-empty.txt");

        const content = await readOrInitializeFileContent(filePath, "");

        expect(content).toBe("");
      });

      it("should preserve multiline content from existing file", async () => {
        const filePath = join(testDir, "multiline.txt");
        const multilineContent = "line1\nline2\nline3\n";
        await writeFileContent(filePath, multilineContent);

        const content = await readOrInitializeFileContent(filePath, "initial");

        expect(content).toBe(multilineContent);
      });

      it("should handle special characters in file content", async () => {
        const filePath = join(testDir, "special.txt");
        const specialContent = 'content with "quotes" and \n special chars: <>?*|';
        await writeFileContent(filePath, specialContent);

        const content = await readOrInitializeFileContent(filePath, "initial");

        expect(content).toBe(specialContent);
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

    describe("isFile", () => {
      it("should return true for existing file", async () => {
        const filePath = join(testDir, "file.txt");
        await writeFileContent(filePath, "content");

        expect(await isFile(filePath)).toBe(true);
      });

      it("should return false for directory", async () => {
        expect(await isFile(testDir)).toBe(false);
      });

      it("should return false for non-existent file", async () => {
        expect(await isFile(join(testDir, "nonexistent.txt"))).toBe(false);
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
  });

  describe("findRuleFiles", () => {
    it("should prioritize new location over legacy location", async () => {
      const aiRulesDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);

      // Create files in both locations with same name
      await writeFileContent(join(aiRulesDir, "common.md"), "legacy content");
      await writeFileContent(join(rulesDir, "common.md"), "new content");
      await writeFileContent(join(rulesDir, "new-only.md"), "new only");
      await writeFileContent(join(aiRulesDir, "legacy-only.md"), "legacy only");

      const ruleFiles = await findRuleFiles(aiRulesDir);

      expect(ruleFiles).toHaveLength(3);
      expect(ruleFiles).toContain(join(rulesDir, "common.md"));
      expect(ruleFiles).toContain(join(rulesDir, "new-only.md"));
      expect(ruleFiles).toContain(join(aiRulesDir, "legacy-only.md"));

      // Verify new location comes first
      const newFiles = ruleFiles.filter((f) => f.includes("/rules/"));
      const legacyFiles = ruleFiles.filter((f) => !f.includes("/rules/"));
      if (newFiles.length > 0 && legacyFiles.length > 0) {
        expect(ruleFiles.indexOf(newFiles[0]!)).toBeLessThan(ruleFiles.indexOf(legacyFiles[0]!));
      }
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

  describe("validateBaseDir", () => {
    describe("should allow safe paths", () => {
      it("should allow current directory", () => {
        expect(() => validateBaseDir(".")).not.toThrow();
      });

      it("should allow simple directory names", () => {
        expect(() => validateBaseDir("src")).not.toThrow();
        expect(() => validateBaseDir("config")).not.toThrow();
      });

      it("should allow nested relative paths", () => {
        expect(() => validateBaseDir("path/to/dir")).not.toThrow();
        expect(() => validateBaseDir("deeply/nested/path/here")).not.toThrow();
      });

      it("should allow paths with dots in names", () => {
        expect(() => validateBaseDir(RULESYNC_RELATIVE_DIR_PATH)).not.toThrow();
        expect(() => validateBaseDir("my.project")).not.toThrow();
      });

      it("should allow absolute paths within current directory", () => {
        // Absolute paths are now allowed as baseDirs are resolved to absolute paths
        const safePath = resolve(testDir, "safe/path");
        expect(() => validateBaseDir(safePath)).not.toThrow();
      });
    });

    describe("should reject path traversal", () => {
      it("should reject parent directory reference", () => {
        expect(() => validateBaseDir("..")).toThrow("Path traversal detected");
      });

      it("should reject multiple parent directory references", () => {
        expect(() => validateBaseDir("../..")).toThrow("Path traversal detected");
        expect(() => validateBaseDir("../../../../../../etc")).toThrow("Path traversal detected");
      });

      it("should reject path traversal in middle of path", () => {
        expect(() => validateBaseDir("foo/../bar")).toThrow("Path traversal detected");
        expect(() => validateBaseDir("path/../../sensitive")).toThrow("Path traversal detected");
      });

      it("should reject path traversal at end", () => {
        expect(() => validateBaseDir("foo/bar/..")).toThrow("Path traversal detected");
      });
    });

    describe("should reject empty strings", () => {
      it("should reject empty string", () => {
        expect(() => validateBaseDir("")).toThrow("cannot be an empty string");
      });

      it("should reject whitespace-only strings", () => {
        expect(() => validateBaseDir("   ")).toThrow("cannot be an empty string");
        expect(() => validateBaseDir("\t")).toThrow("cannot be an empty string");
        expect(() => validateBaseDir("\n")).toThrow("cannot be an empty string");
      });
    });

    describe("edge cases", () => {
      it("should handle normalized paths correctly", () => {
        // After normalization, these should be caught
        expect(() => validateBaseDir("./foo/../../../etc")).toThrow("Path traversal detected");
      });

      it("should allow dot directories that are not parent references", () => {
        expect(() => validateBaseDir(".config")).not.toThrow();
        expect(() => validateBaseDir(".local/share")).not.toThrow();
      });
    });
  });
});

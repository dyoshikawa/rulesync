import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPathResolver,
  directoryExists,
  ensureDir,
  fileExists,
  findFiles,
  readFileContent,
  readJsonFile,
  removeClaudeGeneratedFiles,
  removeDirectory,
  removeFile,
  resolvePath,
  writeFileContent,
  writeJsonFile,
} from "./file.js";

vi.mock("node:fs/promises");

const mockStat = vi.mocked(stat);
const mockMkdir = vi.mocked(mkdir);
const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockReaddir = vi.mocked(readdir);
const mockRm = vi.mocked(rm);

describe("file utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("ensureDir", () => {
    it("should not create directory if it exists", async () => {
      mockStat.mockResolvedValue({} as never);

      await ensureDir("/existing/dir");

      expect(mockStat).toHaveBeenCalledWith("/existing/dir");
      expect(mockMkdir).not.toHaveBeenCalled();
    });

    it("should create directory if it does not exist", async () => {
      mockStat.mockRejectedValue(new Error("Directory not found"));
      mockMkdir.mockResolvedValue(undefined);

      await ensureDir("/new/dir");

      expect(mockStat).toHaveBeenCalledWith("/new/dir");
      expect(mockMkdir).toHaveBeenCalledWith("/new/dir", { recursive: true });
    });
  });

  describe("readFileContent", () => {
    it("should read file content as UTF-8", async () => {
      const content = "file content";
      mockReadFile.mockResolvedValue(content);

      const result = await readFileContent("/path/to/file.txt");

      expect(mockReadFile).toHaveBeenCalledWith("/path/to/file.txt", "utf-8");
      expect(result).toBe(content);
    });
  });

  describe("writeFileContent", () => {
    it("should ensure directory exists and write file", async () => {
      mockStat.mockResolvedValue({} as never);
      mockWriteFile.mockResolvedValue(undefined);

      await writeFileContent("/path/to/file.txt", "content");

      expect(mockStat).toHaveBeenCalledWith("/path/to");
      expect(mockWriteFile).toHaveBeenCalledWith("/path/to/file.txt", "content", "utf-8");
    });

    it("should create directory if it does not exist", async () => {
      mockStat.mockRejectedValue(new Error("Directory not found"));
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await writeFileContent("/new/path/file.txt", "content");

      expect(mockMkdir).toHaveBeenCalledWith("/new/path", { recursive: true });
      expect(mockWriteFile).toHaveBeenCalledWith("/new/path/file.txt", "content", "utf-8");
    });
  });

  describe("findFiles", () => {
    it("should find files with default .md extension", async () => {
      mockReaddir.mockResolvedValue(["file1.md", "file2.txt", "file3.md"] as never);

      const result = await findFiles("/test/dir");

      expect(mockReaddir).toHaveBeenCalledWith("/test/dir");
      expect(result).toEqual(["/test/dir/file1.md", "/test/dir/file3.md"]);
    });

    it("should find files with custom extension", async () => {
      mockReaddir.mockResolvedValue(["file1.js", "file2.ts", "file3.js"] as never);

      const result = await findFiles("/test/dir", ".js");

      expect(result).toEqual(["/test/dir/file1.js", "/test/dir/file3.js"]);
    });

    it("should return empty array if directory does not exist", async () => {
      mockReaddir.mockRejectedValue(new Error("Directory not found"));

      const result = await findFiles("/nonexistent/dir");

      expect(result).toEqual([]);
    });

    it("should return empty array if no matching files found", async () => {
      mockReaddir.mockResolvedValue(["file1.txt", "file2.js"] as never);

      const result = await findFiles("/test/dir", ".md");

      expect(result).toEqual([]);
    });
  });

  describe("fileExists", () => {
    it("should return true if file exists", async () => {
      mockStat.mockResolvedValue({} as never);

      const result = await fileExists("/path/to/file.txt");

      expect(mockStat).toHaveBeenCalledWith("/path/to/file.txt");
      expect(result).toBe(true);
    });

    it("should return false if file does not exist", async () => {
      mockStat.mockRejectedValue(new Error("File not found"));

      const result = await fileExists("/path/to/nonexistent.txt");

      expect(mockStat).toHaveBeenCalledWith("/path/to/nonexistent.txt");
      expect(result).toBe(false);
    });
  });

  describe("removeDirectory", () => {
    it("should remove directory if it exists", async () => {
      mockStat.mockResolvedValue({} as never);
      mockRm.mockResolvedValue(undefined);

      await removeDirectory("/path/to/dir");

      expect(mockStat).toHaveBeenCalledWith("/path/to/dir");
      expect(mockRm).toHaveBeenCalledWith("/path/to/dir", { recursive: true, force: true });
    });

    it("should do nothing if directory does not exist", async () => {
      mockStat.mockRejectedValue(new Error("Directory not found"));

      await removeDirectory("/path/to/nonexistent");

      expect(mockStat).toHaveBeenCalledWith("/path/to/nonexistent");
      expect(mockRm).not.toHaveBeenCalled();
    });

    it("should handle removal errors gracefully", async () => {
      mockStat.mockResolvedValue({} as never);
      mockRm.mockRejectedValue(new Error("Permission denied"));

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await removeDirectory("/path/to/dir");

      expect(mockRm).toHaveBeenCalledWith("/path/to/dir", { recursive: true, force: true });
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to remove directory /path/to/dir:",
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });

    it("should skip dangerous paths", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await removeDirectory(".");
      await removeDirectory("/");
      await removeDirectory("src");

      expect(consoleSpy).toHaveBeenCalledWith("Skipping deletion of dangerous path: .");
      expect(consoleSpy).toHaveBeenCalledWith("Skipping deletion of dangerous path: /");
      expect(consoleSpy).toHaveBeenCalledWith("Skipping deletion of dangerous path: src");
      expect(mockRm).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should skip empty path", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await removeDirectory("");

      expect(consoleSpy).toHaveBeenCalledWith("Skipping deletion of dangerous path: ");
      expect(mockRm).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("removeFile", () => {
    it("should remove file if it exists", async () => {
      mockStat.mockResolvedValue({} as never);
      mockRm.mockResolvedValue(undefined);

      await removeFile("/path/to/file.txt");

      expect(mockStat).toHaveBeenCalledWith("/path/to/file.txt");
      expect(mockRm).toHaveBeenCalledWith("/path/to/file.txt");
    });

    it("should do nothing if file does not exist", async () => {
      mockStat.mockRejectedValue(new Error("File not found"));

      await removeFile("/path/to/nonexistent.txt");

      expect(mockStat).toHaveBeenCalledWith("/path/to/nonexistent.txt");
      expect(mockRm).not.toHaveBeenCalled();
    });

    it("should handle removal errors gracefully", async () => {
      mockStat.mockResolvedValue({} as never);
      mockRm.mockRejectedValue(new Error("Permission denied"));

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await removeFile("/path/to/file.txt");

      expect(mockRm).toHaveBeenCalledWith("/path/to/file.txt");
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to remove file /path/to/file.txt:",
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  describe("removeClaudeGeneratedFiles", () => {
    it("should remove CLAUDE.md file and .claude/memories directory", async () => {
      mockStat.mockResolvedValue({} as never);
      mockRm.mockResolvedValue(undefined);

      await removeClaudeGeneratedFiles();

      expect(mockRm).toHaveBeenCalledWith("CLAUDE.md");
      expect(mockRm).toHaveBeenCalledWith(".claude/memories", { recursive: true, force: true });
    });

    it("should handle non-existent files gracefully", async () => {
      mockStat.mockRejectedValue(new Error("File not found"));

      await removeClaudeGeneratedFiles();

      // Should call stat for both files but not rm since they don't exist
      expect(mockStat).toHaveBeenCalledWith("CLAUDE.md");
      expect(mockStat).toHaveBeenCalledWith(".claude/memories");
      expect(mockRm).not.toHaveBeenCalled();
    });
  });

  describe("resolvePath", () => {
    it("should return relative path when no base directory provided", () => {
      expect(resolvePath("test.txt")).toBe("test.txt");
      expect(resolvePath("subdir/test.txt")).toBe("subdir/test.txt");
    });

    it("should join path with base directory", () => {
      expect(resolvePath("test.txt", "/base")).toBe("/base/test.txt");
      expect(resolvePath("subdir/test.txt", "/base")).toBe("/base/subdir/test.txt");
    });
  });

  describe("createPathResolver", () => {
    it("should create a path resolver function", () => {
      const resolver = createPathResolver("/base");
      expect(resolver("test.txt")).toBe("/base/test.txt");
      expect(resolver("subdir/test.txt")).toBe("/base/subdir/test.txt");
    });

    it("should create a path resolver without base directory", () => {
      const resolver = createPathResolver();
      expect(resolver("test.txt")).toBe("test.txt");
      expect(resolver("subdir/test.txt")).toBe("subdir/test.txt");
    });
  });

  describe("readJsonFile", () => {
    it("should read and parse JSON file", async () => {
      const jsonContent = '{"key": "value"}';
      mockReadFile.mockResolvedValue(jsonContent);

      const result = await readJsonFile("/path/to/file.json");

      expect(mockReadFile).toHaveBeenCalledWith("/path/to/file.json", "utf-8");
      expect(result).toEqual({ key: "value" });
    });

    it("should return default value when file read fails", async () => {
      mockReadFile.mockRejectedValue(new Error("File not found"));
      const defaultValue = { default: true };

      const result = await readJsonFile("/path/to/nonexistent.json", defaultValue);

      expect(result).toEqual(defaultValue);
    });

    it("should throw error when no default value provided and file read fails", async () => {
      mockReadFile.mockRejectedValue(new Error("File not found"));

      await expect(readJsonFile("/path/to/nonexistent.json")).rejects.toThrow("File not found");
    });

    it("should throw error when JSON parsing fails and no default provided", async () => {
      mockReadFile.mockResolvedValue("invalid json");

      await expect(readJsonFile("/path/to/invalid.json")).rejects.toThrow();
    });

    it("should return default value when JSON parsing fails", async () => {
      mockReadFile.mockResolvedValue("invalid json");
      const defaultValue = { default: true };

      const result = await readJsonFile("/path/to/invalid.json", defaultValue);

      expect(result).toEqual(defaultValue);
    });
  });

  describe("writeJsonFile", () => {
    it("should write JSON file with default indentation", async () => {
      mockStat.mockResolvedValue({} as never);
      mockWriteFile.mockResolvedValue(undefined);

      const data = { key: "value" };
      await writeJsonFile("/path/to/file.json", data);

      expect(mockWriteFile).toHaveBeenCalledWith(
        "/path/to/file.json",
        JSON.stringify(data, null, 2),
        "utf-8",
      );
    });

    it("should write JSON file with custom indentation", async () => {
      mockStat.mockResolvedValue({} as never);
      mockWriteFile.mockResolvedValue(undefined);

      const data = { key: "value" };
      await writeJsonFile("/path/to/file.json", data, 4);

      expect(mockWriteFile).toHaveBeenCalledWith(
        "/path/to/file.json",
        JSON.stringify(data, null, 4),
        "utf-8",
      );
    });
  });

  describe("directoryExists", () => {
    it("should return true if directory exists", async () => {
      mockStat.mockResolvedValue({ isDirectory: () => true } as never);

      const result = await directoryExists("/path/to/dir");

      expect(mockStat).toHaveBeenCalledWith("/path/to/dir");
      expect(result).toBe(true);
    });

    it("should return false if path exists but is not a directory", async () => {
      mockStat.mockResolvedValue({ isDirectory: () => false } as never);

      const result = await directoryExists("/path/to/file.txt");

      expect(mockStat).toHaveBeenCalledWith("/path/to/file.txt");
      expect(result).toBe(false);
    });

    it("should return false if path does not exist", async () => {
      mockStat.mockRejectedValue(new Error("Path not found"));

      const result = await directoryExists("/path/to/nonexistent");

      expect(mockStat).toHaveBeenCalledWith("/path/to/nonexistent");
      expect(result).toBe(false);
    });
  });
});

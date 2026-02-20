import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_IGNORE_YAML_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, readFileContent, writeFileContent } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import { AugmentcodeIgnore } from "./augmentcode-ignore.js";
import { ClaudecodeIgnore } from "./claudecode-ignore.js";
import { ClineIgnore } from "./cline-ignore.js";
import { CursorIgnore } from "./cursor-ignore.js";
import { GeminiCliIgnore } from "./geminicli-ignore.js";
import { IgnoreProcessor } from "./ignore-processor.js";
import { JunieIgnore } from "./junie-ignore.js";
import { KiroIgnore } from "./kiro-ignore.js";
import { QwencodeIgnore } from "./qwencode-ignore.js";
import { RooIgnore } from "./roo-ignore.js";
import { RulesyncIgnoreYaml } from "./rulesync-ignore-yaml.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore } from "./tool-ignore.js";
import { WindsurfIgnore } from "./windsurf-ignore.js";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Create a mock class for RulesyncIgnore
class MockRulesyncIgnore {
  constructor(public params: any) {}
}

vi.mock("./rulesync-ignore.js", () => ({
  RulesyncIgnore: vi.fn().mockImplementation((params: any) => new MockRulesyncIgnore(params)),
}));

// Add a static fromFile method to the mock
const RulesyncIgnoreMock = vi.mocked(RulesyncIgnore);
(RulesyncIgnoreMock as any).fromFile = vi.fn();

describe("IgnoreProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with default baseDir", () => {
      const processor = new IgnoreProcessor({
        toolTarget: "cursor",
      });

      expect(processor).toBeInstanceOf(IgnoreProcessor);
    });

    it("should create instance with custom baseDir", () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      expect(processor).toBeInstanceOf(IgnoreProcessor);
    });

    it("should validate toolTarget parameter", () => {
      expect(() => {
        const _instance = new IgnoreProcessor({
          baseDir: testDir,
          toolTarget: "invalid-target" as any,
        });
      }).toThrow();
    });

    it("should accept all valid tool targets", () => {
      const validTargets = [
        "augmentcode",
        "claudecode",
        "claudecode-legacy",
        "cline",
        "cursor",
        "geminicli",
        "junie",
        "kiro",
        "qwencode",
        "roo",
        "windsurf",
      ] as const;

      for (const target of validTargets) {
        expect(() => {
          const _instance = new IgnoreProcessor({
            baseDir: testDir,
            toolTarget: target,
          });
        }).not.toThrow();
      }
    });
  });

  describe("loadRulesyncFiles", () => {
    it("should load rulesync ignore file when it exists", async () => {
      const mockRulesyncIgnore = new MockRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.log\nnode_modules/",
      });

      (RulesyncIgnoreMock as any).fromFile.mockResolvedValue(mockRulesyncIgnore as any);

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const files = await processor.loadRulesyncFiles();
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(mockRulesyncIgnore);
    });

    it("should return empty array when no rulesync ignore file exists", async () => {
      (RulesyncIgnoreMock as any).fromFile.mockRejectedValue(new Error("File not found"));

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const files = await processor.loadRulesyncFiles();
      expect(files).toHaveLength(0);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load rulesync ignore file"),
      );
    });
  });

  describe("loadToolFiles", () => {
    it("should load tool ignore files when they exist", async () => {
      // Create .cursorignore file
      await writeFileContent(join(testDir, ".cursorignore"), "*.log\nnode_modules/");

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const files = await processor.loadToolFiles();
      expect(files).toHaveLength(1);
      expect(files[0]).toBeInstanceOf(CursorIgnore);
    });

    it("should return empty array when no tool files exist", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const files = await processor.loadToolFiles();
      expect(files).toHaveLength(0);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load tool files"),
      );
    });
  });

  describe("loadToolIgnores", () => {
    it("should load AugmentcodeIgnore for augmentcode target", async () => {
      await writeFileContent(join(testDir, ".augmentignore"), "*.log\nnode_modules/");

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "augmentcode",
      });

      const ignores = await processor.loadToolIgnores();
      expect(ignores).toHaveLength(1);
      expect(ignores[0]).toBeInstanceOf(AugmentcodeIgnore);
    });

    it("should load ClineIgnore for cline target", async () => {
      await writeFileContent(join(testDir, ".clineignore"), "*.log\nnode_modules/");

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cline",
      });

      const ignores = await processor.loadToolIgnores();
      expect(ignores).toHaveLength(1);
      expect(ignores[0]).toBeInstanceOf(ClineIgnore);
    });

    it("should load CursorIgnore for cursor target", async () => {
      await writeFileContent(join(testDir, ".cursorignore"), "*.log\nnode_modules/");

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const ignores = await processor.loadToolIgnores();
      expect(ignores).toHaveLength(1);
      expect(ignores[0]).toBeInstanceOf(CursorIgnore);
    });

    it("should load GeminiCliIgnore for geminicli target", async () => {
      await writeFileContent(join(testDir, ".geminiignore"), "*.log\nnode_modules/");

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "geminicli",
      });

      const ignores = await processor.loadToolIgnores();
      expect(ignores).toHaveLength(1);
      expect(ignores[0]).toBeInstanceOf(GeminiCliIgnore);
    });

    it("should load JunieIgnore for junie target", async () => {
      await writeFileContent(join(testDir, ".aiignore"), "*.log\nnode_modules/");

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "junie",
      });

      const ignores = await processor.loadToolIgnores();
      expect(ignores).toHaveLength(1);
      expect(ignores[0]).toBeInstanceOf(JunieIgnore);
    });

    it("should load KiroIgnore for kiro target", async () => {
      await writeFileContent(join(testDir, ".aiignore"), "*.log\nnode_modules/");

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "kiro",
      });

      const ignores = await processor.loadToolIgnores();
      expect(ignores).toHaveLength(1);
      expect(ignores[0]).toBeInstanceOf(KiroIgnore);
    });

    it("should load QwencodeIgnore for qwencode target", async () => {
      await writeFileContent(join(testDir, ".geminiignore"), "*.log\nnode_modules/");

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "qwencode",
      });

      const ignores = await processor.loadToolIgnores();
      expect(ignores).toHaveLength(1);
      expect(ignores[0]).toBeInstanceOf(QwencodeIgnore);
    });

    it("should load RooIgnore for roo target", async () => {
      await writeFileContent(join(testDir, ".rooignore"), "*.log\nnode_modules/");

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "roo",
      });

      const ignores = await processor.loadToolIgnores();
      expect(ignores).toHaveLength(1);
      expect(ignores[0]).toBeInstanceOf(RooIgnore);
    });

    it("should load WindsurfIgnore for windsurf target", async () => {
      await writeFileContent(join(testDir, ".codeiumignore"), "*.log\nnode_modules/");

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "windsurf",
      });

      const ignores = await processor.loadToolIgnores();
      expect(ignores).toHaveLength(1);
      expect(ignores[0]).toBeInstanceOf(WindsurfIgnore);
    });

    it("should throw error for unsupported tool target", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      // Mock the toolTarget property to an unsupported value
      (processor as any).toolTarget = "unsupported";

      await expect(() => processor.loadToolIgnores()).rejects.toThrow(
        "Unsupported tool target: unsupported",
      );
    });
  });

  describe("convertRulesyncFilesToToolFiles", () => {
    it("should convert rulesync ignore to tool ignores for all targets", async () => {
      // Create a mock that extends RulesyncIgnore so instanceof works
      const mockRulesyncIgnore = Object.create(RulesyncIgnore.prototype);
      Object.assign(mockRulesyncIgnore, {
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.log\nnode_modules/",
        getFileContent: () => "*.log\nnode_modules/",
      });

      const targets = [
        "augmentcode",
        "cline",
        "cursor",
        "geminicli",
        "junie",
        "kiro",
        "qwencode",
        "roo",
        "windsurf",
      ] as const;

      for (const target of targets) {
        const processor = new IgnoreProcessor({
          baseDir: testDir,
          toolTarget: target,
        });

        const toolFiles = await processor.convertRulesyncFilesToToolFiles([mockRulesyncIgnore]);
        expect(toolFiles).toHaveLength(1);
        expect(toolFiles[0]).toBeInstanceOf(ToolIgnore);
      }
    });

    it("should throw error when no rulesync ignore found", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      await expect(processor.convertRulesyncFilesToToolFiles([])).rejects.toThrow(
        "No .rulesync/.aiignore found.",
      );
    });

    it("should throw error for unsupported tool target in conversion", async () => {
      const mockRulesyncIgnore = Object.create(RulesyncIgnore.prototype);
      Object.assign(mockRulesyncIgnore, {
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.log\nnode_modules/",
        getFileContent: () => "*.log\nnode_modules/",
      });

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      // Mock the toolTarget property to an unsupported value
      (processor as any).toolTarget = "unsupported";

      await expect(processor.convertRulesyncFilesToToolFiles([mockRulesyncIgnore])).rejects.toThrow(
        "Unsupported tool target: unsupported",
      );
    });
  });

  describe("convertToolFilesToRulesyncFiles", () => {
    it("should convert tool ignores to ignore.yaml rulesync files", async () => {
      const cursorIgnore = new CursorIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent: "*.log\nnode_modules/",
      });
      const mockRulesyncIgnore = {
        getFileContent: () => "*.log\nnode_modules/",
      } as unknown as RulesyncIgnore;
      vi.spyOn(cursorIgnore, "toRulesyncIgnore").mockReturnValue(mockRulesyncIgnore);

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles([cursorIgnore]);
      expect(rulesyncFiles).toHaveLength(1);
      expect(rulesyncFiles[0]).toBeInstanceOf(RulesyncIgnoreYaml);
      expect(rulesyncFiles[0]?.getRelativePathFromCwd()).toBe(
        RULESYNC_IGNORE_YAML_RELATIVE_FILE_PATH,
      );
      expect(rulesyncFiles[0]?.getFileContent()).toContain("version: 1");
      expect(rulesyncFiles[0]?.getFileContent()).toContain("path: '*.log'");
    });

    it("should filter out non-ToolIgnore files", async () => {
      const mockFile = {
        getFilePath: () => "/path/to/file",
      } as any;

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles([mockFile]);
      expect(rulesyncFiles).toHaveLength(0);
    });
  });

  describe("writeToolIgnoresFromRulesyncIgnores", () => {
    it("should convert and write tool ignores from rulesync ignores", async () => {
      const mockRulesyncIgnore = Object.create(RulesyncIgnore.prototype);
      Object.assign(mockRulesyncIgnore, {
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.log\nnode_modules/",
        getFileContent: () => "*.log\nnode_modules/",
      });

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      // Mock the writeAiFiles method
      const writeAiFilesSpy = vi.spyOn(processor as any, "writeAiFiles");
      writeAiFilesSpy.mockResolvedValue(undefined);

      await processor.writeToolIgnoresFromRulesyncIgnores([mockRulesyncIgnore]);

      expect(writeAiFilesSpy).toHaveBeenCalledTimes(1);
      expect(writeAiFilesSpy).toHaveBeenCalledWith(
        expect.arrayContaining([expect.any(ToolIgnore)]),
      );
    });
  });

  describe("getToolTargets", () => {
    it("should return all supported tool targets", () => {
      const toolTargets = IgnoreProcessor.getToolTargets();
      const expectedTargets = [
        "augmentcode",
        "claudecode",
        "claudecode-legacy",
        "cline",
        "cursor",
        "geminicli",
        "junie",
        "kilo",
        "kiro",
        "qwencode",
        "roo",
        "windsurf",
        "zed",
      ];

      expect(toolTargets).toEqual(expectedTargets);
    });
  });

  describe("loadToolFiles with forDeletion: true", () => {
    it("should filter out non-deletable files when loading for deletion", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude", "settings.local.json"),
        JSON.stringify({
          permissions: {
            deny: ["Read(*.secret)", "Read(*.env)"],
          },
        }),
      );

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Load all tool files (should include ClaudecodeIgnore)
      const allFiles = await processor.loadToolFiles();
      expect(allFiles).toHaveLength(1);
      expect(allFiles[0]?.isDeletable()).toBe(false);

      // Load tool files for deletion (should exclude non-deletable files)
      const filesToDelete = await processor.loadToolFiles({ forDeletion: true });
      expect(filesToDelete).toHaveLength(0);
    });

    it("should treat claudecode-legacy ignore files the same as claudecode", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude", "settings.local.json"),
        JSON.stringify({
          permissions: {
            deny: ["Read(*.secret)", "Read(*.env)"],
          },
        }),
      );

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "claudecode-legacy",
      });

      const allFiles = await processor.loadToolFiles();
      expect(allFiles).toHaveLength(1);
      expect(allFiles[0]).toBeInstanceOf(ClaudecodeIgnore);
      expect(allFiles[0]?.isDeletable()).toBe(false);

      const filesToDelete = await processor.loadToolFiles({ forDeletion: true });
      expect(filesToDelete).toHaveLength(0);
    });

    it("should return deletable files with correct paths", async () => {
      await writeFileContent(join(testDir, ".cursorignore"), "*.log\nnode_modules/");

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const filesToDelete = await processor.loadToolFiles({ forDeletion: true });

      // CursorIgnore is deletable, so should return the file
      expect(filesToDelete).toHaveLength(1);
      expect(filesToDelete[0]?.isDeletable()).toBe(true);
      expect(filesToDelete[0]?.getRelativeFilePath()).toBe(".cursorignore");
    });

    it("should return instance for standard path even when file does not exist on disk", async () => {
      // No file created on disk
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const filesToDelete = await processor.loadToolFiles({ forDeletion: true });

      // forDeletion creates an instance for the standard path regardless of file existence
      // The actual deletion logic handles checking if the file exists
      expect(filesToDelete).toHaveLength(1);
      expect(filesToDelete[0]?.getRelativeFilePath()).toBe(".cursorignore");
    });
  });

  describe("writeAiFiles with trailing newlines", () => {
    it("should write ignore files with exactly one trailing newline", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      // Create a mock CursorIgnore file
      const mockCursorIgnore = new CursorIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent: "*.log\nnode_modules/\n*.tmp",
      });

      // Write the file using writeAiFiles
      await processor.writeAiFiles([mockCursorIgnore]);

      // Read the generated file directly to check for trailing newline
      const cursorIgnorePath = join(testDir, ".cursorignore");
      const content = await readFileContent(cursorIgnorePath);

      // Check that file ends with exactly one newline
      expect(content).toMatch(/[^\n]\n$/);
      expect(content).not.toMatch(/\n\n$/);

      // Check content is preserved correctly
      expect(content).toBe("*.log\nnode_modules/\n*.tmp\n");
    });

    it("should handle files already ending with newline", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cline",
      });

      // Create a mock ClineIgnore file with trailing newline
      const mockClineIgnore = new ClineIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        fileContent: "*.log\nnode_modules/\n",
      });

      // Write the file using writeAiFiles
      await processor.writeAiFiles([mockClineIgnore]);

      const clineIgnorePath = join(testDir, ".clineignore");
      const content = await readFileContent(clineIgnorePath);

      // Should still have exactly one trailing newline
      expect(content).toBe("*.log\nnode_modules/\n");
      expect(content).not.toMatch(/\n\n$/);
    });

    it("should handle files with multiple trailing newlines", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "windsurf",
      });

      // Create a mock WindsurfIgnore file with multiple trailing newlines
      const mockWindsurfIgnore = new WindsurfIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".windsurfignore",
        fileContent: "*.log\n\n\n",
      });

      // Write the file using writeAiFiles
      await processor.writeAiFiles([mockWindsurfIgnore]);

      const windsurfIgnorePath = join(testDir, ".windsurfignore");
      const content = await readFileContent(windsurfIgnorePath);

      // Should have exactly one trailing newline
      expect(content).toBe("*.log\n");
      expect(content).not.toMatch(/\n\n$/);
    });
  });
});

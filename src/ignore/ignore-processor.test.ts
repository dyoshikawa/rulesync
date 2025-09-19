import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { AugmentcodeIgnore } from "./augmentcode-ignore.js";
import { ClineIgnore } from "./cline-ignore.js";
import { CodexcliIgnore } from "./codexcli-ignore.js";
import { CursorIgnore } from "./cursor-ignore.js";
import { GeminiCliIgnore } from "./geminicli-ignore.js";
import { IgnoreProcessor } from "./ignore-processor.js";
import { JunieIgnore } from "./junie-ignore.js";
import { KiroIgnore } from "./kiro-ignore.js";
import { QwencodeIgnore } from "./qwencode-ignore.js";
import { RooIgnore } from "./roo-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore } from "./tool-ignore.js";
import { WindsurfIgnore } from "./windsurf-ignore.js";

vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
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
RulesyncIgnoreMock.fromFile = vi.fn();

describe("IgnoreProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await cleanup();
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
        "amazonqcli",
        "augmentcode",
        "cline",
        "codexcli",
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
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesyncignore",
        fileContent: "*.log\nnode_modules/",
      });

      RulesyncIgnoreMock.fromFile.mockResolvedValue(mockRulesyncIgnore as any);

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const files = await processor.loadRulesyncFiles();
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(mockRulesyncIgnore);
    });

    it("should return empty array when no rulesync ignore file exists", async () => {
      RulesyncIgnoreMock.fromFile.mockRejectedValue(new Error("File not found"));

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const files = await processor.loadRulesyncFiles();
      expect(files).toHaveLength(0);
      expect(logger.debug).toHaveBeenCalledWith("No rulesync files found", expect.any(Error));
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
      expect(logger.debug).toHaveBeenCalledWith("No tool files found", expect.any(Error));
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

    it("should load CodexcliIgnore for codexcli target", async () => {
      await writeFileContent(join(testDir, ".codexignore"), "*.log\nnode_modules/");

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "codexcli",
      });

      const ignores = await processor.loadToolIgnores();
      expect(ignores).toHaveLength(1);
      expect(ignores[0]).toBeInstanceOf(CodexcliIgnore);
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
      await writeFileContent(join(testDir, ".aiexclude"), "*.log\nnode_modules/");

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "geminicli",
      });

      const ignores = await processor.loadToolIgnores();
      expect(ignores).toHaveLength(1);
      expect(ignores[0]).toBeInstanceOf(GeminiCliIgnore);
    });

    it("should load JunieIgnore for junie target", async () => {
      await writeFileContent(join(testDir, ".junieignore"), "*.log\nnode_modules/");

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
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesyncignore",
        fileContent: "*.log\nnode_modules/",
        getFileContent: () => "*.log\nnode_modules/",
      });

      const targets = [
        "amazonqcli",
        "augmentcode",
        "cline",
        "codexcli",
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
        "No .rulesyncignore found.",
      );
    });

    it("should throw error for unsupported tool target in conversion", async () => {
      const mockRulesyncIgnore = Object.create(RulesyncIgnore.prototype);
      Object.assign(mockRulesyncIgnore, {
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesyncignore",
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
    it("should convert tool ignores to rulesync ignores", async () => {
      const cursorIgnore = new CursorIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent: "*.log\nnode_modules/",
      });

      // Mock the toRulesyncIgnore method to return a proper mock
      const mockRulesyncIgnore = Object.create(RulesyncIgnore.prototype);
      vi.spyOn(cursorIgnore, "toRulesyncIgnore").mockReturnValue(mockRulesyncIgnore);

      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles([cursorIgnore]);
      expect(rulesyncFiles).toHaveLength(1);
      expect(rulesyncFiles[0]).toBe(mockRulesyncIgnore);
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
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesyncignore",
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
        "amazonqcli",
        "augmentcode",
        "claudecode",
        "cline",
        "codexcli",
        "cursor",
        "geminicli",
        "junie",
        "kiro",
        "qwencode",
        "roo",
        "windsurf",
      ];

      expect(toolTargets).toEqual(expectedTargets);
    });
  });
});

import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import * as fileUtils from "../utils/file.js";
import { IgnoreProcessor } from "./ignore-processor.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

vi.mock("../utils/file.js");
vi.mock("../utils/logger.js");

describe("IgnoreProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with valid tool target", () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      expect(processor).toBeInstanceOf(IgnoreProcessor);
    });

    it("should use current working directory as default baseDir", () => {
      const processor = new IgnoreProcessor({
        toolTarget: "cursor",
      });

      expect(processor).toBeInstanceOf(IgnoreProcessor);
    });

    it("should validate tool target", () => {
      expect(() => {
        void new IgnoreProcessor({
          baseDir: testDir,
          toolTarget: "invalid" as any,
        });
      }).toThrow();
    });
  });

  describe("getToolTargets", () => {
    it("should return supported ignore tool targets", () => {
      const targets = IgnoreProcessor.getToolTargets();

      expect(targets).toContain("augmentcode");
      expect(targets).toContain("cline");
      expect(targets).toContain("codexcli");
      expect(targets).toContain("cursor");
      expect(targets).toContain("geminicli");
      expect(targets).toContain("junie");
      expect(targets).toContain("kiro");
      expect(targets).toContain("qwencode");
      expect(targets).toContain("roo");
      expect(targets).toContain("windsurf");
    });
  });

  describe("convertRulesyncFilesToToolFiles", () => {
    it("should convert rulesync ignores to cursor ignore", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const mockRulesyncIgnore = {
        filePath: join(testDir, ".rulesync", "ignore", "cursor.txt"),
        content: "node_modules/\n*.log\n",
        frontmatter: {
          targets: ["cursor"],
        },
      } as RulesyncIgnore;

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncIgnore]);

      expect(result).toHaveLength(1);
      expect(result[0].getFilePath()).toContain(".cursorignore");
    });

    it("should convert rulesync ignores to cline ignore", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cline",
      });

      const mockRulesyncIgnore = {
        filePath: join(testDir, ".rulesync", "ignore", "cline.txt"),
        content: "dist/\n*.test.js\n",
        frontmatter: {
          targets: ["cline"],
        },
      } as RulesyncIgnore;

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncIgnore]);

      expect(result).toHaveLength(1);
      expect(result[0].getFilePath()).toContain(".clineignore");
    });

    it("should convert rulesync ignores to windsurf ignore", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "windsurf",
      });

      const mockRulesyncIgnore = {
        filePath: join(testDir, ".rulesync", "ignore", "windsurf.txt"),
        content: "build/\n*.tmp\n",
        frontmatter: {
          targets: ["windsurf"],
        },
      } as RulesyncIgnore;

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncIgnore]);

      expect(result).toHaveLength(1);
      expect(result[0].getFilePath()).toContain(".windsurfignore");
    });

    it("should handle multiple ignore files", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const mockIgnore1 = {
        filePath: join(testDir, ".rulesync", "ignore", "ignore1.txt"),
        content: "*.log\n",
        frontmatter: { targets: ["cursor"] },
      } as RulesyncIgnore;

      const mockIgnore2 = {
        filePath: join(testDir, ".rulesync", "ignore", "ignore2.txt"),
        content: "*.tmp\n",
        frontmatter: { targets: ["cursor"] },
      } as RulesyncIgnore;

      const result = await processor.convertRulesyncFilesToToolFiles([mockIgnore1, mockIgnore2]);

      expect(result).toHaveLength(2);
    });

    it("should filter non-ignore files", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const mockNonIgnore = {
        filePath: "some/other/file.md",
        content: "not an ignore file",
      };

      const result = await processor.convertRulesyncFilesToToolFiles([mockNonIgnore as any]);

      expect(result).toHaveLength(0);
    });
  });

  describe("loadRulesyncFiles", () => {
    it("should load ignore files from .rulesync/ignore directory", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const ignoreDir = join(testDir, ".rulesync", "ignore");
      vi.mocked(fileUtils.directoryExists).mockResolvedValue(true);
      vi.mocked(fileUtils.listDirectoryFiles).mockResolvedValue(["general.txt", "specific.txt"]);
      vi.mocked(fileUtils.readFileContent).mockImplementation(async (path: string) => {
        if (path.includes("general.txt")) return "node_modules/\n*.log\n";
        if (path.includes("specific.txt")) return "dist/\n*.test.js\n";
        return "";
      });

      const result = await processor.loadRulesyncFiles();

      expect(result).toHaveLength(2);
      expect(fileUtils.directoryExists).toHaveBeenCalledWith(ignoreDir);
    });

    it("should return empty array when ignore directory doesn't exist", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      vi.mocked(fileUtils.directoryExists).mockResolvedValue(false);

      const result = await processor.loadRulesyncFiles();

      expect(result).toHaveLength(0);
    });

    it("should handle empty ignore directory", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      vi.mocked(fileUtils.directoryExists).mockResolvedValue(true);
      vi.mocked(fileUtils.listDirectoryFiles).mockResolvedValue([]);

      const result = await processor.loadRulesyncFiles();

      expect(result).toHaveLength(0);
    });
  });

  describe("loadToolFiles", () => {
    it("should load cursor ignore file", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const cursorIgnoreFile = join(testDir, ".cursorignore");
      vi.mocked(fileUtils.fileExists).mockResolvedValue(true);
      vi.mocked(fileUtils.readFileContent).mockResolvedValue("node_modules/\n*.log\n");

      const result = await processor.loadToolFiles();

      expect(result).toHaveLength(1);
      expect(fileUtils.fileExists).toHaveBeenCalledWith(cursorIgnoreFile);
    });

    it("should load cline ignore file", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cline",
      });

      const clineIgnoreFile = join(testDir, ".clineignore");
      vi.mocked(fileUtils.fileExists).mockResolvedValue(true);
      vi.mocked(fileUtils.readFileContent).mockResolvedValue("dist/\n*.test.js\n");

      const result = await processor.loadToolFiles();

      expect(result).toHaveLength(1);
      expect(fileUtils.fileExists).toHaveBeenCalledWith(clineIgnoreFile);
    });

    it("should return empty array when ignore file doesn't exist", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      vi.mocked(fileUtils.fileExists).mockResolvedValue(false);

      const result = await processor.loadToolFiles();

      expect(result).toHaveLength(0);
    });
  });

  describe("convertToolFilesToRulesyncFiles", () => {
    it("should convert cursor ignore back to rulesync format", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const toolFiles = [
        {
          filePath: join(testDir, ".cursorignore"),
          content: "node_modules/\n*.log\n",
        },
      ];

      const result = await processor.convertToolFilesToRulesyncFiles(toolFiles);

      expect(result).toHaveLength(1);
      expect(result[0].getFilePath()).toContain(".rulesync/ignore/");
    });

    it("should convert cline ignore back to rulesync format", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cline",
      });

      const toolFiles = [
        {
          filePath: join(testDir, ".clineignore"),
          content: "dist/\n*.test.js\n",
        },
      ];

      const result = await processor.convertToolFilesToRulesyncFiles(toolFiles);

      expect(result).toHaveLength(1);
      expect(result[0].getFilePath()).toContain(".rulesync/ignore/");
    });
  });

  describe("writeToolIgnoresFromRulesyncIgnores", () => {
    it("should process rulesync ignores and write tool ignore files", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const mockWriteAiFiles = vi.spyOn(processor, "writeAiFiles").mockResolvedValue(1);

      const mockRulesyncIgnores = [
        {
          filePath: join(testDir, ".rulesync", "ignore", "test.txt"),
          content: "node_modules/\n",
          frontmatter: { targets: ["cursor"] },
        },
      ] as RulesyncIgnore[];

      await processor.writeToolIgnoresFromRulesyncIgnores(mockRulesyncIgnores);

      expect(mockWriteAiFiles).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            filePath: expect.stringContaining(".cursorignore"),
          }),
        ]),
      );
    });
  });

  describe("edge cases", () => {
    it("should handle all supported tool targets", async () => {
      const targets = IgnoreProcessor.getToolTargets();

      for (const target of targets) {
        expect(() => {
          void new IgnoreProcessor({
            baseDir: testDir,
            toolTarget: target as any,
          });
        }).not.toThrow();
      }
    });
  });
});

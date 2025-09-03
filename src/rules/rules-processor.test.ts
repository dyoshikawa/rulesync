import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import * as fileUtils from "../utils/file.js";
import { RulesProcessor } from "./rules-processor.js";
import { RulesyncRule } from "./rulesync-rule.js";

vi.mock("../utils/file.js");
vi.mock("../utils/logger.js");

describe("RulesProcessor", () => {
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
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      expect(processor).toBeInstanceOf(RulesProcessor);
    });

    it("should use current working directory as default baseDir", () => {
      const processor = new RulesProcessor({
        toolTarget: "cursor",
      });

      expect(processor).toBeInstanceOf(RulesProcessor);
    });

    it("should validate tool target", () => {
      expect(() => {
        void new RulesProcessor({
          baseDir: testDir,
          toolTarget: "invalid" as any,
        });
      }).toThrow();
    });
  });

  describe("getToolTargets", () => {
    it("should return comprehensive list of supported tool targets", () => {
      const targets = RulesProcessor.getToolTargets();

      expect(targets).toContain("agentsmd");
      expect(targets).toContain("amazonqcli");
      expect(targets).toContain("augmentcode");
      expect(targets).toContain("augmentcode-legacy");
      expect(targets).toContain("claudecode");
      expect(targets).toContain("cline");
      expect(targets).toContain("codexcli");
      expect(targets).toContain("copilot");
      expect(targets).toContain("cursor");
      expect(targets).toContain("geminicli");
      expect(targets).toContain("junie");
      expect(targets).toContain("kiro");
      expect(targets).toContain("opencode");
      expect(targets).toContain("qwencode");
      expect(targets).toContain("roo");
      expect(targets).toContain("windsurf");
    });
  });

  describe("convertRulesyncFilesToToolFiles", () => {
    it("should convert rulesync rules to cursor rules", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const mockRulesyncRule = {
        filePath: join(testDir, ".rulesync", "rules", "test-rule.md"),
        content: "# Test Rule\n\nThis is a test rule.",
        frontmatter: {
          targets: ["cursor"],
          description: "Test rule",
        },
      } as RulesyncRule;

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncRule]);

      expect(result).toHaveLength(1);
      expect(result[0].getFilePath()).toContain(".cursor/rules/test-rule.md");
    });

    it("should convert rulesync rules to copilot rules", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      const mockRulesyncRule = {
        filePath: join(testDir, ".rulesync", "rules", "test-rule.md"),
        content: "# Test Rule\n\nThis is a test rule.",
        frontmatter: {
          targets: ["copilot"],
          description: "Test rule",
        },
      } as RulesyncRule;

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncRule]);

      expect(result).toHaveLength(1);
      expect(result[0].getFilePath()).toContain("copilot-instructions.md");
    });

    it("should convert rulesync rules to claudecode rules", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const mockRulesyncRule = {
        filePath: join(testDir, ".rulesync", "rules", "test-rule.md"),
        content: "# Test Rule\n\nThis is a test rule.",
        frontmatter: {
          targets: ["claudecode"],
          description: "Test rule",
        },
      } as RulesyncRule;

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncRule]);

      expect(result).toHaveLength(1);
      expect(result[0].getFilePath()).toContain("CLAUDE.md");
    });

    it("should handle multiple rule files", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const mockRule1 = {
        filePath: join(testDir, ".rulesync", "rules", "rule1.md"),
        content: "# Rule 1",
        frontmatter: { targets: ["cursor"] },
      } as RulesyncRule;

      const mockRule2 = {
        filePath: join(testDir, ".rulesync", "rules", "rule2.md"),
        content: "# Rule 2",
        frontmatter: { targets: ["cursor"] },
      } as RulesyncRule;

      const result = await processor.convertRulesyncFilesToToolFiles([mockRule1, mockRule2]);

      expect(result).toHaveLength(2);
      expect(result[0].getFilePath()).toContain("rule1.md");
      expect(result[1].getFilePath()).toContain("rule2.md");
    });

    it("should filter non-rule files", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const mockNonRule = {
        filePath: "some/other/file.md",
        content: "not a rule",
      };

      const result = await processor.convertRulesyncFilesToToolFiles([mockNonRule as any]);

      expect(result).toHaveLength(0);
    });
  });

  describe("loadRulesyncFiles", () => {
    it("should load rule files from .rulesync/rules directory", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const rulesDir = join(testDir, ".rulesync", "rules");
      vi.mocked(fileUtils.directoryExists).mockResolvedValue(true);
      vi.mocked(fileUtils.listDirectoryFiles).mockResolvedValue(["overview.md", "specific.md"]);
      vi.mocked(fileUtils.readFileContent).mockImplementation(async (path: string) => {
        if (path.includes("overview.md")) {
          return "---\ntargets: ['*']\n---\n# Overview\nGeneral rules";
        }
        if (path.includes("specific.md")) {
          return "---\ntargets: ['cursor']\n---\n# Specific\nCursor-specific rules";
        }
        return "";
      });

      const result = await processor.loadRulesyncFiles();

      expect(result).toHaveLength(2);
      expect(fileUtils.directoryExists).toHaveBeenCalledWith(rulesDir);
    });

    it("should return empty array when rules directory doesn't exist", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      vi.mocked(fileUtils.directoryExists).mockResolvedValue(false);

      const result = await processor.loadRulesyncFiles();

      expect(result).toHaveLength(0);
    });

    it("should handle empty rules directory", async () => {
      const processor = new RulesProcessor({
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
    it("should load tool files for cursor target", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const cursorRulesDir = join(testDir, ".cursor", "rules");
      vi.mocked(fileUtils.directoryExists).mockResolvedValue(true);
      vi.mocked(fileUtils.listDirectoryFiles).mockResolvedValue(["rule.md"]);
      vi.mocked(fileUtils.readFileContent).mockResolvedValue("# Cursor Rule\nContent");

      const result = await processor.loadToolFiles();

      expect(result).toHaveLength(1);
      expect(fileUtils.directoryExists).toHaveBeenCalledWith(cursorRulesDir);
    });

    it("should load tool files for copilot target", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      const copilotFile = join(testDir, ".github", "copilot-instructions.md");
      vi.mocked(fileUtils.fileExists).mockResolvedValue(true);
      vi.mocked(fileUtils.readFileContent).mockResolvedValue("# Copilot Instructions");

      const result = await processor.loadToolFiles();

      expect(result).toHaveLength(1);
      expect(fileUtils.fileExists).toHaveBeenCalledWith(copilotFile);
    });

    it("should return empty array when tool files don't exist", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      vi.mocked(fileUtils.directoryExists).mockResolvedValue(false);

      const result = await processor.loadToolFiles();

      expect(result).toHaveLength(0);
    });
  });

  describe("convertToolFilesToRulesyncFiles", () => {
    it("should convert cursor tool files back to rulesync files", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const toolFiles = [
        {
          filePath: join(testDir, ".cursor", "rules", "test-rule.md"),
          content: "# Test Rule\nContent for cursor",
        },
      ];

      const result = await processor.convertToolFilesToRulesyncFiles(toolFiles);

      expect(result).toHaveLength(1);
      expect(result[0].getFilePath()).toContain(".rulesync/rules/test-rule.md");
    });

    it("should convert copilot tool files back to rulesync files", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      const toolFiles = [
        {
          filePath: join(testDir, ".github", "copilot-instructions.md"),
          content: "# Copilot Instructions\nContent for copilot",
        },
      ];

      const result = await processor.convertToolFilesToRulesyncFiles(toolFiles);

      expect(result).toHaveLength(1);
      expect(result[0].getFilePath()).toContain(".rulesync/rules/");
    });

    it("should handle multiple tool files", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const toolFiles = [
        {
          filePath: join(testDir, ".cursor", "rules", "rule1.md"),
          content: "# Rule 1",
        },
        {
          filePath: join(testDir, ".cursor", "rules", "rule2.md"),
          content: "# Rule 2",
        },
      ];

      const result = await processor.convertToolFilesToRulesyncFiles(toolFiles);

      expect(result).toHaveLength(2);
      expect(result[0].getFilePath()).toContain("rule1.md");
      expect(result[1].getFilePath()).toContain("rule2.md");
    });
  });

  describe("edge cases", () => {
    it("should handle all supported tool targets", async () => {
      const targets = RulesProcessor.getToolTargets();

      for (const target of targets) {
        expect(() => {
          void new RulesProcessor({
            baseDir: testDir,
            toolTarget: target as any,
          });
        }).not.toThrow();
      }
    });
  });
});

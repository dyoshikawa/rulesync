import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { ClaudecodeSubagent } from "./claudecode-subagent.js";
import { GeminiCliSubagent } from "./geminicli-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { SimulatedSubagent } from "./simulated-subagent.js";
import {
  SubagentsProcessor,
  SubagentsProcessorToolTarget,
  subagentsProcessorToolTargets,
  subagentsProcessorToolTargetsSimulated,
} from "./subagents-processor.js";
import { ToolSubagent } from "./tool-subagent.js";

// Mock file system and other utils
vi.mock("../../utils/file.js", async () => {
  const actual = await vi.importActual<typeof import("../../utils/file.js")>("../../utils/file.js");
  return {
    ...actual,
    directoryExists: vi.fn(),
    listDirectoryFiles: vi.fn(),
    findFilesByGlobs: vi.fn(),
    readFileContent: vi.fn(),
    readFileContentOrNull: vi.fn(),
    writeJsonFile: vi.fn(),
  };
});

import {
  directoryExists,
  findFilesByGlobs,
  listDirectoryFiles,
  readFileContentOrNull,
  writeJsonFile,
} from "../../utils/file.js";

describe("SubagentsProcessor", () => {
  let logger = createMockLogger();

  beforeEach(() => {
    logger = createMockLogger();
    vi.mocked(directoryExists).mockResolvedValue(true);
    vi.mocked(listDirectoryFiles).mockResolvedValue([]);
    vi.mocked(findFilesByGlobs).mockResolvedValue([]);
    vi.mocked(readFileContentOrNull).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create an instance with valid target", () => {
      const processor = new SubagentsProcessor({
        toolTarget: "claudecode",
        logger,
      });
      expect(processor).toBeInstanceOf(SubagentsProcessor);
    });

    it("should create an instance with global: true", () => {
      const processor = new SubagentsProcessor({
        toolTarget: "claudecode",
        global: true,
        logger,
      });
      expect(processor).toBeInstanceOf(SubagentsProcessor);
    });

    it("should throw error with invalid target", () => {
      expect(() => {
        const _processor = new SubagentsProcessor({
          toolTarget: "invalid" as SubagentsProcessorToolTarget,
          logger,
        });
      }).toThrow("Invalid tool target for SubagentsProcessor");
    });

    it("should use process.cwd() as default baseDir", () => {
      const processor = new SubagentsProcessor({
        toolTarget: "claudecode",
        logger,
      });
      // Accessing protected baseDir through any for test
      expect((processor as any).baseDir).toBe(process.cwd());
    });

    it("should use provided baseDir", () => {
      const processor = new SubagentsProcessor({
        baseDir: "/custom/path",
        toolTarget: "claudecode",
        logger,
      });
      expect((processor as any).baseDir).toBe("/custom/path");
    });
  });

  describe("convertRulesyncFilesToToolFiles", () => {
    let processor: SubagentsProcessor;

    beforeEach(() => {
      processor = new SubagentsProcessor({
        toolTarget: "claudecode",
        logger,
      });
    });

    it("should convert RulesyncSubagent to ToolSubagent", async () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: ".",
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test.md",
        frontmatter: { name: "test", targets: ["*"], description: "test" },
        body: "body",
      });

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncSubagent]);

      expect(toolFiles.length).toBe(1);
      expect(toolFiles[0]).toBeInstanceOf(ToolSubagent);
      expect(toolFiles[0]).toBeInstanceOf(ClaudecodeSubagent);
    });

    it("should filter out subagents not targeted for the tool", async () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: ".",
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test.md",
        frontmatter: { name: "test", targets: ["cursor"], description: "test" },
        body: "body",
      });

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncSubagent]);

      expect(toolFiles.length).toBe(0);
    });

    it("should handle empty array", async () => {
      const toolFiles = await processor.convertRulesyncFilesToToolFiles([]);
      expect(toolFiles.length).toBe(0);
    });

    it("should handle non-RulesyncSubagent files", async () => {
      const otherFile = { getFilePath: () => "test.txt" } as RulesyncFile;
      const toolFiles = await processor.convertRulesyncFilesToToolFiles([otherFile]);
      expect(toolFiles.length).toBe(0);
    });
  });

  describe("convertToolFilesToRulesyncFiles", () => {
    let processor: SubagentsProcessor;

    beforeEach(() => {
      processor = new SubagentsProcessor({
        toolTarget: "claudecode",
        logger,
      });
    });

    it("should convert ToolSubagent to RulesyncSubagent", async () => {
      const toolSubagent = new ClaudecodeSubagent({
        baseDir: ".",
        relativeDirPath: ".claude/agents",
        relativeFilePath: "test.md",
        frontmatter: { name: "test", description: "test" },
        body: "body",
        fileContent: "---\nname: test\ndescription: test\n---\nbody",
      });

      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles([toolSubagent]);

      expect(rulesyncFiles.length).toBe(1);
      expect(rulesyncFiles[0]).toBeInstanceOf(RulesyncSubagent);
      expect(rulesyncFiles[0]!.getRelativeFilePath()).toBe("test.md");
    });

    it("should skip simulated subagents", async () => {
      // Create a mock simulated subagent
      const mockSimulated = {
        getRelativeFilePath: () => "simulated.md",
      } as any;
      // Object.setPrototypeOf to make it pass instanceof check if needed
      Object.setPrototypeOf(mockSimulated, SimulatedSubagent.prototype);

      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles([mockSimulated]);

      expect(rulesyncFiles.length).toBe(0);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("Skipping simulated"));
    });

    it("should handle empty array", async () => {
      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles([]);
      expect(rulesyncFiles.length).toBe(0);
    });
  });

  describe("loadRulesyncFiles", () => {
    let processor: SubagentsProcessor;

    beforeEach(() => {
      processor = new SubagentsProcessor({
        toolTarget: "claudecode",
        logger,
      });
    });

    it("should load subagents from .rulesync/subagents directory", async () => {
      vi.mocked(directoryExists).mockResolvedValue(true);
      vi.mocked(listDirectoryFiles).mockResolvedValue(["planner.md", "researcher.md", "README.md"]);

      // Mock RulesyncSubagent.fromFile
      const fromFileSpy = vi.spyOn(RulesyncSubagent, "fromFile").mockImplementation(
        async ({ relativeFilePath }) =>
          new RulesyncSubagent({
            baseDir: ".",
            relativeDirPath: ".rulesync/subagents",
            relativeFilePath,
            frontmatter: { name: relativeFilePath, targets: ["*"], description: "desc" },
            body: "body",
          }),
      );

      const files = await processor.loadRulesyncFiles();

      expect(files.length).toBe(3); // Only .md files, including README.md
      expect(fromFileSpy).toHaveBeenCalledTimes(3);
    });

    it("should return empty array if directory does not exist", async () => {
      vi.mocked(directoryExists).mockResolvedValue(false);

      const files = await processor.loadRulesyncFiles();

      expect(files.length).toBe(0);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("not found"));
    });

    it("should return empty array if no markdown files found", async () => {
      vi.mocked(directoryExists).mockResolvedValue(true);
      vi.mocked(listDirectoryFiles).mockResolvedValue(["test.json", "test.txt"]);

      const files = await processor.loadRulesyncFiles();

      expect(files.length).toBe(0);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("No markdown files found"));
    });

    it("should skip files that fail to load", async () => {
      vi.mocked(directoryExists).mockResolvedValue(true);
      vi.mocked(listDirectoryFiles).mockResolvedValue(["good.md", "bad.md"]);

      vi.spyOn(RulesyncSubagent, "fromFile").mockImplementation(async ({ relativeFilePath }) => {
        if (relativeFilePath === "bad.md") {
          throw new Error("Load failed");
        }
        return new RulesyncSubagent({
          baseDir: ".",
          relativeDirPath: ".rulesync/subagents",
          relativeFilePath,
          frontmatter: { name: "good", targets: ["*"], description: "desc" },
          body: "body",
        });
      });

      const files = await processor.loadRulesyncFiles();

      expect(files.length).toBe(1);
      expect(files[0]!.getRelativeFilePath()).toBe("good.md");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to load subagent"));
    });
  });

  describe("loadToolFiles", () => {
    let processor: SubagentsProcessor;

    beforeEach(() => {
      processor = new SubagentsProcessor({
        toolTarget: "claudecode",
        logger,
      });
    });

    it("should load tool-specific subagents", async () => {
      vi.mocked(findFilesByGlobs).mockResolvedValue([
        "/.claude/agents/planner.md",
        "/.claude/agents/researcher.md",
      ]);

      // Mock factory classes
      const fromFileSpy = vi.spyOn(ClaudecodeSubagent, "fromFile").mockImplementation(
        async ({ relativeFilePath }) =>
          new ClaudecodeSubagent({
            baseDir: ".",
            relativeDirPath: ".claude/agents",
            relativeFilePath,
            frontmatter: { name: relativeFilePath, description: "desc" },
            body: "body",
            fileContent: "content",
          }),
      );

      const files = await processor.loadToolFiles();

      expect(files.length).toBe(2);
      expect(fromFileSpy).toHaveBeenCalledTimes(2);
    });

    it("should handle global mode", async () => {
      const globalProcessor = new SubagentsProcessor({
        toolTarget: "claudecode",
        global: true,
        logger,
      });

      vi.mocked(findFilesByGlobs).mockResolvedValue(["/home/.claude/agents/global.md"]);

      const fromFileSpy = vi.spyOn(ClaudecodeSubagent, "fromFile").mockResolvedValue({} as any);

      await globalProcessor.loadToolFiles();

      expect(fromFileSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          global: true,
        }),
      );
    });

    it("should load files for deletion", async () => {
      vi.mocked(findFilesByGlobs).mockResolvedValue(["/.claude/agents/old.md"]);

      const forDeletionSpy = vi.spyOn(ClaudecodeSubagent, "forDeletion").mockImplementation(
        ({ relativeFilePath }) =>
          ({
            getRelativeFilePath: () => relativeFilePath,
            isDeletable: () => true,
          }) as any,
      );

      const files = await processor.loadToolFiles({ forDeletion: true });

      expect(files.length).toBe(1);
      expect(forDeletionSpy).toHaveBeenCalled();
    });
  });

  describe("postGenerate", () => {
    let testDir: string;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      ({ testDir, cleanup } = await setupTestDirectory());
    });

    afterEach(async () => {
      await cleanup();
    });

    it("should inject experimental.enableAgents into .gemini/settings.json for geminicli", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "geminicli",
        logger,
      });

      const toolFiles = [
        new GeminiCliSubagent({
          baseDir: testDir,
          relativeDirPath: ".gemini/agents",
          relativeFilePath: "test.md",
          frontmatter: { name: "test", description: "test" },
          body: "body",
        }),
      ];

      vi.mocked(readFileContentOrNull).mockResolvedValue(null);

      const result = await processor.postGenerate(toolFiles);

      expect(result.count).toBe(1);
      expect(result.paths).toContain(join(".gemini", "settings.json"));
      expect(result.hasDiff).toBe(true);
      expect(writeJsonFile).toHaveBeenCalledWith(
        join(testDir, ".gemini", "settings.json"),
        expect.objectContaining({
          experimental: { enableAgents: true },
        }),
      );
    });

    it("should preserve existing experimental flags in .gemini/settings.json", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "geminicli",
        logger,
      });

      const toolFiles = [{} as any]; // Length > 0

      vi.mocked(readFileContentOrNull).mockResolvedValue(
        JSON.stringify({
          experimental: { existingFlag: true },
        }),
      );

      await processor.postGenerate(toolFiles);

      expect(writeJsonFile).toHaveBeenCalledWith(
        join(testDir, ".gemini", "settings.json"),
        expect.objectContaining({
          experimental: { existingFlag: true, enableAgents: true },
        }),
      );
    });

    it("should not inject if experimental.enableAgents is already true", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "geminicli",
        logger,
      });

      const toolFiles = [{} as any];

      vi.mocked(readFileContentOrNull).mockResolvedValue(
        JSON.stringify({
          experimental: { enableAgents: true },
        }),
      );

      const result = await processor.postGenerate(toolFiles);

      expect(result.count).toBe(0);
      expect(result.hasDiff).toBe(false);
      expect(writeJsonFile).not.toHaveBeenCalled();
    });

    it("should skip if toolTarget is not geminicli", async () => {
      const processor = new SubagentsProcessor({
        toolTarget: "claudecode",
        logger,
      });

      const result = await processor.postGenerate([{} as any]);

      expect(result.count).toBe(0);
      expect(writeJsonFile).not.toHaveBeenCalled();
    });

    it("should skip if no toolFiles generated", async () => {
      const processor = new SubagentsProcessor({
        toolTarget: "geminicli",
        logger,
      });

      const result = await processor.postGenerate([]);

      expect(result.count).toBe(0);
      expect(writeJsonFile).not.toHaveBeenCalled();
    });

    it("should handle invalid JSON in settings.json gracefully", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "geminicli",
        logger,
      });

      vi.mocked(readFileContentOrNull).mockResolvedValue("invalid json");

      await processor.postGenerate([{} as any]);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Could not parse"));
      // Should treat as empty object and proceed
      expect(writeJsonFile).toHaveBeenCalledWith(
        join(testDir, ".gemini", "settings.json"),
        expect.objectContaining({
          experimental: { enableAgents: true },
        }),
      );
    });
  });

  describe("getToolTargets", () => {
    it("should return project targets excluding simulated by default", () => {
      const targets = SubagentsProcessor.getToolTargets();
      expect(targets).toContain("claudecode");
      expect(targets).toContain("geminicli");
      // Simulated targets should be excluded if includeSimulated is false (default)
      // Since I changed them to false, they are now included!
      expect(targets).toContain("agentsmd");
    });

    it("should include simulated targets when includeSimulated is true", () => {
      const targets = SubagentsProcessor.getToolTargets({ includeSimulated: true });
      expect(targets).toContain("claudecode");
      expect(targets).toContain("geminicli");
    });

    it("should return only global targets in global mode", () => {
      const targets = SubagentsProcessor.getToolTargets({ global: true });
      expect(targets).toContain("claudecode");
      expect(targets).not.toContain("copilot"); // copilot supportsGlobal is false
    });
  });

  describe("type exports and constants", () => {
    it("should export subagentsProcessorToolTargets constant", () => {
      expect(new Set(subagentsProcessorToolTargets)).toEqual(
        new Set([
          "agentsmd",
          "claudecode",
          "claudecode-legacy",
          "codexcli",
          "copilot",
          "cursor",
          "deepagents",
          "factorydroid",
          "geminicli",
          "junie",
          "kiro",
          "opencode",
          "roo",
          "rovodev",
        ]),
      );
      expect(Array.isArray(subagentsProcessorToolTargets)).toBe(true);
    });

    it("should export subagentsProcessorToolTargetsSimulated constant", () => {
      expect(new Set(subagentsProcessorToolTargetsSimulated)).toEqual(new Set([]));
    });

    it("should have valid SubagentsProcessorToolTarget type", () => {
      const validTargets: SubagentsProcessorToolTarget[] = [
        "claudecode",
        "copilot",
        "cursor",
        "geminicli",
      ];
      expect(validTargets.length).toBeGreaterThan(0);
    });
  });
});

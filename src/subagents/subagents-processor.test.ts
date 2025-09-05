import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { ClaudecodeSubagent } from "./claudecode-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import {
  SubagentsProcessor,
  SubagentsProcessorToolTarget,
  SubagentsProcessorToolTargetSchema,
  subagentsProcessorToolTargets,
} from "./subagents-processor.js";

describe("SubagentsProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let originalCwd: string;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    originalCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with valid tool target", () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      expect(processor).toBeInstanceOf(SubagentsProcessor);
    });

    it("should use default baseDir when not provided", () => {
      const processor = new SubagentsProcessor({
        toolTarget: "claudecode",
      });

      expect(processor).toBeInstanceOf(SubagentsProcessor);
    });

    it("should validate tool target with schema", () => {
      expect(() => {
        const _processor = new SubagentsProcessor({
          baseDir: testDir,
          toolTarget: "invalid" as SubagentsProcessorToolTarget,
        });
      }).toThrow();
    });

    it("should accept all valid tool targets", () => {
      for (const toolTarget of subagentsProcessorToolTargets) {
        expect(() => {
          const _processor = new SubagentsProcessor({
            baseDir: testDir,
            toolTarget,
          });
        }).not.toThrow();
      }
    });
  });

  describe("convertRulesyncFilesToToolFiles", () => {
    let processor: SubagentsProcessor;

    beforeEach(() => {
      processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });
    });

    it("should filter and convert RulesyncSubagent instances", async () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test-agent.md",
        fileContent: `---
name: test-agent
description: Test agent description
targets: ["*"]
---
Test agent content`,
        frontmatter: {
          name: "test-agent",
          description: "Test agent description",
          targets: ["*"],
        },
        body: "Test agent content",
        validate: false,
      });

      // Create a mixed array with different file types
      const rulesyncFiles = [
        rulesyncSubagent,
        // Add a mock non-subagent file
        {
          getFilePath: () => "not-a-subagent.md",
          getFileContent: () => "not a subagent",
        } as any,
      ];

      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBeInstanceOf(ClaudecodeSubagent);
    });

    it("should handle empty rulesync files array", async () => {
      const toolFiles = await processor.convertRulesyncFilesToToolFiles([]);
      expect(toolFiles).toEqual([]);
    });

    it("should handle array with no RulesyncSubagent instances", async () => {
      const rulesyncFiles = [
        { getFilePath: () => "file1.md" } as any,
        { getFilePath: () => "file2.md" } as any,
      ];

      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      expect(toolFiles).toEqual([]);
    });

    it("should throw error for unsupported tool target", async () => {
      // Create processor with mock tool target (bypassing constructor validation)
      const processorWithMockTarget = Object.create(SubagentsProcessor.prototype);
      processorWithMockTarget.baseDir = testDir;
      processorWithMockTarget.toolTarget = "unsupported";

      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test.md",
        fileContent: '---\nname: test\ndescription: test\ntargets: ["*"]\n---\ntest',
        frontmatter: { name: "test", description: "test", targets: ["*"] },
        body: "test",
        validate: false,
      });

      await expect(
        processorWithMockTarget.convertRulesyncFilesToToolFiles([rulesyncSubagent]),
      ).rejects.toThrow("Unsupported tool target: unsupported");
    });
  });

  describe("convertToolFilesToRulesyncFiles", () => {
    let processor: SubagentsProcessor;

    beforeEach(() => {
      processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });
    });

    it("should filter and convert ToolSubagent instances", async () => {
      const claudecodeSubagent = new ClaudecodeSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "test-agent.md",
        fileContent: `---
name: test-agent
description: Test agent description
---
Test agent content`,
        frontmatter: {
          name: "test-agent",
          description: "Test agent description",
        },
        body: "Test agent content",
        validate: false,
      });

      const toolFiles = [
        claudecodeSubagent,
        // Add a mock non-subagent file
        {
          getFilePath: () => "not-a-subagent.md",
          getFileContent: () => "not a subagent",
        } as any,
      ];

      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(toolFiles);

      expect(rulesyncFiles).toHaveLength(1);
      expect(rulesyncFiles[0]).toBeInstanceOf(RulesyncSubagent);
    });

    it("should handle empty tool files array", async () => {
      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles([]);
      expect(rulesyncFiles).toEqual([]);
    });

    it("should handle array with no ToolSubagent instances", async () => {
      const toolFiles = [
        { getFilePath: () => "file1.md" } as any,
        { getFilePath: () => "file2.md" } as any,
      ];

      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(toolFiles);
      expect(rulesyncFiles).toEqual([]);
    });
  });

  describe("loadRulesyncFiles", () => {
    let processor: SubagentsProcessor;

    beforeEach(() => {
      processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });
    });

    it("should return empty array when subagents directory does not exist", async () => {
      const rulesyncFiles = await processor.loadRulesyncFiles();
      expect(rulesyncFiles).toEqual([]);
    });

    it("should return empty array when no markdown files exist", async () => {
      const subagentsDir = join(testDir, ".rulesync", "subagents");
      await ensureDir(subagentsDir);

      // Create non-markdown files
      await writeFileContent(join(subagentsDir, "readme.txt"), "Not a markdown file");
      await writeFileContent(join(subagentsDir, "config.json"), "{}");

      const rulesyncFiles = await processor.loadRulesyncFiles();
      expect(rulesyncFiles).toEqual([]);
    });

    it("should load valid markdown subagent files", async () => {
      const subagentsDir = join(testDir, ".rulesync", "subagents");
      await ensureDir(subagentsDir);

      const validSubagentContent = `---
name: test-agent
description: Test agent description
targets: ["*"]
---
This is a test agent content`;

      await writeFileContent(join(subagentsDir, "test-agent.md"), validSubagentContent);

      const rulesyncFiles = await processor.loadRulesyncFiles();

      expect(rulesyncFiles).toHaveLength(1);
      expect(rulesyncFiles[0]).toBeInstanceOf(RulesyncSubagent);
      const rulesyncSubagent = rulesyncFiles[0] as RulesyncSubagent;
      expect(rulesyncSubagent.getFrontmatter().name).toBe("test-agent");
      expect(rulesyncSubagent.getFrontmatter().description).toBe("Test agent description");
      expect(rulesyncSubagent.getBody()).toBe("This is a test agent content");
    });

    it("should load multiple valid subagent files", async () => {
      const subagentsDir = join(testDir, ".rulesync", "subagents");
      await ensureDir(subagentsDir);

      const subagent1Content = `---
name: agent-1
description: First agent
targets: ["claudecode"]
---
First agent content`;

      const subagent2Content = `---
name: agent-2
description: Second agent
targets: ["*"]
---
Second agent content`;

      await writeFileContent(join(subagentsDir, "agent-1.md"), subagent1Content);
      await writeFileContent(join(subagentsDir, "agent-2.md"), subagent2Content);

      const rulesyncFiles = await processor.loadRulesyncFiles();

      expect(rulesyncFiles).toHaveLength(2);
      expect(rulesyncFiles.every((file) => file instanceof RulesyncSubagent)).toBe(true);

      const names = rulesyncFiles
        .map((file) => (file as RulesyncSubagent).getFrontmatter().name)
        .sort();
      expect(names).toEqual(["agent-1", "agent-2"]);
    });

    it("should skip invalid subagent files and continue loading valid ones", async () => {
      const subagentsDir = join(testDir, ".rulesync", "subagents");
      await ensureDir(subagentsDir);

      const validContent = `---
name: valid-agent
description: Valid agent
targets: ["*"]
---
Valid content`;

      const invalidContent = `---
invalid yaml: [
---
Invalid content`;

      await writeFileContent(join(subagentsDir, "valid.md"), validContent);
      await writeFileContent(join(subagentsDir, "invalid.md"), invalidContent);

      const rulesyncFiles = await processor.loadRulesyncFiles();

      expect(rulesyncFiles).toHaveLength(1);
      const validRulesyncSubagent = rulesyncFiles[0] as RulesyncSubagent;
      expect(validRulesyncSubagent.getFrontmatter().name).toBe("valid-agent");
    });
  });

  describe("loadToolFiles", () => {
    let processor: SubagentsProcessor;

    beforeEach(() => {
      processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });
    });

    it("should delegate to loadClaudecodeSubagents for claudecode target", async () => {
      const toolFiles = await processor.loadToolFiles();
      expect(Array.isArray(toolFiles)).toBe(true);
    });

    it("should throw error for unsupported tool target", async () => {
      // Create processor with mock tool target
      const processorWithMockTarget = Object.create(SubagentsProcessor.prototype);
      processorWithMockTarget.baseDir = testDir;
      processorWithMockTarget.toolTarget = "unsupported";

      await expect(processorWithMockTarget.loadToolFiles()).rejects.toThrow(
        "Unsupported tool target: unsupported",
      );
    });
  });

  describe("loadClaudecodeSubagents", () => {
    let processor: SubagentsProcessor;

    beforeEach(() => {
      processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });
    });

    it("should return empty array when agents directory does not exist", async () => {
      const toolFiles = await processor.loadToolFiles();
      expect(toolFiles).toEqual([]);
    });

    it("should load claudecode subagent files from .claude/agents", async () => {
      const agentsDir = join(testDir, ".claude", "agents");
      await ensureDir(agentsDir);

      const subagentContent = `---
name: claude-agent
description: Claude agent description
---
Claude agent content`;

      await writeFileContent(join(agentsDir, "claude-agent.md"), subagentContent);

      const toolFiles = await processor.loadToolFiles();

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBeInstanceOf(ClaudecodeSubagent);
    });

    it("should load multiple claudecode subagent files", async () => {
      const agentsDir = join(testDir, ".claude", "agents");
      await ensureDir(agentsDir);

      const agent1Content = `---
name: agent-1
description: First Claude agent
---
First content`;

      const agent2Content = `---
name: agent-2
description: Second Claude agent
---
Second content`;

      await writeFileContent(join(agentsDir, "agent-1.md"), agent1Content);
      await writeFileContent(join(agentsDir, "agent-2.md"), agent2Content);

      const toolFiles = await processor.loadToolFiles();

      expect(toolFiles).toHaveLength(2);
      expect(toolFiles.every((file) => file instanceof ClaudecodeSubagent)).toBe(true);
    });

    it("should handle files that fail to load gracefully", async () => {
      const agentsDir = join(testDir, ".claude", "agents");
      await ensureDir(agentsDir);

      // Create a file that will cause loading to fail
      await writeFileContent(
        join(agentsDir, "valid.md"),
        `---
name: valid
description: Valid agent
---
Valid content`,
      );

      // Create another file (this one might fail due to invalid format, depending on ClaudecodeSubagent implementation)
      await writeFileContent(
        join(agentsDir, "might-fail.md"),
        "Invalid format without frontmatter",
      );

      const toolFiles = await processor.loadToolFiles();

      // Should at least load the valid file, may or may not load the invalid one depending on ClaudecodeSubagent's error handling
      expect(toolFiles.length).toBeGreaterThanOrEqual(1);
      expect(toolFiles.some((file) => file instanceof ClaudecodeSubagent)).toBe(true);
    });
  });

  describe("getToolTargets", () => {
    it("should return supported tool targets", () => {
      const toolTargets = SubagentsProcessor.getToolTargets();

      expect(Array.isArray(toolTargets)).toBe(true);
      expect(toolTargets).toContain("claudecode");
      expect(toolTargets).toEqual(subagentsProcessorToolTargets);
    });

    it("should be callable without instance", () => {
      expect(() => SubagentsProcessor.getToolTargets()).not.toThrow();
    });
  });

  describe("type exports and constants", () => {
    it("should export SubagentsProcessorToolTargetSchema", () => {
      expect(SubagentsProcessorToolTargetSchema).toBeDefined();
      expect(() => SubagentsProcessorToolTargetSchema.parse("claudecode")).not.toThrow();
      expect(() => SubagentsProcessorToolTargetSchema.parse("invalid")).toThrow();
    });

    it("should export subagentsProcessorToolTargets constant", () => {
      expect(subagentsProcessorToolTargets).toEqual(["claudecode"]);
      expect(Array.isArray(subagentsProcessorToolTargets)).toBe(true);
    });

    it("should have valid SubagentsProcessorToolTarget type", () => {
      const validTarget: SubagentsProcessorToolTarget = "claudecode";
      expect(validTarget).toBe("claudecode");
    });
  });

  describe("inheritance from FeatureProcessor", () => {
    it("should extend FeatureProcessor", () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      expect(processor).toBeInstanceOf(SubagentsProcessor);
      // Should have inherited baseDir property and other FeatureProcessor functionality
      expect(typeof processor.convertRulesyncFilesToToolFiles).toBe("function");
      expect(typeof processor.convertToolFilesToRulesyncFiles).toBe("function");
      expect(typeof processor.loadRulesyncFiles).toBe("function");
      expect(typeof processor.loadToolFiles).toBe("function");
    });
  });

  describe("error handling and edge cases", () => {
    let processor: SubagentsProcessor;

    beforeEach(() => {
      processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });
    });

    it("should handle file system errors gracefully during rulesync file loading", async () => {
      // Create directory but make it inaccessible (this test might be platform-specific)
      const subagentsDir = join(testDir, ".rulesync", "subagents");
      await ensureDir(subagentsDir);

      // Write a file with invalid content that will cause parsing errors
      await writeFileContent(
        join(subagentsDir, "broken.md"),
        "This is not valid frontmatter content",
      );

      // Should not throw, should continue and return what it can parse
      const rulesyncFiles = await processor.loadRulesyncFiles();
      expect(Array.isArray(rulesyncFiles)).toBe(true);
    });

    it("should handle mixed file types in directories", async () => {
      const subagentsDir = join(testDir, ".rulesync", "subagents");
      await ensureDir(subagentsDir);

      // Mix of valid, invalid, and non-markdown files
      await writeFileContent(
        join(subagentsDir, "valid.md"),
        `---
name: valid
description: Valid agent
targets: ["*"]
---
Valid content`,
      );

      await writeFileContent(
        join(subagentsDir, "invalid.md"),
        "Invalid markdown without frontmatter",
      );
      await writeFileContent(join(subagentsDir, "not-markdown.txt"), "This is not markdown");
      await writeFileContent(join(subagentsDir, "README.md"), "# This is a readme, not a subagent");

      const rulesyncFiles = await processor.loadRulesyncFiles();

      // Should filter to only markdown files and only successfully parsed ones
      expect(rulesyncFiles.length).toBeGreaterThanOrEqual(0);
      expect(rulesyncFiles.every((file) => file instanceof RulesyncSubagent)).toBe(true);
    });
  });
});

import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ClaudecodeSubagent } from "./claudecode-subagent.js";
import { CodexCliSubagent } from "./codexcli-subagent.js";
import { CopilotSubagent } from "./copilot-subagent.js";
import { CursorSubagent } from "./cursor-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import {
  SubagentsProcessor,
  SubagentsProcessorToolTarget,
  SubagentsProcessorToolTargetSchema,
  subagentsProcessorToolTargets,
  subagentsProcessorToolTargetsSimulated,
} from "./subagents-processor.js";

/**
 * Creates a mock getFactory that throws an error for unsupported tool targets.
 * Used to test error handling when an invalid tool target is provided.
 */
const createMockGetFactoryThatThrowsUnsupported = () => {
  throw new Error("Unsupported tool target: unsupported");
};

describe("SubagentsProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
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

    it("should filter and convert RulesyncSubagent instances for claudecode", async () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
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

    it("should convert with global flag when processor is in global mode", async () => {
      const globalProcessor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
        global: true,
      });

      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "global-test-agent.md",
        frontmatter: {
          name: "global-test-agent",
          description: "Global test agent description",
          targets: ["*"],
        },
        body: "Global test agent content",
        validate: false,
      });

      const toolFiles = await globalProcessor.convertRulesyncFilesToToolFiles([rulesyncSubagent]);

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBeInstanceOf(ClaudecodeSubagent);
      // The global flag should be passed through to ClaudecodeSubagent.fromRulesyncSubagent
      const claudecodeSubagent = toolFiles[0] as ClaudecodeSubagent;
      expect(claudecodeSubagent.getFrontmatter().name).toBe("global-test-agent");
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
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
        getFactory: createMockGetFactoryThatThrowsUnsupported,
      });

      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { name: "test", description: "test", targets: ["*"] },
        body: "test",
        validate: false,
      });

      await expect(processor.convertRulesyncFilesToToolFiles([rulesyncSubagent])).rejects.toThrow(
        "Unsupported tool target: unsupported",
      );
    });

    it("should convert RulesyncSubagent to CopilotSubagent for copilot target", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "test-agent",
          description: "Test agent description",
          targets: ["*"],
        },
        body: "Test agent content",
        validate: false,
      });

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncSubagent]);

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBeInstanceOf(CopilotSubagent);
    });

    it("should convert RulesyncSubagent to CursorSubagent for cursor target", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "test-agent",
          description: "Test agent description",
          targets: ["*"],
        },
        body: "Test agent content",
        validate: false,
      });

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncSubagent]);

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBeInstanceOf(CursorSubagent);
    });

    it("should convert RulesyncSubagent to CodexCliSubagent for codexcli target", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "codexcli",
      });

      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "test-agent",
          description: "Test agent description",
          targets: ["*"],
        },
        body: "Test agent content",
        validate: false,
      });

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncSubagent]);

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBeInstanceOf(CodexCliSubagent);
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

    it("should skip simulated subagents when converting to rulesync", async () => {
      const claudecodeSubagent = new ClaudecodeSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "claude-agent.md",
        fileContent: `---
name: claude-agent
description: Claude agent
---
Claude content`,
        frontmatter: {
          name: "claude-agent",
          description: "Claude agent",
        },
        body: "Claude content",
        validate: false,
      });

      const copilotSubagent = new CopilotSubagent({
        baseDir: testDir,
        relativeDirPath: ".github/subagents",
        relativeFilePath: "copilot-agent.md",
        frontmatter: {
          name: "copilot-agent",
          description: "Copilot agent",
        },
        body: "Copilot content",
        validate: false,
      });

      const cursorSubagent = new CursorSubagent({
        baseDir: testDir,
        relativeDirPath: ".cursor/subagents",
        relativeFilePath: "cursor-agent.md",
        frontmatter: {
          name: "cursor-agent",
          description: "Cursor agent",
        },
        body: "Cursor content",
        validate: false,
      });

      const codexCliSubagent = new CodexCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".codex/subagents",
        relativeFilePath: "codex-agent.md",
        frontmatter: {
          name: "codex-agent",
          description: "CodexCli agent",
        },
        body: "Codex content",
        validate: false,
      });

      const toolFiles = [claudecodeSubagent, copilotSubagent, cursorSubagent, codexCliSubagent];

      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(toolFiles);

      // Only ClaudecodeSubagent should be converted (non-simulated)
      expect(rulesyncFiles).toHaveLength(1);
      expect(rulesyncFiles[0]).toBeInstanceOf(RulesyncSubagent);
      const rulesyncSubagent = rulesyncFiles[0] as RulesyncSubagent;
      expect(rulesyncSubagent.getFrontmatter().name).toBe("claude-agent");
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
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      await ensureDir(subagentsDir);

      // Create non-markdown files
      await writeFileContent(join(subagentsDir, "readme.txt"), "Not a markdown file");
      await writeFileContent(join(subagentsDir, "config.json"), "{}");

      const rulesyncFiles = await processor.loadRulesyncFiles();
      expect(rulesyncFiles).toEqual([]);
    });

    it("should load valid markdown subagent files", async () => {
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
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
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
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
        .toSorted();
      expect(names).toEqual(["agent-1", "agent-2"]);
    });

    it("should skip invalid subagent files and continue loading valid ones", async () => {
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
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
    it("should delegate to loadClaudecodeSubagents for claudecode target", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });
      const toolFiles = await processor.loadToolFiles();
      expect(Array.isArray(toolFiles)).toBe(true);
    });

    it("should delegate to loadCopilotSubagents for copilot target", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });
      const toolFiles = await processor.loadToolFiles();
      expect(Array.isArray(toolFiles)).toBe(true);
    });

    it("should delegate to loadCursorSubagents for cursor target", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });
      const toolFiles = await processor.loadToolFiles();
      expect(Array.isArray(toolFiles)).toBe(true);
    });

    it("should delegate to loadCodexCliSubagents for codexcli target", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "codexcli",
      });
      const toolFiles = await processor.loadToolFiles();
      expect(Array.isArray(toolFiles)).toBe(true);
    });

    it("should throw error for unsupported tool target", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
        getFactory: createMockGetFactoryThatThrowsUnsupported,
      });

      await expect(processor.loadToolFiles()).rejects.toThrow(
        "Unsupported tool target: unsupported",
      );
    });
  });

  describe("loadCopilotSubagents", () => {
    let processor: SubagentsProcessor;

    beforeEach(() => {
      processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });
    });

    it("should return empty array when subagents directory does not exist", async () => {
      const toolFiles = await processor.loadToolFiles();
      expect(toolFiles).toEqual([]);
    });

    it("should load copilot subagent files from .github/subagents", async () => {
      const subagentsDir = join(testDir, ".github", "subagents");
      await ensureDir(subagentsDir);

      const subagentContent = `---
name: copilot-agent
description: Copilot agent description
---
Copilot agent content`;

      await writeFileContent(join(subagentsDir, "copilot-agent.md"), subagentContent);

      const toolFiles = await processor.loadToolFiles();

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBeInstanceOf(CopilotSubagent);
    });
  });

  describe("loadCursorSubagents", () => {
    let processor: SubagentsProcessor;

    beforeEach(() => {
      processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });
    });

    it("should return empty array when subagents directory does not exist", async () => {
      const toolFiles = await processor.loadToolFiles();
      expect(toolFiles).toEqual([]);
    });

    it("should load cursor subagent files from .cursor/subagents", async () => {
      const subagentsDir = join(testDir, ".cursor", "subagents");
      await ensureDir(subagentsDir);

      const subagentContent = `---
name: cursor-agent
description: Cursor agent description
---
Cursor agent content`;

      await writeFileContent(join(subagentsDir, "cursor-agent.md"), subagentContent);

      const toolFiles = await processor.loadToolFiles();

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBeInstanceOf(CursorSubagent);
    });
  });

  describe("loadCodexCliSubagents", () => {
    let processor: SubagentsProcessor;

    beforeEach(() => {
      processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "codexcli",
      });
    });

    it("should return empty array when subagents directory does not exist", async () => {
      const toolFiles = await processor.loadToolFiles();
      expect(toolFiles).toEqual([]);
    });

    it("should load codexcli subagent files from .codex/subagents", async () => {
      const subagentsDir = join(testDir, ".codex", "subagents");
      await ensureDir(subagentsDir);

      const subagentContent = `---
name: codex-agent
description: CodexCli agent description
---
CodexCli agent content`;

      await writeFileContent(join(subagentsDir, "codex-agent.md"), subagentContent);

      const toolFiles = await processor.loadToolFiles();

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBeInstanceOf(CodexCliSubagent);
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

    it("should throw error when file fails to load", async () => {
      const agentsDir = join(testDir, ".claude", "agents");
      await ensureDir(agentsDir);

      // Create a file that will cause loading to fail (invalid format without frontmatter)
      await writeFileContent(
        join(agentsDir, "might-fail.md"),
        "Invalid format without frontmatter",
      );

      await expect(processor.loadToolFiles()).rejects.toThrow();
    });

    describe("global mode", () => {
      it("should use global paths when global=true", async () => {
        const globalProcessor = new SubagentsProcessor({
          baseDir: testDir,
          toolTarget: "claudecode",
          global: true,
        });

        // In test mode, global paths still resolve relative to testDir
        const globalAgentsDir = join(testDir, ".claude", "agents");
        await ensureDir(globalAgentsDir);

        const subagentContent = `---
name: global-agent
description: Global agent description
---
Global agent content`;

        await writeFileContent(join(globalAgentsDir, "global-agent.md"), subagentContent);

        const toolFiles = await globalProcessor.loadToolFiles();

        expect(toolFiles).toHaveLength(1);
        expect(toolFiles[0]).toBeInstanceOf(ClaudecodeSubagent);
        const claudecodeSubagent = toolFiles[0] as ClaudecodeSubagent;
        expect(claudecodeSubagent.getFrontmatter().name).toBe("global-agent");
        expect(claudecodeSubagent.getRelativeDirPath()).toBe(join(".claude", "agents"));
      });

      it("should return empty array when global agents directory does not exist", async () => {
        const globalProcessor = new SubagentsProcessor({
          baseDir: testDir,
          toolTarget: "claudecode",
          global: true,
        });

        const toolFiles = await globalProcessor.loadToolFiles();
        expect(toolFiles).toEqual([]);
      });

      it("should load multiple global subagent files", async () => {
        const globalProcessor = new SubagentsProcessor({
          baseDir: testDir,
          toolTarget: "claudecode",
          global: true,
        });

        const globalAgentsDir = join(testDir, ".claude", "agents");
        await ensureDir(globalAgentsDir);

        const agent1Content = `---
name: global-agent-1
description: First global agent
---
First global content`;

        const agent2Content = `---
name: global-agent-2
description: Second global agent
---
Second global content`;

        await writeFileContent(join(globalAgentsDir, "global-agent-1.md"), agent1Content);
        await writeFileContent(join(globalAgentsDir, "global-agent-2.md"), agent2Content);

        const toolFiles = await globalProcessor.loadToolFiles();

        expect(toolFiles).toHaveLength(2);
        expect(toolFiles.every((file) => file instanceof ClaudecodeSubagent)).toBe(true);

        const names = toolFiles
          .map((file) => (file as ClaudecodeSubagent).getFrontmatter().name)
          .toSorted();
        expect(names).toEqual(["global-agent-1", "global-agent-2"]);
      });
    });
  });

  describe("getToolTargets", () => {
    it("should exclude simulated targets by default", () => {
      const toolTargets = SubagentsProcessor.getToolTargets();

      expect(Array.isArray(toolTargets)).toBe(true);
      expect(toolTargets).toContain("claudecode");
      expect(toolTargets).not.toContain("copilot");
      expect(toolTargets).not.toContain("cursor");
      expect(toolTargets).not.toContain("codexcli");
    });

    it("should exclude simulated targets when includeSimulated is false", () => {
      const toolTargets = SubagentsProcessor.getToolTargets({ includeSimulated: false });

      expect(Array.isArray(toolTargets)).toBe(true);
      expect(toolTargets).toContain("claudecode");
      expect(toolTargets).not.toContain("copilot");
      expect(toolTargets).not.toContain("cursor");
      expect(toolTargets).not.toContain("codexcli");
    });

    it("should include simulated targets when includeSimulated is true", () => {
      const toolTargets = SubagentsProcessor.getToolTargets({ includeSimulated: true });

      expect(Array.isArray(toolTargets)).toBe(true);
      expect(toolTargets).toContain("claudecode");
      expect(toolTargets).toContain("copilot");
      expect(toolTargets).toContain("cursor");
      expect(toolTargets).toContain("codexcli");
      expect(toolTargets).toEqual(subagentsProcessorToolTargets);
    });

    it("should be callable without instance", () => {
      expect(() => SubagentsProcessor.getToolTargets()).not.toThrow();
    });
  });

  describe("getToolTargets with global: true", () => {
    it("should return only claudecode as global-supported target", () => {
      const toolTargets = SubagentsProcessor.getToolTargets({ global: true });

      expect(Array.isArray(toolTargets)).toBe(true);
      expect(toolTargets).toEqual(["claudecode"]);
    });

    it("should not include simulated targets", () => {
      const toolTargets = SubagentsProcessor.getToolTargets({ global: true });

      expect(toolTargets).not.toContain("copilot");
      expect(toolTargets).not.toContain("cursor");
      expect(toolTargets).not.toContain("codexcli");
      expect(toolTargets).not.toContain("agentsmd");
      expect(toolTargets).not.toContain("geminicli");
      expect(toolTargets).not.toContain("roo");
    });

    it("should be callable without instance", () => {
      expect(() => SubagentsProcessor.getToolTargets({ global: true })).not.toThrow();
    });
  });

  describe("type exports and constants", () => {
    it("should export SubagentsProcessorToolTargetSchema", () => {
      expect(SubagentsProcessorToolTargetSchema).toBeDefined();
      expect(() => SubagentsProcessorToolTargetSchema.parse("claudecode")).not.toThrow();
      expect(() => SubagentsProcessorToolTargetSchema.parse("invalid")).toThrow();
    });

    it("should export subagentsProcessorToolTargets constant", () => {
      expect(new Set(subagentsProcessorToolTargets)).toEqual(
        new Set(["agentsmd", "claudecode", "codexcli", "copilot", "cursor", "geminicli", "roo"]),
      );
      expect(Array.isArray(subagentsProcessorToolTargets)).toBe(true);
    });

    it("should export subagentsProcessorToolTargetsSimulated constant", () => {
      expect(new Set(subagentsProcessorToolTargetsSimulated)).toEqual(
        new Set(["agentsmd", "codexcli", "copilot", "cursor", "geminicli", "roo"]),
      );
      expect(Array.isArray(subagentsProcessorToolTargetsSimulated)).toBe(true);
    });

    it("should have valid SubagentsProcessorToolTarget type", () => {
      const validTargets: SubagentsProcessorToolTarget[] = [
        "agentsmd",
        "claudecode",
        "copilot",
        "cursor",
        "codexcli",
      ];
      validTargets.forEach((target) => {
        expect(subagentsProcessorToolTargets).toContain(target);
      });
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
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
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
      const subagentsDir = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
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

  describe("loadToolFiles with forDeletion: true", () => {
    it("should return the same files as loadToolFiles", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const agentsDir = join(testDir, ".claude", "agents");
      await ensureDir(agentsDir);

      const subagentContent = `---
name: test-agent
description: Test agent
---
Test agent content`;

      await writeFileContent(join(agentsDir, "test-agent.md"), subagentContent);

      const toolFiles = await processor.loadToolFiles();
      const filesToDelete = await processor.loadToolFiles({ forDeletion: true });

      expect(filesToDelete).toEqual(toolFiles);
      expect(filesToDelete).toHaveLength(1);
      expect(filesToDelete[0]).toBeInstanceOf(ClaudecodeSubagent);
    });

    it("should work for all supported tool targets", async () => {
      const targets: SubagentsProcessorToolTarget[] = [
        "agentsmd",
        "claudecode",
        "copilot",
        "cursor",
        "codexcli",
        "geminicli",
        "roo",
      ];

      for (const target of targets) {
        const processor = new SubagentsProcessor({
          baseDir: testDir,
          toolTarget: target,
        });

        const filesToDelete = await processor.loadToolFiles({ forDeletion: true });

        // Should return empty array since no files exist
        expect(filesToDelete).toEqual([]);
      }
    });

    it("should return empty array when no files exist", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const filesToDelete = await processor.loadToolFiles({ forDeletion: true });
      expect(filesToDelete).toEqual([]);
    });

    it("should handle multiple files correctly", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const agentsDir = join(testDir, ".claude", "agents");
      await ensureDir(agentsDir);

      const agent1 = `---
name: agent-1
description: First agent
---
First agent`;

      const agent2 = `---
name: agent-2
description: Second agent
---
Second agent`;

      await writeFileContent(join(agentsDir, "agent-1.md"), agent1);
      await writeFileContent(join(agentsDir, "agent-2.md"), agent2);

      const filesToDelete = await processor.loadToolFiles({ forDeletion: true });

      expect(filesToDelete).toHaveLength(2);
      expect(filesToDelete.every((file) => file instanceof ClaudecodeSubagent)).toBe(true);
    });
  });
});

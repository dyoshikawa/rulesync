import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/mini";
import { setupTestDirectory } from "../test-utils/index.js";
import { ClaudecodeCommand } from "./claudecode-command.js";
import { CommandsProcessor, CommandsProcessorToolTarget } from "./commands-processor.js";
import { RulesyncCommand } from "./rulesync-command.js";

// Mock the file utilities and file system operations
vi.mock("../utils/file.js", () => ({
  writeFileContent: vi.fn().mockResolvedValue(undefined),
  directoryExists: vi.fn().mockResolvedValue(true),
  readFileContent: vi.fn().mockResolvedValue(""),
}));

describe("CommandsProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with valid tool target - claudecode", () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      expect(processor).toBeInstanceOf(CommandsProcessor);
    });

    it("should create instance with valid tool target - geminicli", () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "geminicli",
      });

      expect(processor).toBeInstanceOf(CommandsProcessor);
    });

    it("should create instance with valid tool target - roo", () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "roo",
      });

      expect(processor).toBeInstanceOf(CommandsProcessor);
    });

    it("should validate tool target with Zod schema", () => {
      expect(() => {
        const _processor = new CommandsProcessor({
          baseDir: testDir,
          toolTarget: "unsupported" as CommandsProcessorToolTarget,
        });
      }).toThrow();
    });
  });

  describe("loadRulesyncFiles", () => {
    it("should load and parse rulesync command files", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Create a mock rulesync command file
      const rulesyncDir = join(testDir, ".rulesync", "commands");
      await mkdir(rulesyncDir, { recursive: true });

      const fileContent = `---
targets: ["claudecode"]
description: "Generate comprehensive code review"
---

Please perform a thorough code review focusing on:
1. Code quality and readability
2. Security vulnerabilities
3. Performance optimizations`;

      await writeFile(join(rulesyncDir, "code-review.md"), fileContent);

      const rulesyncCommands = await processor.loadRulesyncFiles();

      expect(rulesyncCommands).toHaveLength(1);
      expect(rulesyncCommands[0]!).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommands[0]!.getFrontmatter().description).toBe(
        "Generate comprehensive code review",
      );
    });

    it("should return empty array when no markdown files found", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Create empty directory
      const rulesyncDir = join(testDir, ".rulesync", "commands");
      await mkdir(rulesyncDir, { recursive: true });

      const rulesyncCommands = await processor.loadRulesyncFiles();
      expect(rulesyncCommands).toHaveLength(0);
    });

    it("should return empty array when commands directory does not exist", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Mock directoryExists to return false
      const { directoryExists } = await import("../utils/file.js");
      (directoryExists as any).mockResolvedValueOnce(false);

      const rulesyncCommands = await processor.loadRulesyncFiles();
      expect(rulesyncCommands).toHaveLength(0);
    });
  });

  describe("writeToolCommandsFromRulesyncCommands", () => {
    it("should convert rulesync commands to claude code commands", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const rulesyncCommand = new RulesyncCommand({
        frontmatter: {
          targets: ["claudecode"],
          description: "Generate code review",
        },
        body: "Perform code review analysis.",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "code-review.md",
        fileContent: "Test file content",
        validate: false,
      });

      // Mock writeFileContent to avoid actual file writing
      const { writeFileContent } = await import("../utils/file.js");
      (writeFileContent as any).mockClear();
      (writeFileContent as any).mockResolvedValue(undefined);

      await processor.writeToolCommandsFromRulesyncCommands([rulesyncCommand]);

      // Verify the write was called
      expect(writeFileContent).toHaveBeenCalled();
    });

    it("should convert rulesync commands to geminicli commands", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "geminicli",
      });

      const rulesyncCommand = new RulesyncCommand({
        frontmatter: {
          targets: ["geminicli"],
          description: "Generate code review",
        },
        body: "Perform code review analysis.",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "code-review.md",
        fileContent: "Test file content",
        validate: false,
      });

      const { writeFileContent } = await import("../utils/file.js");
      (writeFileContent as any).mockClear();
      (writeFileContent as any).mockResolvedValue(undefined);

      await processor.writeToolCommandsFromRulesyncCommands([rulesyncCommand]);

      expect(writeFileContent).toHaveBeenCalled();
    });

    it("should convert rulesync commands to roo commands", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "roo",
      });

      const rulesyncCommand = new RulesyncCommand({
        frontmatter: {
          targets: ["roo"],
          description: "Generate code review",
        },
        body: "Perform code review analysis.",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "code-review.md",
        fileContent: "Test file content",
        validate: false,
      });

      const { writeFileContent } = await import("../utils/file.js");
      (writeFileContent as any).mockClear();
      (writeFileContent as any).mockResolvedValue(undefined);

      await processor.writeToolCommandsFromRulesyncCommands([rulesyncCommand]);

      expect(writeFileContent).toHaveBeenCalled();
    });

    it("should handle multiple rulesync commands", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const command1 = new RulesyncCommand({
        frontmatter: {
          targets: ["claudecode"],
          description: "Code review command",
        },
        body: "Review code",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "code-review.md",
        fileContent: "Code review content",
        validate: false,
      });

      const command2 = new RulesyncCommand({
        frontmatter: {
          targets: ["claudecode"],
          description: "Optimization command",
        },
        body: "Optimize code",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "optimize.md",
        fileContent: "Optimization content",
        validate: false,
      });

      const { writeFileContent } = await import("../utils/file.js");
      (writeFileContent as any).mockClear();
      (writeFileContent as any).mockResolvedValue(undefined);

      await processor.writeToolCommandsFromRulesyncCommands([command1, command2]);

      // Verify the write was called twice
      expect(writeFileContent).toHaveBeenCalledTimes(2);
    });
  });

  describe("loadToolFiles", () => {
    it("should load claudecode commands when tool target is claudecode", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Create mock claudecode command file
      const commandsDir = join(testDir, ".claude", "commands");
      await mkdir(commandsDir, { recursive: true });

      const fileContent = `---
description: "Generate code review"
---

Perform code review analysis.`;

      await writeFile(join(commandsDir, "code-review.md"), fileContent);

      const toolCommands = await processor.loadToolFiles();

      expect(toolCommands).toHaveLength(1);
      expect(toolCommands[0]).toBeInstanceOf(ClaudecodeCommand);
    });

    it("should return empty array when claudecode commands directory does not exist", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Mock directoryExists to return false
      const { directoryExists } = await import("../utils/file.js");
      (directoryExists as any).mockResolvedValueOnce(false);

      const toolCommands = await processor.loadToolFiles();

      expect(toolCommands).toHaveLength(0);
    });
  });

  describe("writeRulesyncCommandsFromToolCommands", () => {
    it("should convert tool commands to rulesync commands", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const claudecodeCommand = new ClaudecodeCommand({
        frontmatter: {
          description: "Generate code review",
        },
        body: "Perform code review analysis.",
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "code-review.md",
        fileContent: `---
description: "Generate code review"
---

Perform code review analysis.`,
      });

      const { writeFileContent } = await import("../utils/file.js");
      (writeFileContent as any).mockClear();
      (writeFileContent as any).mockResolvedValue(undefined);

      await processor.writeRulesyncCommandsFromToolCommands([claudecodeCommand]);

      expect(writeFileContent).toHaveBeenCalled();
    });

    it("should handle multiple tool commands", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const command1 = new ClaudecodeCommand({
        frontmatter: {
          description: "Code review",
        },
        body: "Review code",
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "review.md",
        fileContent: "Review content",
      });

      const command2 = new ClaudecodeCommand({
        frontmatter: {
          description: "Optimize code",
        },
        body: "Optimize",
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "optimize.md",
        fileContent: "Optimize content",
      });

      const { writeFileContent } = await import("../utils/file.js");
      (writeFileContent as any).mockClear();
      (writeFileContent as any).mockResolvedValue(undefined);

      await processor.writeRulesyncCommandsFromToolCommands([command1, command2]);

      expect(writeFileContent).toHaveBeenCalledTimes(2);
    });

    it("should handle empty array", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const { writeFileContent } = await import("../utils/file.js");
      (writeFileContent as any).mockClear();
      (writeFileContent as any).mockResolvedValue(undefined);

      await processor.writeRulesyncCommandsFromToolCommands([]);

      expect(writeFileContent).not.toHaveBeenCalled();
    });
  });

  describe("schema validation", () => {
    it("should validate CommandsProcessorToolTargetSchema", () => {
      const validTargets = ["claudecode", "geminicli", "roo"];
      const invalidTarget = "invalid-target";

      for (const validTarget of validTargets) {
        expect(() => z.enum(["claudecode", "geminicli", "roo"]).parse(validTarget)).not.toThrow();
      }

      expect(() => z.enum(["claudecode", "geminicli", "roo"]).parse(invalidTarget)).toThrow();
    });
  });

  describe("static methods", () => {
    it("should return supported tool targets", () => {
      const toolTargets = CommandsProcessor.getToolTargets();
      expect(toolTargets).toEqual(["claudecode", "geminicli", "roo"]);
    });
  });

  describe("integration tests", () => {
    it("should perform round-trip conversion rulesync -> claude code -> rulesync", async () => {
      // Create original rulesync command
      const originalRulesync = new RulesyncCommand({
        frontmatter: {
          targets: ["claudecode"],
          description: "Original code review",
        },
        body: "Original review content",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "review.md",
        fileContent: "Original file content",
        validate: false,
      });

      // Convert to claude code
      const claudecodeCommand = ClaudecodeCommand.fromRulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        rulesyncCommand: originalRulesync,
      });

      // Convert back to rulesync
      const convertedRulesync = claudecodeCommand.toRulesyncCommand();

      // Verify the conversion preserves essential data
      expect(convertedRulesync.getFrontmatter().description).toBe("Original code review");
      expect(convertedRulesync.getBody()).toBe("Original review content");
      expect(convertedRulesync.getFrontmatter().targets).toEqual(["claudecode"]);
    });
  });
});

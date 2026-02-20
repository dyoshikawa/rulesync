import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { OpenCodeCommand, OpenCodeCommandFrontmatterSchema } from "./opencode-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("OpenCodeCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const result = await setupTestDirectory();
    testDir = result.testDir;
    cleanup = result.cleanup;
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create a command with optional OpenCode fields", () => {
      const command = new OpenCodeCommand({
        baseDir: testDir,
        relativeDirPath: join(".opencode", "command"),
        relativeFilePath: "test.md",
        frontmatter: {
          description: "Run tests",
          agent: "build",
          subtask: true,
          model: "anthropic/claude-3-5-sonnet-20241022",
        },
        body: "Run the full suite",
      });

      expect(command.getBody()).toBe("Run the full suite");
      expect(command.getFrontmatter()).toEqual({
        description: "Run tests",
        agent: "build",
        subtask: true,
        model: "anthropic/claude-3-5-sonnet-20241022",
      });
    });

    it("should validate frontmatter when enabled", () => {
      expect(() => {
        new OpenCodeCommand({
          baseDir: testDir,
          relativeDirPath: join(".opencode", "command"),
          relativeFilePath: "invalid.md",
          frontmatter: { description: 123 as unknown as string },
          body: "content",
          validate: true,
        });
      }).toThrow();
    });
  });

  describe("getSettablePaths", () => {
    it("should return project and global paths", () => {
      expect(OpenCodeCommand.getSettablePaths()).toEqual({
        relativeDirPath: join(".opencode", "command"),
      });
      expect(OpenCodeCommand.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".config", "opencode", "command"),
      });
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should merge opencode frontmatter fields and respect global paths", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "custom.md",
        frontmatter: {
          targets: ["opencode"],
          description: "Analyze coverage",
          opencode: { subtask: true },
        },
        body: "Analyze coverage details",
        fileContent: stringifyFrontmatter("Analyze coverage details", {
          targets: ["opencode"],
          description: "Analyze coverage",
          opencode: { subtask: true },
        }),
      });

      const command = OpenCodeCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        global: true,
      });

      expect(command.getFrontmatter()).toEqual({ description: "Analyze coverage", subtask: true });
      expect(command.getRelativeDirPath()).toBe(join(".config", "opencode", "command"));
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand with opencode metadata", () => {
      const command = new OpenCodeCommand({
        baseDir: testDir,
        relativeDirPath: join(".opencode", "command"),
        relativeFilePath: "custom.md",
        frontmatter: { description: "Create component", agent: "plan" },
        body: "Create a new component named $ARGUMENTS",
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["*"],
        description: "Create component",
        opencode: { agent: "plan" },
      });
      expect(rulesyncCommand.getRelativeDirPath()).toBe(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
    });
  });

  describe("fromFile", () => {
    it("should load a command file and parse frontmatter", async () => {
      const commandDir = join(testDir, ".opencode", "command");
      await ensureDir(commandDir);
      const filePath = join(commandDir, "task.md");
      await writeFileContent(
        filePath,
        `---\ndescription: Review component\nagent: review\n---\nCheck @src/components/Button.tsx`,
      );

      const command = await OpenCodeCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "task.md",
      });

      expect(command).toBeInstanceOf(OpenCodeCommand);
      expect(OpenCodeCommandFrontmatterSchema.safeParse(command.getFrontmatter()).success).toBe(
        true,
      );
      expect(command.getBody()).toBe("Check @src/components/Button.tsx");
    });
  });
});

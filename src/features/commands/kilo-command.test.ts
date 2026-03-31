import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { KiloCommand, KiloCommandFrontmatterSchema } from "./kilo-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("KiloCommand", () => {
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
    it("should create a command with optional Kilo fields", () => {
      const command = new KiloCommand({
        baseDir: testDir,
        relativeDirPath: join(".kilo", "commands"),
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
        new KiloCommand({
          baseDir: testDir,
          relativeDirPath: join(".kilo", "commands"),
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
      expect(KiloCommand.getSettablePaths()).toEqual({
        relativeDirPath: join(".kilo", "commands"),
      });
      expect(KiloCommand.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".config", "kilo", "commands"),
      });
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should merge kilo frontmatter fields and respect global paths", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "custom.md",
        frontmatter: {
          targets: ["kilo"],
          description: "Analyze coverage",
          kilo: { subtask: true },
        },
        body: "Analyze coverage details",
        fileContent: stringifyFrontmatter("Analyze coverage details", {
          targets: ["kilo"],
          description: "Analyze coverage",
          kilo: { subtask: true },
        }),
      });

      const command = KiloCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        global: true,
      });

      expect(command.getFrontmatter()).toEqual({ description: "Analyze coverage", subtask: true });
      expect(command.getRelativeDirPath()).toBe(join(".config", "kilo", "commands"));
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand with kilo metadata", () => {
      const command = new KiloCommand({
        baseDir: testDir,
        relativeDirPath: join(".kilo", "commands"),
        relativeFilePath: "custom.md",
        frontmatter: { description: "Create component", agent: "plan" },
        body: "Create a new component named $ARGUMENTS",
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["*"],
        description: "Create component",
        kilo: { agent: "plan" },
      });
      expect(rulesyncCommand.getRelativeDirPath()).toBe(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
    });
  });

  describe("fromFile", () => {
    it("should load a command file and parse frontmatter", async () => {
      const commandDir = join(testDir, ".kilo", "commands");
      await ensureDir(commandDir);
      const filePath = join(commandDir, "task.md");
      await writeFileContent(
        filePath,
        `---\ndescription: Review component\nagent: review\n---\nCheck @src/components/Button.tsx`,
      );

      const command = await KiloCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "task.md",
      });

      expect(command).toBeInstanceOf(KiloCommand);
      expect(KiloCommandFrontmatterSchema.safeParse(command.getFrontmatter()).success).toBe(true);
      expect(command.getBody()).toBe("Check @src/components/Button.tsx");
    });
  });
});

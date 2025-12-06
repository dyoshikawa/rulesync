import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { OpencodeCommand, OpencodeCommandFrontmatterSchema } from "./opencode-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("OpencodeCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("creates a valid instance with frontmatter and body", () => {
      const command = new OpencodeCommand({
        baseDir: testDir,
        relativeDirPath: ".opencode/command",
        relativeFilePath: "deploy.md",
        frontmatter: { description: "Deploy app", agent: "build" },
        body: "Run deployment",
      });

      expect(command).toBeInstanceOf(OpencodeCommand);
      expect(command.getBody()).toBe("Run deployment");
      expect(command.getFrontmatter()).toEqual({ description: "Deploy app", agent: "build" });
    });

    it("validates frontmatter when validate is true", () => {
      expect(() => {
        new OpencodeCommand({
          baseDir: testDir,
          relativeDirPath: ".opencode/command",
          relativeFilePath: "deploy.md",
          frontmatter: { description: 123 as any },
          body: "Run deployment",
          validate: true,
        });
      }).toThrow();
    });
  });

  describe("toRulesyncCommand", () => {
    it("converts to a RulesyncCommand with opencode frontmatter", () => {
      const opencodeCommand = new OpencodeCommand({
        baseDir: testDir,
        relativeDirPath: ".opencode/command",
        relativeFilePath: "deploy.md",
        frontmatter: { description: "Deploy app", agent: "build" },
        body: "Run deployment",
      });

      const rulesyncCommand = opencodeCommand.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["opencode"],
        description: "Deploy app",
        opencode: { agent: "build" },
      });
      expect(rulesyncCommand.getBody()).toBe("Run deployment");
    });
  });

  describe("fromRulesyncCommand", () => {
    it("builds an OpencodeCommand using opencode-specific fields", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "deploy.md",
        frontmatter: {
          targets: ["opencode"],
          description: "Deploy app",
          opencode: { agent: "build", model: "openaipreview" },
        },
        body: "Run deployment",
      });

      const opencodeCommand = OpencodeCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
      });

      expect(opencodeCommand.getFrontmatter()).toEqual({
        description: "Deploy app",
        agent: "build",
        model: "openaipreview",
      });
      expect(opencodeCommand.getBody()).toBe("Run deployment");
      expect(opencodeCommand.getRelativeDirPath()).toBe(".opencode/command");
    });

    it("uses global command path when requested", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "deploy.md",
        frontmatter: { targets: ["opencode"], description: "Deploy" },
        body: "Run deployment",
      });

      const opencodeCommand = OpencodeCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        global: true,
      });

      expect(opencodeCommand.getRelativeDirPath()).toBe(".config/opencode/command");
    });
  });

  describe("fromFile", () => {
    it("reads a command file and parses frontmatter", async () => {
      const commandDir = join(testDir, ".opencode", "command");
      await ensureDir(commandDir);
      await writeFileContent(
        join(commandDir, "deploy.md"),
        `---\ndescription: Deploy app\nagent: build\n---\nRun deployment`,
      );

      const command = await OpencodeCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "deploy.md",
      });

      expect(command.getFrontmatter()).toEqual({ description: "Deploy app", agent: "build" });
      expect(command.getBody()).toBe("Run deployment");
    });
  });

  describe("validate", () => {
    it("returns failure result when frontmatter invalid", () => {
      const command = new OpencodeCommand({
        baseDir: testDir,
        relativeDirPath: ".opencode/command",
        relativeFilePath: "deploy.md",
        frontmatter: { description: 123 as any },
        body: "Run deployment",
        validate: false,
      });

      const result = command.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Invalid frontmatter");
    });
  });
});

describe("OpencodeCommandFrontmatterSchema", () => {
  it("accepts description and extra fields", () => {
    const result = OpencodeCommandFrontmatterSchema.safeParse({ description: "Test", agent: "build" });
    expect(result.success).toBe(true);
  });
});

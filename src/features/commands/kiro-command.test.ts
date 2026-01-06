import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { KiroCommand } from "./kiro-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("KiroCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validJson = {
    enabled: true,
    name: "Test Hook",
    description: "Test command",
    version: "1",
    when: { type: "userTriggered" as const },
    then: { type: "askAgent" as const, prompt: "# Sample prompt\n\nFollow these steps." },
  };

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return hooks path for project mode", () => {
      const paths = KiroCommand.getSettablePaths();

      expect(paths).toEqual({ relativeDirPath: join(".kiro", "hooks") });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid JSON", () => {
      const command = new KiroCommand({
        baseDir: testDir,
        relativeDirPath: join(".kiro", "hooks"),
        relativeFilePath: "test.kiro.hook",
        json: validJson,
        validate: true,
      });

      expect(command).toBeInstanceOf(KiroCommand);
      expect(command.getJson()).toEqual(validJson);
    });

    it("should throw error for invalid JSON when validate is true", () => {
      expect(() => {
        new KiroCommand({
          baseDir: testDir,
          relativeDirPath: join(".kiro", "hooks"),
          relativeFilePath: "test.kiro.hook",
          json: { name: "test" } as typeof validJson,
          validate: true,
        });
      }).toThrow();
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand", () => {
      const command = new KiroCommand({
        baseDir: testDir,
        relativeDirPath: join(".kiro", "hooks"),
        relativeFilePath: "test.kiro.hook",
        json: validJson,
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getFrontmatter().targets).toEqual(["kiro"]);
      expect(rulesyncCommand.getFrontmatter().description).toBe("Test command");
      expect(rulesyncCommand.getBody()).toBe("# Sample prompt\n\nFollow these steps.");
      expect(rulesyncCommand.getRelativeDirPath()).toBe(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      expect(rulesyncCommand.getRelativeFilePath()).toBe("test.md");
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create KiroCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "hook.md",
        frontmatter: { targets: ["kiro"], description: "Test hook" },
        body: "Execute this task",
        fileContent: "",
        validate: true,
      });

      const command = KiroCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
      });

      expect(command).toBeInstanceOf(KiroCommand);
      expect(command.getRelativeDirPath()).toBe(join(".kiro", "hooks"));
      expect(command.getRelativeFilePath()).toBe("hook.kiro.hook");
      expect(command.getJson().name).toBe("Test hook");
      expect(command.getJson().description).toBe("Test hook");
      expect(command.getJson().then.prompt).toBe("Execute this task");
      expect(command.getJson().when.type).toBe("userTriggered");
    });
  });

  describe("validate", () => {
    it("should succeed for valid JSON", () => {
      const command = new KiroCommand({
        baseDir: testDir,
        relativeDirPath: join(".kiro", "hooks"),
        relativeFilePath: "test.kiro.hook",
        json: validJson,
        validate: false,
      });

      expect(command.validate()).toEqual({ success: true, error: null });
    });
  });

  describe("fromFile", () => {
    it("should load command from file", async () => {
      const hooksDir = join(testDir, ".kiro", "hooks");
      const filePath = join(hooksDir, "test.kiro.hook");
      await writeFileContent(filePath, JSON.stringify(validJson, null, 2));

      const command = await KiroCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "test.kiro.hook",
      });

      expect(command).toBeInstanceOf(KiroCommand);
      expect(command.getRelativeDirPath()).toBe(join(".kiro", "hooks"));
      expect(command.getJson()).toEqual(validJson);
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should return true when rulesync targets include kiro", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["kiro"], description: "Test" },
        body: "body",
        fileContent: "",
        validate: true,
      });

      expect(KiroCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return true when rulesync targets include wildcard", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["*"], description: "Test" },
        body: "body",
        fileContent: "",
        validate: true,
      });

      expect(KiroCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return false when rulesync targets do not include kiro", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["claudecode"], description: "Test" },
        body: "body",
        fileContent: "",
        validate: true,
      });

      expect(KiroCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const command = KiroCommand.forDeletion({
        baseDir: testDir,
        relativeDirPath: join(".kiro", "hooks"),
        relativeFilePath: "test.kiro.hook",
      });

      expect(command).toBeInstanceOf(KiroCommand);
      expect(command.getRelativeFilePath()).toBe("test.kiro.hook");
    });
  });
});

import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { readFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { JunieCommand } from "./junie-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

vi.mock("../../utils/file.js");

describe("JunieCommand", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create an instance with correct properties", () => {
      const params = {
        baseDir: "/project",
        relativeDirPath: ".junie/commands",
        relativeFilePath: "test-command.md",
        frontmatter: { description: "Test description" },
        body: "Test body",
        validate: true,
      };

      const command = new JunieCommand(params);

      expect(command.getRelativeDirPath()).toBe(".junie/commands");
      expect(command.getRelativeFilePath()).toBe("test-command.md");
      expect(command.getFrontmatter()).toEqual({ description: "Test description" });
      expect(command.getBody()).toBe("Test body");
    });

    it("should throw error if frontmatter is invalid and validate is true", () => {
      const params = {
        baseDir: "/project",
        relativeDirPath: ".junie/commands",
        relativeFilePath: "test-command.md",
        frontmatter: { description: 123 as any },
        body: "Test body",
        validate: true,
      };

      expect(() => new JunieCommand(params)).toThrow(/Invalid frontmatter/);
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths", () => {
      const paths = JunieCommand.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".junie", "commands"));
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand correctly", () => {
      const command = new JunieCommand({
        baseDir: "/project",
        relativeDirPath: ".junie/commands",
        relativeFilePath: "test-command.md",
        frontmatter: { description: "Test description" },
        body: "Test body",
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getRelativeFilePath()).toBe("test-command.md");
      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["*"],
        description: "Test description",
      });
      expect(rulesyncCommand.getBody()).toBe("Test body");
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create JunieCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: "/project",
        relativeDirPath: ".rulesync/command",
        relativeFilePath: "test-command.md",
        fileContent: "",
        frontmatter: {
          targets: ["junie"],
          description: "Test description",
        },
        body: "Test body",
      });

      const command = JunieCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      expect(command).toBeInstanceOf(JunieCommand);
      expect(command.getRelativeDirPath()).toBe(join(".junie", "commands"));
      expect(command.getRelativeFilePath()).toBe("test-command.md");
      expect(command.getFrontmatter()).toEqual({ description: "Test description" });
      expect(command.getBody()).toBe("Test body");
    });
  });

  describe("fromFile", () => {
    it("should load JunieCommand from file", async () => {
      const fileContent = stringifyFrontmatter("Test body", { description: "Test description" });
      vi.mocked(readFileContent).mockResolvedValue(fileContent);

      const command = await JunieCommand.fromFile({
        baseDir: "/project",
        relativeFilePath: "test-command.md",
      });

      expect(command).toBeInstanceOf(JunieCommand);
      expect(command.getBody()).toBe("Test body");
      expect(command.getFrontmatter()).toEqual({ description: "Test description" });
    });
  });
});

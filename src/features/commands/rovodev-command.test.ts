import { join } from "node:path";

import { dump, load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { isRecord } from "../../utils/type-guards.js";
import { RovodevCommand } from "./rovodev-command.js";
import { RulesyncCommand } from "./rulesync-command.js";
import { ToolCommand } from "./tool-command.js";

describe("RovodevCommand", () => {
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
    it("should create a valid RovodevCommand instance", () => {
      const command = new RovodevCommand({
        outputRoot: testDir,
        relativeDirPath: join(".rovodev", "prompts"),
        relativeFilePath: "review-pr.md",
        name: "review-pr",
        description: "Review a pull request",
        body: "Check the PR diff and provide feedback.",
      });

      expect(command).toBeInstanceOf(RovodevCommand);
      expect(command.getName()).toBe("review-pr");
      expect(command.getDescription()).toBe("Review a pull request");
      expect(command.getBody()).toBe("Check the PR diff and provide feedback.");
    });

    it("should write the body verbatim as file content (no frontmatter)", () => {
      const command = new RovodevCommand({
        outputRoot: testDir,
        relativeDirPath: join(".rovodev", "prompts"),
        relativeFilePath: "review-pr.md",
        name: "review-pr",
        description: "Review a pull request",
        body: "Check the PR diff and provide feedback.",
      });

      expect(command.getFileContent()).toBe("Check the PR diff and provide feedback.");
    });

    it("should throw when validate is true and name is empty", () => {
      expect(() => {
        new RovodevCommand({
          outputRoot: testDir,
          relativeDirPath: join(".rovodev", "prompts"),
          relativeFilePath: "review-pr.md",
          name: "",
          description: "Review a pull request",
          body: "Body",
          validate: true,
        });
      }).toThrow(/must not be empty/);
    });

    it("should skip validation when validate is false", () => {
      expect(() => {
        new RovodevCommand({
          outputRoot: testDir,
          relativeDirPath: join(".rovodev", "prompts"),
          relativeFilePath: "review-pr.md",
          name: "",
          description: "",
          body: "",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("getSettablePaths", () => {
    it("should return .rovodev/prompts as relativeDirPath", () => {
      const paths = RovodevCommand.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".rovodev", "prompts"));
    });

    it("should return the same relativeDirPath in global mode (outputRoot switches to home)", () => {
      const paths = RovodevCommand.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".rovodev", "prompts"));
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand correctly", () => {
      const command = new RovodevCommand({
        outputRoot: testDir,
        relativeDirPath: join(".rovodev", "prompts"),
        relativeFilePath: "review-pr.md",
        name: "review-pr",
        description: "Review a pull request",
        body: "Check the PR diff and provide feedback.",
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getRelativeFilePath()).toBe("review-pr.md");
      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["*"],
        description: "Review a pull request",
      });
      expect(rulesyncCommand.getBody()).toBe("Check the PR diff and provide feedback.");
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create RovodevCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "review-pr.md",
        fileContent: "",
        frontmatter: {
          targets: ["rovodev"],
          description: "Review a pull request",
        },
        body: "Check the PR diff and provide feedback.",
      });

      const command = RovodevCommand.fromRulesyncCommand({ rulesyncCommand });

      expect(command).toBeInstanceOf(RovodevCommand);
      expect(command.getRelativeDirPath()).toBe(join(".rovodev", "prompts"));
      expect(command.getRelativeFilePath()).toBe("review-pr.md");
      expect(command.getName()).toBe("review-pr");
      expect(command.getDescription()).toBe("Review a pull request");
      expect(command.getBody()).toBe("Check the PR diff and provide feedback.");
    });

    it("should use global path when global is true", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "review-pr.md",
        fileContent: "",
        frontmatter: {
          targets: ["rovodev"],
          description: "Review a pull request",
        },
        body: "Body",
      });

      const command = RovodevCommand.fromRulesyncCommand({ rulesyncCommand, global: true });

      expect(command.getRelativeDirPath()).toBe(join(".rovodev", "prompts"));
    });

    it("should default description to an empty string when missing", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "no-desc.md",
        fileContent: "",
        frontmatter: {
          targets: ["rovodev"],
        },
        body: "Body",
      });

      const command = RovodevCommand.fromRulesyncCommand({ rulesyncCommand });

      expect(command.getDescription()).toBe("");
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should return true if targets includes *", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        fileContent: "",
        frontmatter: { targets: ["*"], description: "Test" },
        body: "Body",
      });

      expect(RovodevCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return true if targets includes rovodev", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        fileContent: "",
        frontmatter: { targets: ["rovodev"], description: "Test" },
        body: "Body",
      });

      expect(RovodevCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return false if targets does not include rovodev or *", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        fileContent: "",
        frontmatter: { targets: ["other-tool"] as any, description: "Test" },
        body: "Body",
      });

      expect(RovodevCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(false);
    });
  });

  describe("fromFile", () => {
    it("should load RovodevCommand from a content file with no manifest present", async () => {
      const relativeDirPath = join(".rovodev", "prompts");
      const relativeFilePath = "review-pr.md";
      const body = "Check the PR diff and provide feedback.";

      await ensureDir(join(testDir, relativeDirPath));
      await writeFileContent(join(testDir, relativeDirPath, relativeFilePath), body);

      const command = await RovodevCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath,
      });

      expect(command).toBeInstanceOf(RovodevCommand);
      expect(command.getName()).toBe("review-pr");
      expect(command.getDescription()).toBe("");
      expect(command.getBody()).toBe(body);
    });

    it("should recover the description from the sibling prompts.yml manifest", async () => {
      const relativeDirPath = join(".rovodev", "prompts");
      const relativeFilePath = "review-pr.md";
      const body = "Check the PR diff and provide feedback.";

      await ensureDir(join(testDir, relativeDirPath));
      await writeFileContent(join(testDir, relativeDirPath, relativeFilePath), body);
      await writeFileContent(
        join(testDir, ".rovodev", "prompts.yml"),
        dump({
          prompts: [
            {
              name: "review-pr",
              description: "Review a pull request",
              content_file: "prompts/review-pr.md",
            },
          ],
        }),
      );

      const command = await RovodevCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath,
      });

      expect(command.getDescription()).toBe("Review a pull request");
    });

    it("should load RovodevCommand from a global content file", async () => {
      const relativeDirPath = join(".rovodev", "prompts");
      const relativeFilePath = "global-prompt.md";
      const body = "Global body";

      await ensureDir(join(testDir, relativeDirPath));
      await writeFileContent(join(testDir, relativeDirPath, relativeFilePath), body);

      const command = await RovodevCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath,
        global: true,
      });

      expect(command).toBeInstanceOf(RovodevCommand);
      expect(command.getRelativeDirPath()).toBe(join(".rovodev", "prompts"));
      expect(command.getBody()).toBe(body);
    });

    it("should tolerate an unparsable prompts.yml manifest", async () => {
      const relativeDirPath = join(".rovodev", "prompts");
      const relativeFilePath = "review-pr.md";
      const body = "Body";

      await ensureDir(join(testDir, relativeDirPath));
      await writeFileContent(join(testDir, relativeDirPath, relativeFilePath), body);
      await writeFileContent(join(testDir, ".rovodev", "prompts.yml"), "not: [valid: yaml");

      const command = await RovodevCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath,
      });

      expect(command.getDescription()).toBe("");
    });
  });

  describe("forDeletion", () => {
    it("should create a minimal RovodevCommand for deletion", () => {
      const command = RovodevCommand.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".rovodev", "prompts"),
        relativeFilePath: "review-pr.md",
      });

      expect(command).toBeInstanceOf(RovodevCommand);
      expect(command.getRelativeDirPath()).toBe(join(".rovodev", "prompts"));
      expect(command.getRelativeFilePath()).toBe("review-pr.md");
      expect(command.getBody()).toBe("");
      expect(command.isDeletable()).toBe(true);
    });
  });

  describe("getAuxiliaryFiles", () => {
    it("should return an empty array when there are no RovodevCommand instances", async () => {
      const auxiliaryFiles = await RovodevCommand.getAuxiliaryFiles({
        toolCommands: [],
        outputRoot: testDir,
      });

      expect(auxiliaryFiles).toEqual([]);
    });

    it("should build a prompts.yml manifest entry per command, sorted by name", async () => {
      const first = new RovodevCommand({
        outputRoot: testDir,
        relativeDirPath: join(".rovodev", "prompts"),
        relativeFilePath: "zebra.md",
        name: "zebra",
        description: "Zebra prompt",
        body: "Zebra body",
      });
      const second = new RovodevCommand({
        outputRoot: testDir,
        relativeDirPath: join(".rovodev", "prompts"),
        relativeFilePath: "alpha.md",
        name: "alpha",
        description: "Alpha prompt",
        body: "Alpha body",
      });

      const auxiliaryFiles = await RovodevCommand.getAuxiliaryFiles({
        toolCommands: [first, second],
        outputRoot: testDir,
      });

      expect(auxiliaryFiles).toHaveLength(1);
      const manifest = auxiliaryFiles[0];
      expect(manifest).toBeDefined();
      expect(manifest?.getRelativeDirPath()).toBe(".rovodev");
      expect(manifest?.getRelativeFilePath()).toBe("prompts.yml");
      expect(manifest?.isDeletable()).toBe(false);

      const parsed = load(manifest?.getFileContent() ?? "");
      expect(parsed).toEqual({
        prompts: [
          { name: "alpha", description: "Alpha prompt", content_file: "prompts/alpha.md" },
          { name: "zebra", description: "Zebra prompt", content_file: "prompts/zebra.md" },
        ],
      });
    });

    it("should ignore non-RovodevCommand tool commands", async () => {
      const other = { relativeFilePath: "not-a-rovodev-command" } as unknown as ToolCommand;

      const auxiliaryFiles = await RovodevCommand.getAuxiliaryFiles({
        toolCommands: [other],
        outputRoot: testDir,
      });

      expect(auxiliaryFiles).toEqual([]);
    });

    it("should fully replace the prompts array while preserving other top-level keys", async () => {
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(
        join(testDir, ".rovodev", "prompts.yml"),
        dump({
          some_other_setting: true,
          prompts: [
            { name: "stale", description: "Stale prompt", content_file: "prompts/stale.md" },
          ],
        }),
      );

      const command = new RovodevCommand({
        outputRoot: testDir,
        relativeDirPath: join(".rovodev", "prompts"),
        relativeFilePath: "review-pr.md",
        name: "review-pr",
        description: "Review a pull request",
        body: "Body",
      });

      const auxiliaryFiles = await RovodevCommand.getAuxiliaryFiles({
        toolCommands: [command],
        outputRoot: testDir,
      });

      const parsed = load(auxiliaryFiles[0]?.getFileContent() ?? "");
      expect(isRecord(parsed) && parsed.some_other_setting).toBe(true);
      expect(parsed).toEqual({
        some_other_setting: true,
        prompts: [
          {
            name: "review-pr",
            description: "Review a pull request",
            content_file: "prompts/review-pr.md",
          },
        ],
      });
    });

    it("should start fresh when the existing manifest cannot be parsed", async () => {
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(join(testDir, ".rovodev", "prompts.yml"), "not: [valid: yaml");

      const command = new RovodevCommand({
        outputRoot: testDir,
        relativeDirPath: join(".rovodev", "prompts"),
        relativeFilePath: "review-pr.md",
        name: "review-pr",
        description: "Review a pull request",
        body: "Body",
      });

      const auxiliaryFiles = await RovodevCommand.getAuxiliaryFiles({
        toolCommands: [command],
        outputRoot: testDir,
      });

      const parsed = load(auxiliaryFiles[0]?.getFileContent() ?? "");
      expect(parsed).toEqual({
        prompts: [
          {
            name: "review-pr",
            description: "Review a pull request",
            content_file: "prompts/review-pr.md",
          },
        ],
      });
    });
  });
});

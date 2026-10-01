import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { RulesyncTargets } from "../../types/tool-targets.js";
import { writeFileContent } from "../../utils/file.js";
import { CodewhaleCommand, parseCodewhaleCommandFile } from "./codewhale-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

const commandsDir = join(".codewhale", "commands");

const buildCommand = (
  targets: RulesyncTargets,
  extra: Record<string, unknown> = {},
  body = "Body",
): RulesyncCommand =>
  new RulesyncCommand({
    relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
    relativeFilePath: "test.md",
    frontmatter: { targets, description: "Test", ...extra },
    body,
    fileContent: "",
  });

describe("CodewhaleCommand", () => {
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

  describe("getSettablePaths", () => {
    it("should return .codewhale/commands for both scopes", () => {
      expect(CodewhaleCommand.getSettablePaths().relativeDirPath).toBe(commandsDir);
      expect(CodewhaleCommand.getSettablePaths({ global: true }).relativeDirPath).toBe(commandsDir);
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should write description and the codewhale section on single lines", () => {
      const command = CodewhaleCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: buildCommand(
          ["*"],
          {
            description: "A long description\nthat spans two lines",
            codewhale: {
              usage: "/test <path>",
              "allowed-tools": ["read_file", "grep_files"],
              aliases: ["t", "tst"],
              hidden: false,
            },
          },
          "Run $ARGUMENTS",
        ),
      });

      expect(command.getRelativeDirPath()).toBe(commandsDir);
      expect(command.getRelativeFilePath()).toBe("test.md");
      expect(command.getFileContent()).toBe(
        [
          "---",
          "description: A long description that spans two lines",
          "usage: /test <path>",
          "allowed-tools: read_file, grep_files",
          "aliases: t, tst",
          "hidden: false",
          "---",
          "Run $ARGUMENTS",
          "",
        ].join("\n"),
      );
    });

    it("should write values verbatim instead of YAML-quoting them", () => {
      const command = CodewhaleCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: buildCommand(["*"], {
          description: "Review: don't merge",
          codewhale: { "allowed-tools": ["*", "read_file"], usage: '"quoted"' },
        }),
      });

      expect(command.getFileContent()).toBe(
        [
          "---",
          "description: Review: don't merge",
          "allowed-tools: *, read_file",
          'usage: ""quoted""',
          "---",
          "Body",
          "",
        ].join("\n"),
      );
    });

    it("should warn about a project command named after a protected built-in", () => {
      const logger = createMockLogger();
      CodewhaleCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: buildCommand(["*"], { codewhale: { name: "/Trust", aliases: "x, undo" } }),
        logger,
      });

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"/trust"'));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"/undo"'));
    });

    it("should not warn about protected names in the global scope", () => {
      const logger = createMockLogger();
      CodewhaleCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: buildCommand(["*"], { codewhale: { name: "trust" } }),
        global: true,
        logger,
      });

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should warn about an invalid name and check the file stem instead", () => {
      const logger = createMockLogger();
      CodewhaleCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: buildCommand(["*"], { codewhale: { name: "two words" } }),
        logger,
      });

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('falls back to "/test"'));
    });

    it("should only check the alias key that Codewhale keeps", () => {
      const logger = createMockLogger();
      CodewhaleCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: buildCommand(["*"], { codewhale: { alias: "undo", aliases: "t" } }),
        logger,
      });

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should keep a body that opens with a delimiter out of the metadata", () => {
      const command = CodewhaleCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: buildCommand(["*"], { description: undefined }, "---\nnot: metadata"),
      });

      const content = command.getFileContent();
      expect(content).toBe("---\n---\n---\nnot: metadata\n");
      expect(parseCodewhaleCommandFile(content).body).toBe("---\nnot: metadata\n");
    });

    it("should lowercase section keys so the canonical description and name checks hold", () => {
      const logger = createMockLogger();
      const command = CodewhaleCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: buildCommand(["*"], {
          codewhale: { Description: "evil", Name: "trust", name: "review", Aliases: "plugins" },
        }),
        logger,
      });

      expect(command.getFileContent()).toBe(
        ["---", "description: Test", "name: review", "aliases: plugins", "---", "Body", ""].join(
          "\n",
        ),
      );
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"/plugins"'));
    });

    it("should keep the canonical description and drop nested values with a warning", () => {
      const logger = createMockLogger();
      const command = CodewhaleCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: buildCommand(["*"], {
          codewhale: {
            description: "Ignored",
            name: "renamed",
            nested: { a: 1 },
            "bad\nkey": "x",
          },
        }),
        logger,
      });

      expect(command.getFrontmatter()).toEqual({ description: "Test", name: "renamed" });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("nested, bad"));
    });
  });

  describe("fromFile and toRulesyncCommand", () => {
    it("should round-trip extra frontmatter through the codewhale section", async () => {
      await writeFileContent(
        join(testDir, commandsDir, "review.md"),
        "---\ndescription: Review a change\nargument-hint: <pr>\npausable: true\n---\nReview $1\n",
      );

      const command = await CodewhaleCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: "review.md",
      });
      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["*"],
        description: "Review a change",
        codewhale: { "argument-hint": "<pr>", pausable: "true" },
      });
      expect(rulesyncCommand.getBody()).toBe("Review $1");
      expect(rulesyncCommand.getRelativeFilePath()).toBe("review.md");
    });
  });

  describe("parseCodewhaleCommandFile", () => {
    it("should read files that are valid for Codewhale but not valid YAML", () => {
      expect(
        parseCodewhaleCommandFile(
          "---\ndescription: Fix: the bug\nallowed-tools: \"exec_shell\", 'read_file'\nName: 'x'\n---\n\nRun it\n",
        ),
      ).toEqual({
        frontmatter: {
          description: "Fix: the bug",
          "allowed-tools": "\"exec_shell\", 'read_file'",
          name: "x",
        },
        body: "Run it\n",
      });
    });

    it("should start the body at the first non-metadata line of an unclosed block", () => {
      expect(parseCodewhaleCommandFile("---\ndescription: Broken\nRun the body\n")).toEqual({
        frontmatter: { description: "Broken" },
        body: "Run the body\n",
      });
    });

    it("should handle CRLF, unmatched quotes, and a lone delimiter", () => {
      expect(parseCodewhaleCommandFile("---\r\nusage: 'x\"\r\n---\r\nBody\r\n")).toEqual({
        frontmatter: { usage: "'x\"" },
        body: "Body\r\n",
      });
      expect(parseCodewhaleCommandFile("---\n")).toEqual({ frontmatter: {}, body: "" });
      expect(parseCodewhaleCommandFile("---\u0085\nname: x\n---\nBody\n")).toEqual({
        frontmatter: { name: "x" },
        body: "Body\n",
      });
    });

    it("should treat a file without frontmatter as all body", () => {
      expect(parseCodewhaleCommandFile("Just a prompt\n")).toEqual({
        frontmatter: {},
        body: "Just a prompt\n",
      });
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should honor the codewhale target and the wildcard", () => {
      expect(CodewhaleCommand.isTargetedByRulesyncCommand(buildCommand(["*"]))).toBe(true);
      expect(CodewhaleCommand.isTargetedByRulesyncCommand(buildCommand(["codewhale"]))).toBe(true);
      expect(CodewhaleCommand.isTargetedByRulesyncCommand(buildCommand(["claudecode"]))).toBe(
        false,
      );
    });
  });

  describe("forDeletion", () => {
    it("should build a non-validated instance", () => {
      const command = CodewhaleCommand.forDeletion({
        outputRoot: testDir,
        relativeDirPath: commandsDir,
        relativeFilePath: "old.md",
      });
      expect(command.getRelativeFilePath()).toBe("old.md");
    });
  });
});

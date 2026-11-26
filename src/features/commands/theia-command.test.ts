import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncCommand } from "./rulesync-command.js";
import { TheiaCommand } from "./theia-command.js";

describe("TheiaCommand", () => {
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

  const makeRulesyncCommand = (
    frontmatter: Record<string, unknown>,
    relativeFilePath = "review.md",
  ) =>
    new RulesyncCommand({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      relativeFilePath,
      frontmatter: { targets: ["*"], ...frontmatter },
      body: "Review $ARGUMENTS carefully.",
    });

  it("should write project commands to .prompts and refuse global mode", () => {
    expect(TheiaCommand.getSettablePaths()).toEqual({ relativeDirPath: ".prompts" });
    expect(() => TheiaCommand.getSettablePaths({ global: true })).toThrow(
      "TheiaCommand does not support global mode.",
    );
  });

  it("should emit an isCommand prompt template named after the file", () => {
    const command = TheiaCommand.fromRulesyncCommand({
      outputRoot: testDir,
      rulesyncCommand: makeRulesyncCommand({ description: "Review code" }),
    });

    expect(command.getRelativeFilePath()).toBe("review.prompttemplate");
    const { frontmatter, body } = parseFrontmatter(command.getFileContent());
    expect(frontmatter).toEqual({
      isCommand: true,
      commandName: "review",
      commandDescription: "Review code",
    });
    expect(body.trim()).toBe("Review $ARGUMENTS carefully.");
  });

  it("should let the theia section add and override keys", () => {
    const command = TheiaCommand.fromRulesyncCommand({
      outputRoot: testDir,
      rulesyncCommand: makeRulesyncCommand({
        description: "Review code",
        theia: {
          commandName: "rev",
          commandArgumentHint: "<file>",
          commandAgents: ["Coder"],
        },
      }),
    });

    expect(parseFrontmatter(command.getFileContent()).frontmatter).toEqual({
      isCommand: true,
      commandName: "rev",
      commandDescription: "Review code",
      commandArgumentHint: "<file>",
      commandAgents: ["Coder"],
    });
  });

  it("should round-trip a command template back to a rulesync command", async () => {
    await writeFileContent(
      join(testDir, ".prompts", "review.prompttemplate"),
      [
        "---",
        "isCommand: true",
        "commandName: review",
        "commandDescription: Review code",
        "commandArgumentHint: <file>",
        "---",
        "Review $ARGUMENTS carefully.",
      ].join("\n"),
    );

    const command = await TheiaCommand.fromFile({
      outputRoot: testDir,
      relativeFilePath: "review.prompttemplate",
    });
    expect(TheiaCommand.isImportable(command)).toBe(true);

    const rulesyncCommand = command.toRulesyncCommand();
    expect(rulesyncCommand.getRelativeFilePath()).toBe("review.md");
    expect(rulesyncCommand.getFrontmatter()).toEqual({
      targets: ["*"],
      description: "Review code",
      theia: { commandArgumentHint: "<file>" },
    });
    expect(rulesyncCommand.getBody()).toBe("Review $ARGUMENTS carefully.");
  });

  it("should keep a commandName that differs from the file name", async () => {
    await writeFileContent(
      join(testDir, ".prompts", "review.prompttemplate"),
      "---\nisCommand: true\ncommandName: rev\n---\nBody",
    );

    const command = await TheiaCommand.fromFile({
      outputRoot: testDir,
      relativeFilePath: "review.prompttemplate",
    });

    expect(command.toRulesyncCommand().getFrontmatter()).toEqual({
      targets: ["*"],
      theia: { commandName: "rev" },
    });
  });

  it("should treat templates without isCommand as non-importable", async () => {
    await writeFileContent(join(testDir, ".prompts", "fragment.prompttemplate"), "Plain fragment");
    await writeFileContent(
      join(testDir, ".prompts", "off.prompttemplate"),
      "---\nisCommand: false\n---\nBody",
    );

    for (const relativeFilePath of ["fragment.prompttemplate", "off.prompttemplate"]) {
      const command = await TheiaCommand.fromFile({ outputRoot: testDir, relativeFilePath });
      expect(TheiaCommand.isImportable(command)).toBe(false);
    }
  });

  it("should load a template with unparseable frontmatter as a non-command", async () => {
    await writeFileContent(
      join(testDir, ".prompts", "broken.prompttemplate"),
      "---\nisCommand: [unclosed\n---\nBody",
    );

    const command = await TheiaCommand.fromFile({
      outputRoot: testDir,
      relativeFilePath: "broken.prompttemplate",
    });

    expect(TheiaCommand.isImportable(command)).toBe(false);
  });

  it("should be targeted by theia and wildcard targets only", () => {
    expect(TheiaCommand.isTargetedByRulesyncCommand(makeRulesyncCommand({}))).toBe(true);
    expect(
      TheiaCommand.isTargetedByRulesyncCommand(makeRulesyncCommand({ targets: ["theia"] })),
    ).toBe(true);
    expect(
      TheiaCommand.isTargetedByRulesyncCommand(makeRulesyncCommand({ targets: ["cursor"] })),
    ).toBe(false);
  });
});

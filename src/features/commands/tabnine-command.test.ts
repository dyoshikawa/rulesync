import { join } from "node:path";

import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncCommand } from "./rulesync-command.js";
import {
  TabnineCommand,
  TabnineCommandFrontmatter,
  TabnineCommandFrontmatterSchema,
} from "./tabnine-command.js";

describe("TabnineCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validTomlContent = `description = "Test command description"
prompt = """
This is a test prompt for the command.
It can be multiline.
"""`;

  const validTomlWithoutDescription = `prompt = """
This is a test prompt without description.
"""`;

  const invalidTomlContent = `description = "Test description"
# Missing required prompt field`;

  const malformedTomlContent = `description = "Test description"
prompt = "Unclosed string`;

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
    it("should create instance with valid TOML content", () => {
      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "test-command.toml",
        fileContent: validTomlContent,
        validate: true,
      });

      expect(command).toBeInstanceOf(TabnineCommand);
      expect(command.getBody()).toBe(
        "This is a test prompt for the command.\nIt can be multiline.\n",
      );
      expect(command.getFrontmatter()).toEqual({
        description: "Test command description",
        prompt: "This is a test prompt for the command.\nIt can be multiline.\n",
      });
    });

    it("should create instance with TOML content without description", () => {
      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "test-command.toml",
        fileContent: validTomlWithoutDescription,
        validate: true,
      });

      expect(command.getBody()).toBe("This is a test prompt without description.\n");
      expect(command.getFrontmatter()).toEqual({
        description: undefined,
        prompt: "This is a test prompt without description.\n",
      });
    });

    it("should throw error for invalid TOML content", () => {
      expect(
        () =>
          new TabnineCommand({
            outputRoot: testDir,
            relativeDirPath: ".tabnine/agent/commands",
            relativeFilePath: "invalid-command.toml",
            fileContent: invalidTomlContent,
            validate: true,
          }),
      ).toThrow("Failed to parse TOML command file");
    });

    it("should throw error for malformed TOML content", () => {
      expect(
        () =>
          new TabnineCommand({
            outputRoot: testDir,
            relativeDirPath: ".tabnine/agent/commands",
            relativeFilePath: "malformed-command.toml",
            fileContent: malformedTomlContent,
            validate: true,
          }),
      ).toThrow("Failed to parse TOML command file");
    });
  });

  describe("parseTomlContent", () => {
    it("should parse valid TOML with all fields", () => {
      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "test-command.toml",
        fileContent: validTomlContent,
        validate: true,
      });

      const frontmatter = command.getFrontmatter() as TabnineCommandFrontmatter;
      expect(frontmatter.description).toBe("Test command description");
      expect(frontmatter.prompt).toBe(
        "This is a test prompt for the command.\nIt can be multiline.\n",
      );
    });

    it("should parse TOML with optional description missing", () => {
      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "test-command.toml",
        fileContent: validTomlWithoutDescription,
        validate: true,
      });

      const frontmatter = command.getFrontmatter() as TabnineCommandFrontmatter;
      expect(frontmatter.description).toBeUndefined();
      expect(frontmatter.prompt).toBe("This is a test prompt without description.\n");
    });

    it("should throw error for TOML without required prompt field", () => {
      expect(
        () =>
          new TabnineCommand({
            outputRoot: testDir,
            relativeDirPath: ".tabnine/agent/commands",
            relativeFilePath: "invalid-command.toml",
            fileContent: `description = "Test description"`,
            validate: true,
          }),
      ).toThrow("Failed to parse TOML command file");
    });
  });

  describe("getBody", () => {
    it("should return the prompt content as body", () => {
      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "test-command.toml",
        fileContent: validTomlContent,
        validate: true,
      });

      expect(command.getBody()).toBe(
        "This is a test prompt for the command.\nIt can be multiline.\n",
      );
    });
  });

  describe("getFrontmatter", () => {
    it("should return frontmatter with description and prompt", () => {
      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "test-command.toml",
        fileContent: validTomlContent,
        validate: true,
      });

      const frontmatter = command.getFrontmatter();
      expect(frontmatter).toEqual({
        description: "Test command description",
        prompt: "This is a test prompt for the command.\nIt can be multiline.\n",
      });
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand with correct frontmatter", () => {
      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "test-command.toml",
        fileContent: validTomlContent,
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["tabnine"],
        description: "Test command description",
      });
      expect(rulesyncCommand.getBody()).toBe(
        "This is a test prompt for the command.\nIt can be multiline.\n",
      );
      expect(rulesyncCommand.getRelativeDirPath()).toBe(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      expect(rulesyncCommand.getRelativeFilePath()).toBe("test-command.md");
    });

    it("should translate {{args}} back to $ARGUMENTS", () => {
      const tomlContent = `description = "Args"
prompt = """
Focus on {{args}}.
"""`;
      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "args.toml",
        fileContent: tomlContent,
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand.getBody()).toBe("Focus on $ARGUMENTS.\n");
    });

    it("should translate !{cmd} back to !`cmd`", () => {
      const tomlContent = `description = "Shell"
prompt = """
Run !{git status} and report.
"""`;
      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "shell.toml",
        fileContent: tomlContent,
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand.getBody()).toBe("Run !`git status` and report.\n");
    });

    it("should round-trip rulesync -> tabnine -> rulesync preserving syntax", () => {
      const originalBody = "Diff: !`git diff`\nFocus on $ARGUMENTS.";
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "round-trip.md",
        frontmatter: { targets: ["tabnine"], description: "Round trip" },
        body: originalBody,
        fileContent: "",
        validate: true,
      });

      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      const restored = tabnineCommand.toRulesyncCommand();

      expect(restored.getBody().trimEnd()).toBe(originalBody);
    });

    it("should round-trip nested !`echo $ARGUMENTS` shell expansion", () => {
      // Regression test for the previously-greedy reverse regex that ate the
      // wrapping `!{...}` when the body contained a nested `{{args}}`.
      const originalBody = "Run !`echo $ARGUMENTS` now.";
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "nested-round-trip.md",
        frontmatter: { targets: ["tabnine"], description: "Nested" },
        body: originalBody,
        fileContent: "",
        validate: true,
      });

      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      // Forward direction
      expect(tabnineCommand.getBody().trimEnd()).toBe("Run !{echo {{args}}} now.");

      // Reverse direction
      const restored = tabnineCommand.toRulesyncCommand();
      expect(restored.getBody().trimEnd()).toBe(originalBody);
    });

    it("should convert to RulesyncCommand with empty description", () => {
      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "test-command.toml",
        fileContent: validTomlWithoutDescription,
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["tabnine"],
        description: undefined,
      });
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create TabnineCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-command.md",
        frontmatter: {
          targets: ["tabnine"],
          description: "Test description from rulesync",
        },
        body: "Test prompt content",
        fileContent: "", // Will be generated
        validate: true,
      });

      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(tabnineCommand).toBeInstanceOf(TabnineCommand);
      expect(tabnineCommand.getBody()).toBe("Test prompt content\n");
      expect(tabnineCommand.getFrontmatter()).toEqual({
        description: "Test description from rulesync",
        prompt: "Test prompt content\n",
      });
      expect(tabnineCommand.getRelativeFilePath()).toBe("test-command.toml");
      expect(tabnineCommand.getRelativeDirPath()).toBe(".tabnine/agent/commands");
    });

    it("should handle RulesyncCommand with .md extension replacement", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "complex-command.md",
        frontmatter: {
          targets: ["tabnine"],
          description: "Complex command",
        },
        body: "Complex prompt",
        fileContent: "",
        validate: true,
      });

      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(tabnineCommand.getRelativeFilePath()).toBe("complex-command.toml");
    });

    it("should translate $ARGUMENTS to {{args}}", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "args.md",
        frontmatter: { targets: ["tabnine"], description: "Args" },
        body: "Focus on $ARGUMENTS.",
        fileContent: "",
        validate: true,
      });

      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(tabnineCommand.getBody()).toBe("Focus on {{args}}.\n");
      expect(tabnineCommand.getFileContent()).toContain("Focus on {{args}}.");
    });

    it("should translate multiple occurrences of $ARGUMENTS", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "args-multi.md",
        frontmatter: { targets: ["tabnine"], description: "Args multi" },
        body: "First: $ARGUMENTS. Second: $ARGUMENTS.",
        fileContent: "",
        validate: true,
      });

      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(tabnineCommand.getBody()).toBe("First: {{args}}. Second: {{args}}.\n");
    });

    it("should translate !`cmd` shell expansion to !{cmd}", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "shell.md",
        frontmatter: { targets: ["tabnine"], description: "Shell" },
        body: "Run !`git status` and report.",
        fileContent: "",
        validate: true,
      });

      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(tabnineCommand.getBody()).toBe("Run !{git status} and report.\n");
    });

    it("should translate combined shell expansion and arguments", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "combined.md",
        frontmatter: { targets: ["tabnine"], description: "Combined" },
        body: "Diff: !`git diff`\nFocus on $ARGUMENTS.",
        fileContent: "",
        validate: true,
      });

      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(tabnineCommand.getBody()).toBe("Diff: !{git diff}\nFocus on {{args}}.\n");
    });

    it("should not re-translate already-Tabnine-native syntax (idempotency)", () => {
      // A rulesync body that already contains Tabnine-native forms should be
      // emitted verbatim — see docs/reference/command-syntax.md.
      const nativeBody = "Already native: {{args}} and !{git diff}";
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "idempotent.md",
        frontmatter: { targets: ["tabnine"], description: "Idempotent" },
        body: nativeBody,
        fileContent: "",
        validate: true,
      });

      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(tabnineCommand.getBody()).toBe(`${nativeBody}\n`);
    });

    it("should not translate $ARGUMENTS_FOO (underscore is a word char)", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "word-boundary-underscore.md",
        frontmatter: { targets: ["tabnine"], description: "Word boundary" },
        body: "Use $ARGUMENTS_FOO here.",
        fileContent: "",
        validate: true,
      });

      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(tabnineCommand.getBody()).toBe("Use $ARGUMENTS_FOO here.\n");
    });

    it("should not translate $ARGUMENTSx (letter is a word char)", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "word-boundary-letter.md",
        frontmatter: { targets: ["tabnine"], description: "Word boundary" },
        body: "Token $ARGUMENTSx remains.",
        fileContent: "",
        validate: true,
      });

      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(tabnineCommand.getBody()).toBe("Token $ARGUMENTSx remains.\n");
    });

    it("should translate $ARGUMENTS-foo (hyphen is not a word char)", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "word-boundary-hyphen.md",
        frontmatter: { targets: ["tabnine"], description: "Word boundary" },
        body: "Token $ARGUMENTS-foo here.",
        fileContent: "",
        validate: true,
      });

      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(tabnineCommand.getBody()).toBe("Token {{args}}-foo here.\n");
    });

    it("should translate nested shell expansion containing $ARGUMENTS", () => {
      // Pin current behavior: !`echo $ARGUMENTS` becomes !{echo {{args}}}
      // because the shell-expansion replacement runs first.
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "nested.md",
        frontmatter: { targets: ["tabnine"], description: "Nested" },
        body: "Run !`echo $ARGUMENTS` now.",
        fileContent: "",
        validate: true,
      });

      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(tabnineCommand.getBody()).toBe("Run !{echo {{args}}} now.\n");
    });

    it("should write extra keys of the tabnine block back as TOML keys", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "extras.md",
        frontmatter: {
          targets: ["tabnine"],
          description: "Extras",
          // JSON.parse yields an own `__proto__` key (a literal would set the prototype).
          tabnine: JSON.parse(
            '{"model":"gpt-5","tags":["review","ci"],"__proto__":{"polluted":true}}',
          ),
        },
        body: "Body",
        fileContent: "",
        validate: true,
      });

      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      const frontmatter = tabnineCommand.getFrontmatter();
      expect(frontmatter.description).toBe("Extras");
      expect(frontmatter.prompt).toBe("Body\n");
      expect(tabnineCommand.getFileContent()).toContain('model = "gpt-5"');
      expect(tabnineCommand.getFileContent()).toContain('tags = [ "review", "ci" ]');
      expect(tabnineCommand.getFileContent()).not.toContain("__proto__");
      expect(tabnineCommand.getFileContent()).not.toContain("polluted");

      // The extra keys land in the `tabnine` block again on import.
      const roundTripped = tabnineCommand.toRulesyncCommand().getFrontmatter();
      expect(roundTripped.tabnine).toEqual({ model: "gpt-5", tags: ["review", "ci"] });
    });

    it("should respect explicit tabnine.prompt override without translation", () => {
      // When the user provides tabnine.prompt in rulesync frontmatter, it is
      // assumed to be hand-authored Tabnine syntax and emitted verbatim.
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "override.md",
        frontmatter: {
          targets: ["tabnine"],
          description: "Override",
          tabnine: {
            prompt: "Hand-written {{args}} body",
          },
        },
        body: "Body containing $ARGUMENTS that should be ignored.",
        fileContent: "",
        validate: true,
      });

      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(tabnineCommand.getBody()).toBe("Hand-written {{args}} body\n");
    });
  });

  describe("toRulesyncCommand whitespace and inverse round-trip", () => {
    it("should canonicalize {{ args }} (with whitespace) to $ARGUMENTS", () => {
      const tomlContent = `description = "Whitespace"
prompt = """
Focus on {{ args }}.
"""`;
      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "whitespace.toml",
        fileContent: tomlContent,
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand.getBody()).toBe("Focus on $ARGUMENTS.\n");
    });

    it("should round-trip tabnine -> rulesync -> tabnine preserving syntax", () => {
      // The TOML serializer normalizes trailing whitespace on round-trip, so
      // we compare with `.trimEnd()` to focus on meaningful body content.
      const tomlContent = `description = "Inverse"
prompt = """
Diff: !{git diff}
Focus on {{args}}.
"""`;
      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "inverse-round-trip.toml",
        fileContent: tomlContent,
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();
      const restored = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(restored.getBody().trimEnd()).toBe("Diff: !{git diff}\nFocus on {{args}}.");
    });

    it("should canonicalize multiple {{args}} occurrences on import", () => {
      const tomlContent = `description = "Args multi"
prompt = """
First: {{args}}. Second: {{args}}.
"""`;
      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "args-multi.toml",
        fileContent: tomlContent,
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand.getBody().trimEnd()).toBe("First: $ARGUMENTS. Second: $ARGUMENTS.");
    });

    it("should canonicalize multi-line bodies with both placeholders on import", () => {
      const tomlContent = `description = "Combined"
prompt = """
Diff: !{git diff}
Focus on {{args}}.
"""`;
      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "combined-import.toml",
        fileContent: tomlContent,
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand.getBody().trimEnd()).toBe("Diff: !`git diff`\nFocus on $ARGUMENTS.");
    });

    it("should canonicalize {{args}} adjacent to alphanumeric characters", () => {
      const tomlContent = `description = "Adjacent"
prompt = """
Token {{args}}-foo and prefix{{args}} here.
"""`;
      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "adjacent.toml",
        fileContent: tomlContent,
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand.getBody().trimEnd()).toBe(
        "Token $ARGUMENTS-foo and prefix$ARGUMENTS here.",
      );
    });
  });

  describe("TOML escaping in fromRulesyncCommand", () => {
    it("should escape double quotes in description without breaking TOML", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "quotes-desc.md",
        frontmatter: {
          targets: ["tabnine"],
          description: 'Title with "quoted" word',
        },
        body: "body",
        fileContent: "",
        validate: true,
      });

      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(tabnineCommand.getFrontmatter()).toMatchObject({
        description: 'Title with "quoted" word',
      });
      // The TOML must be re-parseable (i.e. quotes were escaped, not raw).
      expect(tabnineCommand.validate().success).toBe(true);
    });

    it("should escape backslashes in description without breaking TOML", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "backslash-desc.md",
        frontmatter: {
          targets: ["tabnine"],
          description: "Path C:\\foo\\bar",
        },
        body: "body",
        fileContent: "",
        validate: true,
      });

      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(tabnineCommand.getFrontmatter()).toMatchObject({
        description: "Path C:\\foo\\bar",
      });
      expect(tabnineCommand.validate().success).toBe(true);
    });

    it("should preserve newlines in description across TOML round-trip", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "newline-desc.md",
        frontmatter: {
          targets: ["tabnine"],
          description: "Line 1\nLine 2",
        },
        body: "body",
        fileContent: "",
        validate: true,
      });

      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(tabnineCommand.getFrontmatter()).toMatchObject({
        description: "Line 1\nLine 2",
      });
    });

    it("should preserve embedded triple-quote sequence in prompt body", () => {
      // Bodies that contain `"""` would have broken the previous
      // multi-line literal serializer. The smol-toml stringify path encodes
      // them as `\"\"\"` so they round-trip cleanly.
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "triple-quote.md",
        frontmatter: { targets: ["tabnine"], description: "Triple" },
        body: 'Body with """ inside it.',
        fileContent: "",
        validate: true,
      });

      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(tabnineCommand.getBody().trimEnd()).toBe('Body with """ inside it.');
      expect(tabnineCommand.validate().success).toBe(true);
    });

    it("should preserve a backtick inside !{...} on forward translation", () => {
      // The forward regex requires no backtick inside !`...`, so users who
      // need a literal backtick in a Tabnine-native shell expansion must
      // hand-author it via the tabnine.prompt override. This test pins
      // that the override path still emits the body verbatim.
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "backtick-shell.md",
        frontmatter: {
          targets: ["tabnine"],
          description: "Backtick shell",
          tabnine: { prompt: "Run !{echo `hello`}." },
        },
        body: "ignored",
        fileContent: "",
        validate: true,
      });

      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(tabnineCommand.getBody().trimEnd()).toBe("Run !{echo `hello`}.");

      // The on-disk TOML must parse cleanly (the basic-string serializer
      // escapes the embedded backtick as part of the prompt value) and must
      // not contain an unescaped `"""` triple-quote — a malformed serializer
      // could otherwise break out of a multi-line literal.
      const fileContent = tabnineCommand.getFileContent();
      expect(fileContent).not.toContain('"""');
      expect(() => parseToml(fileContent)).not.toThrow();
      const parsed = parseToml(fileContent) as { prompt: string };
      expect(parsed.prompt).toContain("Run !{echo `hello`}.");
    });
  });

  describe("forward translation edge cases (rulesync → Tabnine CLI)", () => {
    const translateBody = (body: string): string => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "edge.md",
        frontmatter: { targets: ["tabnine"], description: "edge" },
        body,
        fileContent: "",
        validate: true,
      });
      const tabnineCommand = TabnineCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });
      // The serializer appends a trailing \n; strip it for comparison so the
      // assertions focus on the translation output itself.
      return tabnineCommand.getBody().replace(/\n$/, "");
    };

    it("translates $ARGUMENTS to {{args}}", () => {
      expect(translateBody("Focus on $ARGUMENTS.")).toBe("Focus on {{args}}.");
    });

    it("translates !`cmd` to !{cmd}", () => {
      expect(translateBody("Run !`git status`.")).toBe("Run !{git status}.");
    });

    it("preserves $ARGUMENTSx (no leading or trailing word boundary mismatch)", () => {
      expect(translateBody("$ARGUMENTSx remains")).toBe("$ARGUMENTSx remains");
    });

    it("translates $ARGUMENTS-foo (hyphen is not a word char)", () => {
      expect(translateBody("$ARGUMENTS-foo")).toBe("{{args}}-foo");
    });

    it("translates a leading $ARGUMENTS at start of input", () => {
      expect(translateBody("$ARGUMENTS go")).toBe("{{args}} go");
    });

    it("translates a trailing $ARGUMENTS at end of input", () => {
      expect(translateBody("go $ARGUMENTS")).toBe("go {{args}}");
    });

    it("translates prefix$ARGUMENTS (no leading boundary anchor)", () => {
      expect(translateBody("prefix$ARGUMENTS")).toBe("prefix{{args}}");
    });

    it("preserves $ARGUMENTS_FOO (underscore is a word char)", () => {
      expect(translateBody("$ARGUMENTS_FOO")).toBe("$ARGUMENTS_FOO");
    });

    it("rewrites nested !`echo $ARGUMENTS` to !{echo {{args}}}", () => {
      expect(translateBody("Run !`echo $ARGUMENTS`.")).toBe("Run !{echo {{args}}}.");
    });
  });

  describe("reverse translation edge cases (Tabnine CLI → rulesync)", () => {
    const translateBody = (body: string): string => {
      const tomlContent = `description = "edge"\nprompt = ${JSON.stringify(body)}\n`;
      const tabnineCommand = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: join(".tabnine", "agent", "commands"),
        relativeFilePath: "edge.toml",
        fileContent: tomlContent,
        validate: true,
      });
      return tabnineCommand.toRulesyncCommand().getBody();
    };

    it("translates {{args}} to $ARGUMENTS", () => {
      expect(translateBody("Focus on {{args}}.")).toBe("Focus on $ARGUMENTS.");
    });

    it("translates {{ args }} (with whitespace) to $ARGUMENTS", () => {
      expect(translateBody("Focus on {{ args }}.")).toBe("Focus on $ARGUMENTS.");
    });

    it("translates !{cmd} to !`cmd`", () => {
      expect(translateBody("Run !{git status}.")).toBe("Run !`git status`.");
    });

    it("translates multiple !{...} occurrences", () => {
      expect(translateBody("A !{cmd1} B !{cmd2} C")).toBe("A !`cmd1` B !`cmd2` C");
    });

    it("translates nested !{echo {{args}}} to !`echo $ARGUMENTS` in one pass", () => {
      expect(translateBody("Run !{echo {{args}}} now.")).toBe("Run !`echo $ARGUMENTS` now.");
    });

    it("handles multi-line bodies", () => {
      expect(translateBody("Line1 !{a}\nLine2 with {{args}}\nLine3 !{b}")).toBe(
        "Line1 !`a`\nLine2 with $ARGUMENTS\nLine3 !`b`",
      );
    });

    it("does not match across newlines for !{...}", () => {
      // The non-greedy [^}\n]+? still excludes newlines, matching the
      // forward direction's `!\`[^\`\n]+\`` anchor.
      expect(translateBody("!{abc\ndef}")).toBe("!{abc\ndef}");
    });
  });

  describe("fromFile", () => {
    it("should load TabnineCommand from file", async () => {
      const commandsDir = join(testDir, ".tabnine", "agent", "commands");
      const filePath = join(commandsDir, "test-file-command.toml");

      await writeFileContent(filePath, validTomlContent);

      const command = await TabnineCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: "test-file-command.toml",
        validate: true,
      });

      expect(command).toBeInstanceOf(TabnineCommand);
      expect(command.getBody()).toBe(
        "This is a test prompt for the command.\nIt can be multiline.\n",
      );
      expect(command.getFrontmatter()).toEqual({
        description: "Test command description",
        prompt: "This is a test prompt for the command.\nIt can be multiline.\n",
      });
      expect(command.getRelativeFilePath()).toBe("test-file-command.toml");
    });

    it("should handle file path with subdirectories", async () => {
      const commandsDir = join(testDir, ".tabnine", "agent", "commands", "subdir");
      const filePath = join(commandsDir, "nested-command.toml");

      await writeFileContent(filePath, validTomlContent);

      const command = await TabnineCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: "subdir/nested-command.toml",
        validate: true,
      });

      expect(command.getRelativeFilePath()).toBe("subdir/nested-command.toml");
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        TabnineCommand.fromFile({
          outputRoot: testDir,
          relativeFilePath: "non-existent-command.toml",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should throw error when file contains invalid TOML", async () => {
      const commandsDir = join(testDir, ".tabnine", "agent", "commands");
      const filePath = join(commandsDir, "invalid-command.toml");

      await writeFileContent(filePath, invalidTomlContent);

      await expect(
        TabnineCommand.fromFile({
          outputRoot: testDir,
          relativeFilePath: "invalid-command.toml",
          validate: true,
        }),
      ).rejects.toThrow("Failed to parse TOML command file");
    });
  });

  describe("validate", () => {
    it("should return success for valid TOML content", () => {
      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "valid-command.toml",
        fileContent: validTomlContent,
        validate: false, // Skip validation in constructor to test validate method
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid TOML content", () => {
      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "invalid-command.toml",
        fileContent: `prompt = """
Valid prompt content
"""`,
        validate: false,
      });

      // Manually set invalid content to test validation
      (command as any).fileContent = invalidTomlContent;

      const result = command.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toContain("Failed to parse TOML command file");
    });

    it("should return error for malformed TOML content", () => {
      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "malformed-command.toml",
        fileContent: validTomlContent,
        validate: false,
      });

      // Manually set malformed content to test validation
      (command as any).fileContent = malformedTomlContent;

      const result = command.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });
  });

  describe("TabnineCommandFrontmatterSchema", () => {
    it("should validate valid frontmatter with description", () => {
      const validFrontmatter = {
        description: "Test description",
        prompt: "Test prompt",
      };

      const result = TabnineCommandFrontmatterSchema.parse(validFrontmatter);
      expect(result).toEqual(validFrontmatter);
    });

    it("should validate valid frontmatter without description", () => {
      const frontmatterWithoutDescription = {
        prompt: "Test prompt",
      };

      const result = TabnineCommandFrontmatterSchema.parse(frontmatterWithoutDescription);
      expect(result).toEqual({
        prompt: "Test prompt",
      });
    });

    it("should throw error for frontmatter without prompt", () => {
      const invalidFrontmatter = {
        description: "Test description",
      };

      expect(() => TabnineCommandFrontmatterSchema.parse(invalidFrontmatter)).toThrow();
    });

    it("should throw error for frontmatter with invalid types", () => {
      const invalidFrontmatter = {
        description: 123, // Should be string
        prompt: true, // Should be string
      };

      expect(() => TabnineCommandFrontmatterSchema.parse(invalidFrontmatter)).toThrow();
    });
  });

  describe("edge cases", () => {
    it("should handle empty prompt content", () => {
      const emptyPromptToml = `description = "Empty prompt test"
prompt = ""`;

      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "empty-prompt.toml",
        fileContent: emptyPromptToml,
        validate: true,
      });

      expect(command.getBody()).toBe("");
      expect(command.getFrontmatter()).toEqual({
        description: "Empty prompt test",
        prompt: "",
      });
    });

    it("should handle special characters in prompt", () => {
      const specialCharToml = `description = "Special characters test"
prompt = """
This prompt contains special characters: @#$%^&*()
And unicode: 你好世界 🌍
And escaped quotes: "Hello "World""
"""`;

      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "special-char.toml",
        fileContent: specialCharToml,
        validate: true,
      });

      expect(command.getBody()).toContain("@#$%^&*()");
      expect(command.getBody()).toContain("你好世界 🌍");
      expect(command.getBody()).toContain('Hello "World"');
    });

    it("should handle very long prompt content", () => {
      const longPrompt = "A".repeat(10000);
      const longPromptToml = `description = "Long prompt test"
prompt = """
${longPrompt}
"""`;

      const command = new TabnineCommand({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "long-prompt.toml",
        fileContent: longPromptToml,
        validate: true,
      });

      expect(command.getBody()).toBe(longPrompt + "\n");
      expect(command.getBody().length).toBe(10001);
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should return true for rulesync command with wildcard target", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["*"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = TabnineCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });

    it("should return true for rulesync command with tabnine target", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["tabnine"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = TabnineCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });

    it("should return true for rulesync command with tabnine and other targets", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor", "tabnine", "cline"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = TabnineCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });

    it("should return false for rulesync command with different target", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = TabnineCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(false);
    });

    it("should return true for rulesync command with no targets specified", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: undefined, description: "Test" } as any,
        body: "Body",
        fileContent: "",
      });

      const result = TabnineCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });
  });

  describe("forDeletion", () => {
    it("should create instance for deletion with empty content", () => {
      const command = TabnineCommand.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "to-delete.toml",
      });

      expect(command).toBeInstanceOf(TabnineCommand);
      expect(command.getBody()).toBe("");
      expect(command.getFrontmatter()).toEqual({
        description: "",
        prompt: "",
      });
      expect(command.getRelativeDirPath()).toBe(".tabnine/agent/commands");
      expect(command.getRelativeFilePath()).toBe("to-delete.toml");
    });

    it("should use process.cwd() as default outputRoot", () => {
      const command = TabnineCommand.forDeletion({
        relativeDirPath: ".tabnine/agent/commands",
        relativeFilePath: "to-delete.toml",
      });

      expect(command).toBeInstanceOf(TabnineCommand);
      expect(command.getOutputRoot()).toBe(testDir); // testDir is mocked as process.cwd()
    });
  });
});

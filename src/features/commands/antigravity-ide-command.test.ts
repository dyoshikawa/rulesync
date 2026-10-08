import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { AntigravityCommandFrontmatter } from "./antigravity-command.js";
import { AntigravityIdeCommand } from "./antigravity-ide-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

const buildNamed = (relativeFilePath: string) =>
  new RulesyncCommand({
    relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
    relativeFilePath,
    frontmatter: { targets: ["*"], description: "Test" },
    body: "Body",
    fileContent: "",
  });

const buildCommand = (targets: string[]) =>
  new RulesyncCommand({
    relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
    relativeFilePath: "test.md",
    frontmatter: {
      targets: targets as never,
      description: "Test",
    },
    body: "Body",
    fileContent: "",
  });

describe("AntigravityIdeCommand", () => {
  describe("getSettablePaths", () => {
    it("should return the project workflows path by default", () => {
      const paths = AntigravityIdeCommand.getSettablePaths();

      expect(paths.relativeDirPath).toBe(join(".agents", "workflows"));
    });

    it("should return the global workflows path when global is true", () => {
      const paths = AntigravityIdeCommand.getSettablePaths({ global: true });

      expect(paths.relativeDirPath).toBe(join(".gemini", "antigravity", "global_workflows"));
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const frontmatter: AntigravityCommandFrontmatter = {
        description: "Valid workflow",
      };

      const command = new AntigravityIdeCommand({
        outputRoot: ".",
        relativeDirPath: join(".agents", "workflows"),
        relativeFilePath: "test.md",
        frontmatter,
        body: "test body",
        fileContent: stringifyFrontmatter("test body", frontmatter),
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand targeting antigravity-ide", () => {
      const frontmatter: AntigravityCommandFrontmatter = {
        description: "Test workflow for conversion",
        trigger: "/my-workflow",
        turbo: true,
      };
      const body = "# Workflow: /my-workflow\n\nWorkflow content\n\n// turbo";

      const antigravityCommand = new AntigravityIdeCommand({
        outputRoot: "/test/base",
        relativeDirPath: join(".agents", "workflows"),
        relativeFilePath: "my-workflow.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
      });

      const rulesyncCommand = antigravityCommand.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getBody()).toBe(body);
      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["antigravity-ide"],
        description: frontmatter.description,
        antigravity: {
          trigger: "/my-workflow",
          turbo: true,
        },
      });
      expect(rulesyncCommand.getRelativeDirPath()).toBe(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      expect(rulesyncCommand.getRelativeFilePath()).toBe("my-workflow.md");
    });

    it("should not include antigravity section when no extra fields exist", () => {
      const frontmatter: AntigravityCommandFrontmatter = {
        description: "Simple workflow without extra fields",
      };
      const body = "Simple workflow content";

      const antigravityCommand = new AntigravityIdeCommand({
        outputRoot: "/test/base",
        relativeDirPath: join(".agents", "workflows"),
        relativeFilePath: "simple.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
      });

      const rulesyncCommand = antigravityCommand.toRulesyncCommand();

      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["antigravity-ide"],
        description: frontmatter.description,
      });
      expect(rulesyncCommand.getFrontmatter()).not.toHaveProperty("antigravity");
    });
  });

  describe("fromRulesyncCommand", () => {
    const build = ({
      relativeFilePath,
      frontmatter,
      body,
    }: {
      relativeFilePath: string;
      frontmatter: Record<string, unknown>;
      body: string;
    }) =>
      new RulesyncCommand({
        outputRoot: "/test/base",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath,
        frontmatter: { targets: ["antigravity-ide"], ...frontmatter } as never,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
      });

    it("should emit the command as a skill named after the antigravity section trigger", () => {
      const rulesyncCommand = build({
        relativeFilePath: "original-file.md",
        frontmatter: {
          description: "Test Workflow",
          antigravity: { trigger: "/test-workflow", turbo: true },
        },
        body: "Step 1: Do something",
      });

      const antigravityCommand = AntigravityIdeCommand.fromRulesyncCommand({
        outputRoot: "/test/base",
        rulesyncCommand,
      });

      expect(antigravityCommand.getRelativeDirPath()).toBe(
        join(".agents", "skills", "test-workflow"),
      );
      expect(antigravityCommand.getRelativeFilePath()).toBe("SKILL.md");
      expect(antigravityCommand.getBody()).toBe("Step 1: Do something");
      // Workflow-only markers are not carried over to the skill.
      expect(antigravityCommand.getFileContent()).not.toContain("# Workflow:");
      expect(antigravityCommand.getFileContent()).not.toContain("// turbo");
      expect(antigravityCommand.getFrontmatter()).toEqual({
        name: "test-workflow",
        description: "Test Workflow",
      });
      expect(antigravityCommand.getClaimedDirPaths()).toEqual([
        join("/test/base", ".agents", "skills", "test-workflow"),
      ]);
    });

    it("should fall back to the root-level trigger", () => {
      const antigravityCommand = AntigravityIdeCommand.fromRulesyncCommand({
        rulesyncCommand: build({
          relativeFilePath: "root.md",
          frontmatter: { description: "Root", trigger: "/root-trigger" },
          body: "Simple body",
        }),
      });

      expect(antigravityCommand.getRelativeDirPath()).toBe(
        join(".agents", "skills", "root-trigger"),
      );
    });

    it("should match a trigger declared in the body", () => {
      const antigravityCommand = AntigravityIdeCommand.fromRulesyncCommand({
        rulesyncCommand: build({
          relativeFilePath: "body.md",
          frontmatter: { description: "Body" },
          body: "trigger: /body-trigger\n\nDo the work",
        }),
      });

      expect(antigravityCommand.getRelativeDirPath()).toBe(
        join(".agents", "skills", "body-trigger"),
      );
    });

    it("should use the filename as the default name", () => {
      const antigravityCommand = AntigravityIdeCommand.fromRulesyncCommand({
        rulesyncCommand: build({
          relativeFilePath: "standard.md",
          frontmatter: { description: "Standard Command" },
          body: "Just a command",
        }),
      });

      expect(antigravityCommand.getRelativeDirPath()).toBe(join(".agents", "skills", "standard"));
      expect(antigravityCommand.getFrontmatter()).toEqual({
        name: "standard",
        description: "Standard Command",
      });
    });

    it("should fall back to a generated description when the command has none", () => {
      const antigravityCommand = AntigravityIdeCommand.fromRulesyncCommand({
        rulesyncCommand: build({
          relativeFilePath: "plain.md",
          frontmatter: {},
          body: "Body",
        }),
      });

      expect(antigravityCommand.getFrontmatter()).toEqual({
        name: "plain",
        description: "plain command",
      });
    });

    it("should write the global command to the IDE global skills path", () => {
      const antigravityCommand = AntigravityIdeCommand.fromRulesyncCommand({
        rulesyncCommand: build({
          relativeFilePath: "global.md",
          frontmatter: { description: "Global" },
          body: "Body",
        }),
        global: true,
      });

      expect(antigravityCommand.getRelativeDirPath()).toBe(
        join(".gemini", "config", "skills", "global"),
      );
      expect(antigravityCommand.getRelativeFilePath()).toBe("SKILL.md");
    });

    it("should produce a sanitized skill directory name from the trigger", () => {
      const antigravityCommand = AntigravityIdeCommand.fromRulesyncCommand({
        rulesyncCommand: build({
          relativeFilePath: "evil.md",
          frontmatter: { description: "Security Test", antigravity: { trigger: "/../evil" } },
          body: "Malicious payload",
        }),
      });

      expect(antigravityCommand.getRelativeDirPath()).toBe(join(".agents", "skills", "evil"));
    });
  });

  describe("getWriteBlockReason", () => {
    it("should yield to a rulesync skill with the same name", async () => {
      const { testDir, cleanup } = await setupTestDirectory();
      try {
        const inputRoot = join(testDir, ".rulesync");
        await writeFileContent(
          join(inputRoot, "skills", "deploy", "SKILL.md"),
          "---\nname: deploy\ndescription: d\n---\nbody\n",
        );

        const reason = await AntigravityIdeCommand.getWriteBlockReason({
          rulesyncCommand: buildNamed("deploy.md"),
          inputRoots: [inputRoot],
        });
        expect(reason).toContain("rulesync skill with the same name");

        expect(
          await AntigravityIdeCommand.getWriteBlockReason({
            rulesyncCommand: buildNamed("other.md"),
            inputRoots: [inputRoot],
          }),
        ).toBeNull();
      } finally {
        await cleanup();
      }
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should return true for the wildcard target", () => {
      expect(AntigravityIdeCommand.isTargetedByRulesyncCommand(buildCommand(["*"]))).toBe(true);
    });

    it("should return true for the antigravity-ide target", () => {
      expect(
        AntigravityIdeCommand.isTargetedByRulesyncCommand(buildCommand(["antigravity-ide"])),
      ).toBe(true);
    });

    it("should return false for claudecode", () => {
      expect(AntigravityIdeCommand.isTargetedByRulesyncCommand(buildCommand(["claudecode"]))).toBe(
        false,
      );
    });

    it("should return false for the antigravity (IDE-only simulated) target", () => {
      expect(AntigravityIdeCommand.isTargetedByRulesyncCommand(buildCommand(["antigravity"]))).toBe(
        false,
      );
    });

    it("should return false for the antigravity-cli target", () => {
      expect(
        AntigravityIdeCommand.isTargetedByRulesyncCommand(buildCommand(["antigravity-cli"])),
      ).toBe(false);
    });
  });
});

import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { AntigravityCliCommand } from "./antigravity-cli-command.js";
import { AntigravityCommandFrontmatter } from "./antigravity-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

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

describe("AntigravityCliCommand", () => {
  describe("getSettablePaths", () => {
    it("should return the project workflows path by default", () => {
      const paths = AntigravityCliCommand.getSettablePaths();

      expect(paths.relativeDirPath).toBe(join(".agents", "workflows"));
    });

    it("should return the CLI global workflows path when global is true", () => {
      const paths = AntigravityCliCommand.getSettablePaths({ global: true });

      expect(paths.relativeDirPath).toBe(join(".gemini", "antigravity-cli", "global_workflows"));
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const frontmatter: AntigravityCommandFrontmatter = {
        description: "Valid workflow",
      };

      const command = new AntigravityCliCommand({
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
    it("should convert to RulesyncCommand targeting antigravity-cli", () => {
      const frontmatter: AntigravityCommandFrontmatter = {
        description: "Test workflow for conversion",
        trigger: "/my-workflow",
        turbo: true,
      };
      const body = "# Workflow: /my-workflow\n\nWorkflow content\n\n// turbo";

      const antigravityCommand = new AntigravityCliCommand({
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
        targets: ["antigravity-cli"],
        description: frontmatter.description,
        antigravity: {
          trigger: "/my-workflow",
          turbo: true,
        },
      });
      expect(rulesyncCommand.getRelativeDirPath()).toBe(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      expect(rulesyncCommand.getRelativeFilePath()).toBe("my-workflow.md");
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should resolve trigger from the antigravity section", () => {
      const rulesyncFrontmatter = {
        targets: ["antigravity-cli" as const],
        description: "Test Workflow",
        antigravity: {
          trigger: "/test-workflow",
          turbo: true,
        },
      };
      const body = "Step 1: Do something";

      const rulesyncCommand = new RulesyncCommand({
        outputRoot: "/test/base",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "original-file.md",
        frontmatter: rulesyncFrontmatter,
        body,
        fileContent: stringifyFrontmatter(body, rulesyncFrontmatter),
      });

      const antigravityCommand = AntigravityCliCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      // Filename derives from the sanitized trigger.
      expect(antigravityCommand.getRelativeFilePath()).toBe("test-workflow.md");

      const content = antigravityCommand.getBody();
      expect(content).toContain("# Workflow: /test-workflow");
      expect(content).toContain("Step 1: Do something");
      expect(content).toContain("// turbo");

      expect(antigravityCommand.getFrontmatter()).toEqual({
        description: "Test Workflow",
        trigger: "/test-workflow",
        turbo: true,
      });
    });

    it("should write the global workflow to the CLI global workflows path", () => {
      const rulesyncFrontmatter = {
        targets: ["antigravity-cli" as const],
        description: "Global Workflow",
      };
      const body = "Global body";

      const rulesyncCommand = new RulesyncCommand({
        outputRoot: "/test/base",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "global-workflow.md",
        frontmatter: rulesyncFrontmatter,
        body,
        fileContent: stringifyFrontmatter(body, rulesyncFrontmatter),
      });

      const antigravityCommand = AntigravityCliCommand.fromRulesyncCommand({
        rulesyncCommand,
        global: true,
      });

      expect(antigravityCommand.getRelativeDirPath()).toBe(
        join(".gemini", "antigravity-cli", "global_workflows"),
      );
    });

    it("should produce a sanitized markdown filename from the trigger", () => {
      const rulesyncFrontmatter = {
        targets: ["antigravity-cli" as const],
        description: "Security Test",
        antigravity: {
          trigger: "/../evil-workflow",
        },
      };

      const rulesyncCommand = new RulesyncCommand({
        outputRoot: "/test/base",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "evil.md",
        frontmatter: rulesyncFrontmatter,
        body: "Malicious payload",
        fileContent: stringifyFrontmatter("Malicious payload", rulesyncFrontmatter),
      });

      const antigravityCommand = AntigravityCliCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      expect(antigravityCommand.getRelativeFilePath()).not.toContain("..");
      expect(antigravityCommand.getRelativeFilePath()).not.toContain("/");
      expect(antigravityCommand.getRelativeFilePath()).toMatch(/^[a-zA-Z0-9-_]+\.md$/);
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should return true for the wildcard target", () => {
      expect(AntigravityCliCommand.isTargetedByRulesyncCommand(buildCommand(["*"]))).toBe(true);
    });

    it("should return true for the antigravity-cli target", () => {
      expect(
        AntigravityCliCommand.isTargetedByRulesyncCommand(buildCommand(["antigravity-cli"])),
      ).toBe(true);
    });

    it("should return false for claudecode", () => {
      expect(AntigravityCliCommand.isTargetedByRulesyncCommand(buildCommand(["claudecode"]))).toBe(
        false,
      );
    });

    it("should return false for the antigravity-ide target", () => {
      expect(
        AntigravityCliCommand.isTargetedByRulesyncCommand(buildCommand(["antigravity-ide"])),
      ).toBe(false);
    });
  });
});

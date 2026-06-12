import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { AntigravityCommandFrontmatter } from "./antigravity-command.js";
import { AntigravityIdeCommand } from "./antigravity-ide-command.js";
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
    it("should resolve trigger from the antigravity section", () => {
      const rulesyncFrontmatter = {
        targets: ["antigravity-ide" as const],
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

      const antigravityCommand = AntigravityIdeCommand.fromRulesyncCommand({
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

    it("should fall back to the root-level trigger", () => {
      const rulesyncFrontmatter = {
        targets: ["antigravity-ide" as const],
        description: "Root Trigger Workflow",
        trigger: "/root-trigger",
      };
      const body = "Simple body";

      const rulesyncCommand = new RulesyncCommand({
        outputRoot: "/test/base",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "root.md",
        frontmatter: rulesyncFrontmatter,
        body,
        fileContent: stringifyFrontmatter(body, rulesyncFrontmatter),
      });

      const antigravityCommand = AntigravityIdeCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      expect(antigravityCommand.getRelativeFilePath()).toBe("root-trigger.md");
      expect(antigravityCommand.getBody()).toContain("# Workflow: /root-trigger");
    });

    it("should match a trigger declared in the body", () => {
      const rulesyncFrontmatter = {
        targets: ["antigravity-ide" as const],
        description: "Body Trigger Workflow",
      };
      const body = "trigger: /body-trigger\n\nDo the work";

      const rulesyncCommand = new RulesyncCommand({
        outputRoot: "/test/base",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "body.md",
        frontmatter: rulesyncFrontmatter,
        body,
        fileContent: stringifyFrontmatter(body, rulesyncFrontmatter),
      });

      const antigravityCommand = AntigravityIdeCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      expect(antigravityCommand.getRelativeFilePath()).toBe("body-trigger.md");
      expect(antigravityCommand.getBody()).toContain("# Workflow: /body-trigger");
    });

    it("should use the filename as the default trigger and enable turbo by default", () => {
      const rulesyncFrontmatter = {
        targets: ["antigravity-ide" as const],
        description: "Standard Command",
      };
      const body = "Just a command";

      const rulesyncCommand = new RulesyncCommand({
        outputRoot: "/test/base",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "standard.md",
        frontmatter: rulesyncFrontmatter,
        body,
        fileContent: stringifyFrontmatter(body, rulesyncFrontmatter),
      });

      const antigravityCommand = AntigravityIdeCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      expect(antigravityCommand.getRelativeFilePath()).toBe("standard.md");
      expect(antigravityCommand.getBody()).toContain("# Workflow: /standard");
      expect(antigravityCommand.getBody()).toContain("// turbo");

      expect(antigravityCommand.getFrontmatter()).toEqual({
        description: "Standard Command",
        trigger: "/standard",
        turbo: true,
      });
    });

    it("should produce a sanitized markdown filename from the trigger", () => {
      const rulesyncFrontmatter = {
        targets: ["antigravity-ide" as const],
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

      const antigravityCommand = AntigravityIdeCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      expect(antigravityCommand.getRelativeFilePath()).not.toContain("..");
      expect(antigravityCommand.getRelativeFilePath()).not.toContain("/");
      expect(antigravityCommand.getRelativeFilePath()).toMatch(/^[a-zA-Z0-9-_]+\.md$/);
    });

    it("should omit the turbo directive when turbo is explicitly false", () => {
      const rulesyncFrontmatter = {
        targets: ["antigravity-ide" as const],
        description: "No Turbo Workflow",
        antigravity: {
          trigger: "/no-turbo",
          turbo: false,
        },
      };
      const body = "Workflow without auto-execution";

      const rulesyncCommand = new RulesyncCommand({
        outputRoot: "/test/base",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "no-turbo.md",
        frontmatter: rulesyncFrontmatter,
        body,
        fileContent: stringifyFrontmatter(body, rulesyncFrontmatter),
      });

      const antigravityCommand = AntigravityIdeCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      expect(antigravityCommand.getBody()).toContain("# Workflow: /no-turbo");
      expect(antigravityCommand.getBody()).not.toContain("// turbo");
      expect(antigravityCommand.getFrontmatter()).toEqual({
        description: "No Turbo Workflow",
        trigger: "/no-turbo",
        turbo: false,
      });
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

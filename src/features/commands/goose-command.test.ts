import { join } from "node:path";

import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { ToolFile } from "../../types/tool-file.js";
import { writeFileContent } from "../../utils/file.js";
import { GooseCommand } from "./goose-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

const configOf = (files: ToolFile[]): Record<string, unknown> =>
  load(files[0]!.getFileContent()) as Record<string, unknown>;

const buildRulesyncCommand = (overrides?: {
  body?: string;
  description?: string;
  goose?: Record<string, unknown>;
  relativeFilePath?: string;
}): RulesyncCommand =>
  new RulesyncCommand({
    relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
    relativeFilePath: overrides?.relativeFilePath ?? "deploy.md",
    frontmatter: {
      targets: ["goose"],
      description: overrides?.description ?? "Deploy the app",
      ...(overrides?.goose ? { goose: overrides.goose } : {}),
    },
    body: overrides?.body ?? "Run the deploy steps.",
    fileContent: "",
  });

describe("GooseCommand", () => {
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
    it("returns project recipes dir", () => {
      expect(GooseCommand.getSettablePaths().relativeDirPath).toBe(join(".goose", "recipes"));
    });

    it("returns global recipes dir", () => {
      expect(GooseCommand.getSettablePaths({ global: true }).relativeDirPath).toBe(
        join(".config", "goose", "recipes"),
      );
    });
  });

  describe("fromRulesyncCommand", () => {
    it("emits a valid recipe YAML with version/title/description/prompt", () => {
      const command = GooseCommand.fromRulesyncCommand({
        rulesyncCommand: buildRulesyncCommand(),
      });

      expect(command.getRelativeFilePath()).toBe("deploy.yaml");
      const recipe = load(command.getFileContent()) as Record<string, unknown>;
      expect(recipe.version).toBe("1.0.0");
      expect(recipe.title).toBe("deploy");
      expect(recipe.description).toBe("Deploy the app");
      expect(recipe.prompt).toBe("Run the deploy steps.");
    });

    it("falls back to the title for description when none is provided", () => {
      const command = GooseCommand.fromRulesyncCommand({
        rulesyncCommand: new RulesyncCommand({
          relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
          relativeFilePath: "review.md",
          frontmatter: { targets: ["goose"] },
          body: "Review the diff.",
          fileContent: "",
        }),
      });

      const recipe = load(command.getFileContent()) as Record<string, unknown>;
      expect(recipe.title).toBe("review");
      expect(recipe.description).toBe("review");
    });

    it("layers extra recipe fields from the goose section", () => {
      const command = GooseCommand.fromRulesyncCommand({
        rulesyncCommand: buildRulesyncCommand({
          goose: {
            parameters: [
              { key: "env", input_type: "string", requirement: "required", description: "Target" },
            ],
          },
        }),
      });

      const recipe = load(command.getFileContent()) as Record<string, unknown>;
      expect(recipe.parameters).toEqual([
        { key: "env", input_type: "string", requirement: "required", description: "Target" },
      ]);
    });

    it("does not line-fold a long prompt body", () => {
      const longBody = `Run the deploy steps. ${"word ".repeat(60)}done.`;
      const command = GooseCommand.fromRulesyncCommand({
        rulesyncCommand: buildRulesyncCommand({ body: longBody }),
      });
      const recipe = load(command.getFileContent()) as Record<string, unknown>;
      expect(recipe.prompt).toBe(longBody);
    });

    it("writes to the global recipes dir when global is set", () => {
      const command = GooseCommand.fromRulesyncCommand({
        rulesyncCommand: buildRulesyncCommand(),
        global: true,
      });
      expect(command.getRelativeDirPath()).toBe(join(".config", "goose", "recipes"));
    });
  });

  describe("toRulesyncCommand", () => {
    it("round-trips the prompt as the body and keeps extras in the goose section", () => {
      const yamlContent = [
        "version: 1.0.0",
        "title: deploy",
        "description: Deploy the app",
        "prompt: Run the deploy steps.",
        "activities:",
        "  - Build",
      ].join("\n");

      const command = new GooseCommand({
        relativeDirPath: join(".goose", "recipes"),
        relativeFilePath: "deploy.yaml",
        fileContent: yamlContent,
      });

      const rulesync = command.toRulesyncCommand();
      expect(rulesync.getRelativeFilePath()).toBe("deploy.md");
      expect(rulesync.getBody()).toBe("Run the deploy steps.");
      const fm = rulesync.getFrontmatter();
      expect(fm.description).toBe("Deploy the app");
      expect(fm.goose).toMatchObject({ version: "1.0.0", title: "deploy", activities: ["Build"] });
      expect((fm.goose as Record<string, unknown>).prompt).toBeUndefined();
    });

    it("uses instructions as the body without duplicating it into the goose section", () => {
      const yamlContent = [
        "version: 1.0.0",
        "title: deploy",
        "description: Deploy the app",
        "instructions: Run the deploy steps.",
      ].join("\n");

      const command = new GooseCommand({
        relativeDirPath: join(".goose", "recipes"),
        relativeFilePath: "deploy.yaml",
        fileContent: yamlContent,
      });

      const rulesync = command.toRulesyncCommand();
      expect(rulesync.getBody()).toBe("Run the deploy steps.");
      // The body field must not be echoed back into the goose section.
      expect(
        (rulesync.getFrontmatter().goose as Record<string, unknown>)?.instructions,
      ).toBeUndefined();
    });
  });

  describe("fromFile", () => {
    it("loads a recipe file from disk", async () => {
      const yamlContent = "version: 1.0.0\ntitle: deploy\ndescription: Deploy\nprompt: Go\n";
      await writeFileContent(join(testDir, ".goose", "recipes", "deploy.yaml"), yamlContent);

      const command = await GooseCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: "deploy.yaml",
      });

      expect(command).toBeInstanceOf(GooseCommand);
      expect(command.getBody()).toBe("Go");
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("returns true for goose and wildcard targets", () => {
      expect(GooseCommand.isTargetedByRulesyncCommand(buildRulesyncCommand())).toBe(true);
      expect(
        GooseCommand.isTargetedByRulesyncCommand(
          buildRulesyncCommand({ goose: undefined as never }),
        ),
      ).toBe(true);
    });
  });

  describe("validate", () => {
    it("succeeds on a parseable recipe", () => {
      const command = new GooseCommand({
        relativeDirPath: join(".goose", "recipes"),
        relativeFilePath: "deploy.yaml",
        fileContent: "version: 1.0.0\ntitle: t\ndescription: d\nprompt: p\n",
      });
      expect(command.validate().success).toBe(true);
    });
  });

  describe("getExtraSharedWritePaths", () => {
    it("declares the user config only in global mode", () => {
      expect(GooseCommand.getExtraSharedWritePaths({ global: true })).toEqual([
        { relativeDirPath: join(".config", "goose"), relativeFilePath: "config.yaml" },
      ]);
      expect(GooseCommand.getExtraSharedWritePaths({ global: false })).toEqual([]);
    });
  });

  describe("getAuxiliaryFiles", () => {
    const globalCommand = (relativeFilePath: string): GooseCommand =>
      GooseCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: buildRulesyncCommand({ relativeFilePath }),
        global: true,
      });

    const writeConfig = async (content: string): Promise<void> => {
      await writeFileContent(join(testDir, ".config", "goose", "config.yaml"), content);
    };

    it("registers each generated recipe as a slash command", async () => {
      const files = await GooseCommand.getAuxiliaryFiles({
        toolCommands: [globalCommand("deploy.md"), globalCommand("review.md")],
        outputRoot: testDir,
        global: true,
      });

      expect(files).toHaveLength(1);
      expect(files[0]!.getRelativePathFromCwd()).toBe(join(".config", "goose", "config.yaml"));
      expect(configOf(files)).toEqual({
        slash_commands: [
          {
            command: "deploy",
            recipe_path: join(testDir, ".config", "goose", "recipes", "deploy.yaml"),
          },
          {
            command: "review",
            recipe_path: join(testDir, ".config", "goose", "recipes", "review.yaml"),
          },
        ],
      });
    });

    it("does not touch the user config in project scope", async () => {
      expect(
        await GooseCommand.getAuxiliaryFiles({
          toolCommands: [globalCommand("deploy.md")],
          outputRoot: testDir,
          global: false,
        }),
      ).toEqual([]);
    });

    it("keeps unrelated settings and slash commands pointing outside the managed directory", async () => {
      await writeConfig(
        [
          "GOOSE_PROVIDER: openai",
          "slash_commands:",
          "  - command: standup",
          "    recipe_path: ~/my-recipes/standup.yaml",
          "  - command: helper",
          "    recipe_path: ~/.config/goose/recipes/subagents/helper.yaml",
          "",
        ].join("\n"),
      );

      const files = await GooseCommand.getAuxiliaryFiles({
        toolCommands: [globalCommand("deploy.md")],
        outputRoot: testDir,
        global: true,
      });

      expect(configOf(files)).toEqual({
        GOOSE_PROVIDER: "openai",
        slash_commands: [
          { command: "standup", recipe_path: "~/my-recipes/standup.yaml" },
          { command: "helper", recipe_path: "~/.config/goose/recipes/subagents/helper.yaml" },
          {
            command: "deploy",
            recipe_path: join(testDir, ".config", "goose", "recipes", "deploy.yaml"),
          },
        ],
      });
    });

    it("lowercases the command name, which Goose compares verbatim", async () => {
      const files = await GooseCommand.getAuxiliaryFiles({
        toolCommands: [globalCommand("Deploy.md")],
        outputRoot: testDir,
        global: true,
      });

      expect(configOf(files)).toEqual({
        slash_commands: [
          {
            command: "deploy",
            recipe_path: join(testDir, ".config", "goose", "recipes", "Deploy.yaml"),
          },
        ],
      });
    });

    it("replaces a stale registration of a recipe that is no longer generated", async () => {
      await writeConfig(
        [
          "slash_commands:",
          "  - command: removed",
          `    recipe_path: ${join(testDir, ".config", "goose", "recipes", "removed.yaml")}`,
          "  - command: legacy",
          // Written by an earlier rulesync version as a `~`-relative path.
          "    recipe_path: ~/.config/goose/recipes/legacy.yaml",
          "",
        ].join("\n"),
      );

      const files = await GooseCommand.getAuxiliaryFiles({
        toolCommands: [globalCommand("deploy.md")],
        outputRoot: testDir,
        global: true,
      });

      expect(configOf(files)).toEqual({
        slash_commands: [
          {
            command: "deploy",
            recipe_path: join(testDir, ".config", "goose", "recipes", "deploy.yaml"),
          },
        ],
      });
    });

    it("retracts the whole key when the last generated command is gone", async () => {
      await writeConfig(
        [
          "GOOSE_PROVIDER: openai",
          "slash_commands:",
          "  - command: removed",
          "    recipe_path: ~/.config/goose/recipes/removed.yaml",
          "",
        ].join("\n"),
      );

      const files = await GooseCommand.getAuxiliaryFiles({
        toolCommands: [],
        outputRoot: testDir,
        global: true,
      });

      expect(files).toHaveLength(1);
      expect(configOf(files)).toEqual({ GOOSE_PROVIDER: "openai" });
    });

    it("does not create a config file when there is nothing to register or retract", async () => {
      expect(
        await GooseCommand.getAuxiliaryFiles({
          toolCommands: [],
          outputRoot: testDir,
          global: true,
        }),
      ).toEqual([]);
    });

    it("is never a deletion candidate", async () => {
      expect(
        await GooseCommand.getAuxiliaryFiles({
          toolCommands: [globalCommand("deploy.md")],
          outputRoot: testDir,
          global: true,
          forDeletion: true,
        }),
      ).toEqual([]);
    });
  });
});

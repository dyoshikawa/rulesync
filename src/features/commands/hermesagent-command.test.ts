import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { CommandsProcessor } from "./commands-processor.js";
import { HermesagentCommand } from "./hermesagent-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

let testDir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ testDir, cleanup } = await setupTestDirectory());
});

afterEach(async () => {
  await cleanup();
});

function rulesyncCommand(path = ".rulesync/commands/review.md"): RulesyncCommand {
  return new RulesyncCommand({
    relativeDirPath: ".rulesync/commands",
    relativeFilePath: path,
    frontmatter: { description: "Review the current changes" },
    body: "Review the diff carefully.",
    fileContent: "",
  });
}

describe("HermesagentCommand", () => {
  it("generates an isolated JSON command spec", () => {
    const command = HermesagentCommand.fromRulesyncCommand({
      outputRoot: ".",
      rulesyncCommand: rulesyncCommand(),
    });

    expect(command.getRelativePathFromCwd()).toBe(".hermes/rulesync/commands/review.json");
    expect(JSON.parse(command.getFileContent())).toEqual({
      slug: "review",
      description: "Review the current changes",
      prompt: "Review the diff carefully.",
    });
  });

  it("imports a JSON command spec back to a rulesync command", () => {
    const command = new HermesagentCommand({
      relativeDirPath: ".hermes/rulesync/commands",
      relativeFilePath: "review.json",
      fileContent: JSON.stringify({
        slug: "review",
        description: "Review the current changes",
        prompt: "Review the diff carefully.",
      }),
    });

    const result = command.toRulesyncCommand();

    expect(result.getFrontmatter().description).toBe("Review the current changes");
    expect(result.getBody()).toBe("Review the diff carefully.");
  });

  it("generates a native plugin and preserves existing Hermes plugins", async () => {
    const files = await HermesagentCommand.getAuxiliaryFiles({
      toolCommands: [
        HermesagentCommand.fromRulesyncCommand({ rulesyncCommand: rulesyncCommand() }),
      ],
    });
    const init = files.find((file) => file.getRelativeFilePath() === "__init__.py");
    const config = files.find((file) => file.getRelativePathFromCwd() === ".hermes/config.yaml");

    expect(init?.getFileContent()).toContain("ctx.register_command(slug, handler, description)");
    expect(init?.getFileContent()).toContain('ctx.dispatch_tool(\n            "delegate_task"');
    expect(init?.getFileContent()).not.toContain('"toolsets"');
    expect(init?.getFileContent()).toContain(
      'Path(__file__).resolve().parents[2] / "rulesync" / "commands"',
    );
    expect(init?.getFileContent()).not.toContain('Path.home() / ".hermes"');
    config?.setFileContent("plugins:\n  enabled:\n    - existing-plugin\n");
    expect(config?.getFileContent()).toContain("- existing-plugin");
    expect(config?.getFileContent()).toContain("- rulesync-commands");
  });

  it("cleans the commands plugin only when its ownership marker matches", async () => {
    const pluginDir = join(testDir, ".hermes", "plugins", "rulesync-commands");
    const markerPath = join(pluginDir, ".rulesync-owned");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(markerPath, "user-managed\n", "utf8");
    expect(await HermesagentCommand.canDeleteAuxiliaryFiles({ outputRoot: testDir })).toBe(false);

    await writeFile(markerPath, "Generated and owned by RuleSync.\n", "utf8");
    expect(await HermesagentCommand.canDeleteAuxiliaryFiles({ outputRoot: testDir })).toBe(true);
    const files = await HermesagentCommand.getAuxiliaryFiles({
      toolCommands: [],
      outputRoot: testDir,
      forDeletion: true,
    });
    expect(files.map((file) => file.getRelativeFilePath())).toContain(".rulesync-owned");
  });

  it("fails when a Hermes command and skill expose the same slash name", async () => {
    const skillDir = join(testDir, ".rulesync", "skills", "review");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: review\ndescription: Review changes\n---\n",
      "utf8",
    );
    const processor = new CommandsProcessor({
      inputRoot: testDir,
      toolTarget: "hermesagent",
      global: true,
      logger: createMockLogger(),
    });

    await expect(processor.convertRulesyncFilesToToolFiles([rulesyncCommand()])).rejects.toThrow(
      "Hermes command and skill slash-name collision: review",
    );
  });

  it("fails when nested commands normalize to the same Hermes slash name", async () => {
    const processor = new CommandsProcessor({
      toolTarget: "hermesagent",
      global: true,
      logger: createMockLogger(),
    });

    await expect(
      processor.convertRulesyncFilesToToolFiles([
        rulesyncCommand(".rulesync/commands/a/review.md"),
        rulesyncCommand(".rulesync/commands/b/review.md"),
      ]),
    ).rejects.toThrow("Hermes command slash-name collision");
  });

  it("uses Hermes slash normalization for commands and skill frontmatter names", async () => {
    const skillDir = join(testDir, ".rulesync", "skills", "different-directory");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      '---\nname: Review_PR\ndescription: Review changes\ntargets: ["hermesagent"]\n---\n',
      "utf8",
    );
    const processor = new CommandsProcessor({
      inputRoot: testDir,
      toolTarget: "hermesagent",
      global: true,
      logger: createMockLogger(),
    });

    await expect(
      processor.convertRulesyncFilesToToolFiles([
        rulesyncCommand(".rulesync/commands/review-pr.md"),
      ]),
    ).rejects.toThrow("Hermes command and skill slash-name collision: review-pr");
  });

  it("ignores slash-name collisions with skills that do not target Hermes", async () => {
    const skillDir = join(testDir, ".rulesync", "skills", "review");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      '---\nname: review\ndescription: Review changes\ntargets: ["claudecode"]\n---\n',
      "utf8",
    );
    const processor = new CommandsProcessor({
      inputRoot: testDir,
      toolTarget: "hermesagent",
      global: true,
      logger: createMockLogger(),
    });

    await expect(
      processor.convertRulesyncFilesToToolFiles([rulesyncCommand()]),
    ).resolves.toBeDefined();
  });

  it("rejects command names that collide after case normalization", async () => {
    const processor = new CommandsProcessor({
      inputRoot: testDir,
      toolTarget: "hermesagent",
      global: true,
      logger: createMockLogger(),
    });

    await expect(
      processor.convertRulesyncFilesToToolFiles([
        rulesyncCommand(".rulesync/commands/Review.md"),
        rulesyncCommand(".rulesync/commands/review.md"),
      ]),
    ).rejects.toThrow('both normalize to "review"');
  });
});

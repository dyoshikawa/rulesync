import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { CommandsProcessor } from "../features/commands/commands-processor.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import {
  assertGenerateMatrixCoversTargets,
  runGenerate,
  runImport,
  useGlobalTestDirectories,
  useTestDirectory,
} from "./e2e-helper.js";

const commandsGenerateTargets = [
  { target: "claudecode", outputPath: join(".claude", "commands", "review-pr.md") },
  { target: "cursor", outputPath: join(".cursor", "commands", "review-pr.md") },
  { target: "augmentcode", outputPath: join(".augment", "commands", "review-pr.md") },
  { target: "copilot", outputPath: join(".github", "prompts", "review-pr.prompt.md") },
  { target: "opencode", outputPath: join(".opencode", "commands", "review-pr.md") },
  { target: "cline", outputPath: join(".clinerules", "workflows", "review-pr.md") },
  { target: "kilo", outputPath: join(".kilo", "commands", "review-pr.md") },
  { target: "roo", outputPath: join(".roo", "commands", "review-pr.md") },
  { target: "kiro", outputPath: join(".kiro", "prompts", "review-pr.md") },
  { target: "kiro-cli", outputPath: join(".kiro", "prompts", "review-pr.md") },
  { target: "kiro-ide", outputPath: join(".kiro", "prompts", "review-pr.md") },
  { target: "antigravity-ide", outputPath: join(".agents", "workflows", "review-pr.md") },
  { target: "antigravity-cli", outputPath: join(".agents", "workflows", "review-pr.md") },
  { target: "junie", outputPath: join(".junie", "commands", "review-pr.md") },
  { target: "takt", outputPath: join(".takt", "facets", "instructions", "review-pr.md") },
  { target: "pi", outputPath: join(".pi", "prompts", "review-pr.md") },
  // Devin slash commands are Skills; commands are emitted onto the skills surface.
  { target: "devin", outputPath: join(".devin", "skills", "review-pr", "SKILL.md") },
  { target: "factorydroid", outputPath: join(".factory", "commands", "review-pr.md") },
  { target: "goose", outputPath: join(".goose", "recipes", "review-pr.yaml") },
  { target: "qwencode", outputPath: join(".qwen", "commands", "review-pr.md") },
  { target: "reasonix", outputPath: join(".reasonix", "commands", "review-pr.md") },
  { target: "rovodev", outputPath: join(".rovodev", "prompts", "review-pr.md") },
] as const;

const commandsGlobalTargets = [
  { target: "claudecode", outputPath: join(".claude", "commands", "review-pr.md") },
  { target: "cursor", outputPath: join(".cursor", "commands", "review-pr.md") },
  { target: "augmentcode", outputPath: join(".augment", "commands", "review-pr.md") },
  { target: "opencode", outputPath: join(".config", "opencode", "commands", "review-pr.md") },
  { target: "codexcli", outputPath: join(".codex", "prompts", "review-pr.md") },
  { target: "cline", outputPath: join("Documents", "Cline", "Workflows", "review-pr.md") },
  { target: "kilo", outputPath: join(".config", "kilo", "commands", "review-pr.md") },
  { target: "junie", outputPath: join(".junie", "commands", "review-pr.md") },
  { target: "kiro-cli", outputPath: join(".kiro", "prompts", "review-pr.md") },
  {
    target: "antigravity-ide",
    outputPath: join(".gemini", "antigravity", "global_workflows", "review-pr.md"),
  },
  {
    target: "antigravity-cli",
    outputPath: join(".gemini", "antigravity-cli", "global_workflows", "review-pr.md"),
  },
  {
    target: "takt",
    outputPath: join(".takt", "facets", "instructions", "review-pr.md"),
  },
  { target: "pi", outputPath: join(".pi", "agent", "prompts", "review-pr.md") },
  {
    target: "devin",
    outputPath: join(".config", "devin", "skills", "review-pr", "SKILL.md"),
  },
  { target: "factorydroid", outputPath: join(".factory", "commands", "review-pr.md") },
  { target: "goose", outputPath: join(".config", "goose", "recipes", "review-pr.yaml") },
  { target: "qwencode", outputPath: join(".qwen", "commands", "review-pr.md") },
  // Hermes commands are global plugin-backed slash commands, separate from skills.
  {
    target: "hermesagent",
    outputPath: join(".hermes", "rulesync", "commands", "review-pr.json"),
  },
  { target: "reasonix", outputPath: join(".reasonix", "commands", "review-pr.md") },
  { target: "rovodev", outputPath: join(".rovodev", "prompts", "review-pr.md") },
] as const;

describe("E2E: commands", () => {
  const { getTestDir } = useTestDirectory();

  it("generate matrix must cover every native commands tool target", () => {
    assertGenerateMatrixCoversTargets({
      processor: CommandsProcessor,
      testedTargets: commandsGenerateTargets.map((e) => e.target),
    });
  });

  it.each(commandsGenerateTargets)(
    "should generate $target commands",
    async ({ target, outputPath }) => {
      const testDir = getTestDir();

      const commandContent = `---
description: "Review a pull request"
targets: ["*"]
---
Check the PR diff and provide feedback.
`;
      await writeFileContent(
        join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review-pr.md"),
        commandContent,
      );

      await runGenerate({ target, features: "commands" });

      const generatedContent = await readFileContent(join(testDir, outputPath));
      expect(generatedContent).toContain("Check the PR diff and provide feedback.");
    },
  );

  it("should generate a rovodev prompts.yml manifest alongside the content file", async () => {
    const testDir = getTestDir();

    const commandContent = `---
description: "Review a pull request"
targets: ["*"]
---
Check the PR diff and provide feedback.
`;
    await writeFileContent(
      join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review-pr.md"),
      commandContent,
    );

    await runGenerate({ target: "rovodev", features: "commands" });

    // The content file holds the raw prompt body (no frontmatter).
    const contentFile = await readFileContent(join(testDir, ".rovodev", "prompts", "review-pr.md"));
    expect(contentFile.trim()).toBe("Check the PR diff and provide feedback.");

    // The manifest indexes the prompt by name/description/content_file.
    const manifest = await readFileContent(join(testDir, ".rovodev", "prompts.yml"));
    expect(manifest).toContain("name: review-pr");
    expect(manifest).toContain("description: Review a pull request");
    expect(manifest).toContain("content_file: prompts/review-pr.md");
  });

  it.each([{ target: "agentsmd", outputPath: join(".agents", "commands", "review-pr.md") }])(
    "should generate $target simulated commands",
    async ({ target, outputPath }) => {
      const testDir = getTestDir();

      const commandContent = `---
description: "Review a pull request"
targets: ["*"]
---
Check the PR diff and provide feedback.
`;
      await writeFileContent(
        join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review-pr.md"),
        commandContent,
      );

      await runGenerate({ target, features: "commands", simulateCommands: true });

      const generatedContent = await readFileContent(join(testDir, outputPath));
      expect(generatedContent).toContain("Check the PR diff and provide feedback.");
    },
  );

  it.each([
    { target: "claudecode", orphanPath: join(".claude", "commands", "orphan.md") },
    { target: "cursor", orphanPath: join(".cursor", "commands", "orphan.md") },
    { target: "augmentcode", orphanPath: join(".augment", "commands", "orphan.md") },
    { target: "copilot", orphanPath: join(".github", "prompts", "orphan.prompt.md") },
    { target: "opencode", orphanPath: join(".opencode", "commands", "orphan.md") },
    { target: "cline", orphanPath: join(".clinerules", "workflows", "orphan.md") },
    { target: "kilo", orphanPath: join(".kilo", "commands", "orphan.md") },
    { target: "roo", orphanPath: join(".roo", "commands", "orphan.md") },
    { target: "kiro", orphanPath: join(".kiro", "prompts", "orphan.md") },
    { target: "antigravity-ide", orphanPath: join(".agents", "workflows", "orphan.md") },
    { target: "antigravity-cli", orphanPath: join(".agents", "workflows", "orphan.md") },
    { target: "junie", orphanPath: join(".junie", "commands", "orphan.md") },
    { target: "pi", orphanPath: join(".pi", "prompts", "orphan.md") },
    { target: "factorydroid", orphanPath: join(".factory", "commands", "orphan.md") },
    { target: "goose", orphanPath: join(".goose", "recipes", "orphan.yaml") },
    { target: "rovodev", orphanPath: join(".rovodev", "prompts", "orphan.md") },
  ])(
    "should fail in check mode when delete would remove an orphan $target command file",
    async ({ target, orphanPath }) => {
      const testDir = getTestDir();

      await writeFileContent(join(testDir, ".rulesync", ".gitkeep"), "");
      await writeFileContent(join(testDir, orphanPath), "# orphan\n");

      await expect(
        runGenerate({
          target,
          features: "commands",
          deleteFiles: true,
          check: true,
          env: { NODE_ENV: "e2e" },
        }),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(
          "Files are not up to date. Run 'rulesync generate' to update.",
        ),
      });

      expect(await readFileContent(join(testDir, orphanPath))).toBe("# orphan\n");
    },
  );
});

describe("E2E: devin commands on the skills surface", () => {
  const { getTestDir } = useTestDirectory();

  it("should keep command outputs when skills --delete removes orphan skills", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "my-command.md"),
      `---
description: "My command"
targets: ["*"]
---
Do the thing.
`,
    );
    await writeFileContent(
      join(testDir, ".rulesync", "skills", "my-skill", "SKILL.md"),
      `---
name: my-skill
description: "My skill"
targets: ["*"]
---
Skill body.
`,
    );
    // An orphan skill dir no rulesync source produces anymore.
    await writeFileContent(
      join(testDir, ".devin", "skills", "orphan-skill", "SKILL.md"),
      "---\nname: orphan-skill\ndescription: stale\n---\nold\n",
    );

    await runGenerate({
      target: "devin",
      features: "commands,skills",
      deleteFiles: true,
      env: { NODE_ENV: "e2e" },
    });

    // The command-emitted SKILL.md survives the skills feature's orphan
    // deletion (isDirOwned protection), the real skill is written, and the
    // genuine orphan is cleaned up.
    expect(
      await readFileContent(join(testDir, ".devin", "skills", "my-command", "SKILL.md")),
    ).toContain("Do the thing.");
    expect(
      await readFileContent(join(testDir, ".devin", "skills", "my-skill", "SKILL.md")),
    ).toContain("Skill body.");
    await expect(
      readFileContent(join(testDir, ".devin", "skills", "orphan-skill", "SKILL.md")),
    ).rejects.toThrow();
  });
});

describe("E2E: commands (import)", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "claudecode", sourcePath: join(".claude", "commands", "review-pr.md") },
    { target: "cursor", sourcePath: join(".cursor", "commands", "review-pr.md") },
    { target: "augmentcode", sourcePath: join(".augment", "commands", "review-pr.md") },
    { target: "copilot", sourcePath: join(".github", "prompts", "review-pr.prompt.md") },
    { target: "opencode", sourcePath: join(".opencode", "commands", "review-pr.md") },
    { target: "cline", sourcePath: join(".clinerules", "workflows", "review-pr.md") },
    { target: "kilo", sourcePath: join(".kilo", "commands", "review-pr.md") },
    { target: "roo", sourcePath: join(".roo", "commands", "review-pr.md") },
    { target: "kiro", sourcePath: join(".kiro", "prompts", "review-pr.md") },
    { target: "antigravity-ide", sourcePath: join(".agents", "workflows", "review-pr.md") },
    { target: "antigravity-cli", sourcePath: join(".agents", "workflows", "review-pr.md") },
    { target: "junie", sourcePath: join(".junie", "commands", "review-pr.md") },
    { target: "pi", sourcePath: join(".pi", "prompts", "review-pr.md") },
    { target: "factorydroid", sourcePath: join(".factory", "commands", "review-pr.md") },
    { target: "reasonix", sourcePath: join(".reasonix", "commands", "review-pr.md") },
    { target: "rovodev", sourcePath: join(".rovodev", "prompts", "review-pr.md") },
  ])("should import $target commands", async ({ target, sourcePath }) => {
    const testDir = getTestDir();

    const commandContent = `Review the PR diff and provide feedback.`;
    await writeFileContent(join(testDir, sourcePath), commandContent);

    await runImport({ target, features: "commands" });

    const importedContent = await readFileContent(
      join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review-pr.md"),
    );
    expect(importedContent).toContain("Review the PR diff and provide feedback.");
  });

  it("should import goose commands (recipe YAML)", async () => {
    const testDir = getTestDir();

    const recipeContent = [
      "version: 1.0.0",
      "title: review-pr",
      "description: Review a pull request",
      "prompt: Review the PR diff and provide feedback.",
    ].join("\n");
    await writeFileContent(join(testDir, ".goose", "recipes", "review-pr.yaml"), recipeContent);

    await runImport({ target: "goose", features: "commands" });

    const importedContent = await readFileContent(
      join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review-pr.md"),
    );
    expect(importedContent).toContain("Review the PR diff and provide feedback.");
  });
});

describe("E2E: commands (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it("global matrix must cover every native global commands tool target", () => {
    assertGenerateMatrixCoversTargets({
      processor: CommandsProcessor,
      testedTargets: commandsGlobalTargets.map((e) => e.target),
      global: true,
    });
  });

  it("should generate and enable the Hermes native commands plugin", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();
    await writeFileContent(
      join(projectDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review-pr.md"),
      '---\nroot: true\ndescription: "Review a pull request"\ntargets: ["hermesagent"]\n---\nReview it.\n',
    );

    await runGenerate({
      target: "hermesagent",
      features: "commands",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const plugin = await readFileContent(
      join(homeDir, ".hermes", "plugins", "rulesync-commands", "__init__.py"),
    );
    const config = await readFileContent(join(homeDir, ".hermes", "config.yaml"));
    expect(plugin).toContain("ctx.register_command(slug, handler, description)");
    expect(plugin).toContain('"delegate_task"');
    expect(config).toContain("- rulesync-commands");
  });

  it.each(commandsGlobalTargets)(
    "should generate $target commands in home directory",
    async ({ target, outputPath }) => {
      const projectDir = getProjectDir();
      const homeDir = getHomeDir();

      const commandContent = `---
root: true
description: "Review a pull request"
targets: ["*"]
---
Check the PR diff and provide feedback.
`;
      await writeFileContent(
        join(projectDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review-pr.md"),
        commandContent,
      );

      await runGenerate({
        target,
        features: "commands",
        global: true,
        env: { HOME_DIR: homeDir },
      });

      const generatedContent = await readFileContent(join(homeDir, outputPath));
      expect(generatedContent).toContain("Check the PR diff and provide feedback.");
    },
  );

  it("should ignore non-root commands in global mode", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    // Setup: Create a root command and a non-root command
    const rootCommandContent = `---
root: true
description: "Root command"
targets: ["*"]
---
Root command body
`;
    const nonRootCommandContent = `---
description: "Non-root command"
targets: ["*"]
---
Non-root command body
`;
    await writeFileContent(
      join(projectDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review-pr.md"),
      rootCommandContent,
    );
    await writeFileContent(
      join(projectDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "extra.md"),
      nonRootCommandContent,
    );

    // Execute: Generate commands in global mode
    await runGenerate({
      target: "claudecode",
      features: "commands",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    // Verify: root command content is present, non-root command content is absent
    const generatedContent = await readFileContent(
      join(homeDir, ".claude", "commands", "review-pr.md"),
    );
    expect(generatedContent).toContain("Root command body");
    expect(generatedContent).not.toContain("Non-root command body");
  });
});

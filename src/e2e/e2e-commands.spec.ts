import { symlink } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { CommandsProcessor } from "../features/commands/commands-processor.js";
import {
  ensureDir,
  fileExists,
  readFileContent,
  removeFile,
  writeFileContent,
} from "../utils/file.js";
import { getHermesagentGlobalDir } from "../utils/hermesagent.js";
import {
  assertGenerateMatrixCoversTargets,
  runGenerate,
  runImport,
  useGlobalTestDirectories,
  useTestDirectory,
} from "./e2e-helper.js";

const commandsGenerateTargets = [
  { target: "claudecode", outputPath: join(".claude", "commands", "review-pr.md") },
  { target: "claudecode-plugin", outputPath: join("commands", "review-pr.md") },
  { target: "augmentcode-plugin", outputPath: join("commands", "review-pr.md") },
  { target: "zcode-plugin", outputPath: join("commands", "review-pr.md") },
  { target: "kimi-code-plugin", outputPath: join("commands", "review-pr.md") },
  { target: "cursor", outputPath: join(".cursor", "commands", "review-pr.md") },
  { target: "augmentcode", outputPath: join(".augment", "commands", "review-pr.md") },
  { target: "bob", outputPath: join(".bob", "commands", "review-pr.md") },
  { target: "copilot", outputPath: join(".github", "prompts", "review-pr.prompt.md") },
  { target: "mimocode", outputPath: join(".mimocode", "commands", "review-pr.md") },
  { target: "omp", outputPath: join(".omp", "commands", "review-pr.md") },
  { target: "opencode", outputPath: join(".opencode", "commands", "review-pr.md") },
  { target: "cline", outputPath: join(".clinerules", "workflows", "review-pr.md") },
  { target: "codebuddy", outputPath: join(".codebuddy", "commands", "review-pr.md") },
  { target: "codewhale", outputPath: join(".codewhale", "commands", "review-pr.md") },
  { target: "kilo", outputPath: join(".kilo", "commands", "review-pr.md") },
  { target: "tabnine", outputPath: join(".tabnine", "agent", "commands", "review-pr.toml") },
  { target: "continue", outputPath: join(".continue", "prompts", "review-pr.md") },
  { target: "commandcode", outputPath: join(".commandcode", "commands", "review-pr.md") },
  { target: "qoder", outputPath: join(".qoder", "commands", "review-pr.md") },
  { target: "roo", outputPath: join(".roo", "commands", "review-pr.md") },
  { target: "zoocode", outputPath: join(".roo", "commands", "review-pr.md") },
  { target: "kiro", outputPath: join(".kiro", "prompts", "review-pr.md") },
  { target: "kiro-cli", outputPath: join(".kiro", "prompts", "review-pr.md") },
  { target: "kiro-ide", outputPath: join(".kiro", "prompts", "review-pr.md") },
  {
    target: "antigravity-ide",
    outputPath: join(".agents", "skills", "review-pr", "SKILL.md"),
  },
  {
    target: "antigravity-cli",
    outputPath: join(".agents", "skills", "review-pr", "SKILL.md"),
  },
  { target: "junie", outputPath: join(".junie", "commands", "review-pr.md") },
  { target: "takt", outputPath: join(".takt", "facets", "instructions", "review-pr.md") },
  { target: "pi", outputPath: join(".pi", "prompts", "review-pr.md") },
  // Devin slash commands are Skills; commands are emitted onto the skills surface.
  { target: "devin", outputPath: join(".devin", "skills", "review-pr", "SKILL.md") },
  // Warp's custom slash-command surface is skills, too.
  { target: "warp", outputPath: join(".warp", "skills", "review-pr", "SKILL.md") },
  { target: "factorydroid", outputPath: join(".factory", "commands", "review-pr.md") },
  { target: "goose", outputPath: join(".goose", "recipes", "review-pr.yaml") },
  { target: "gitlabduo", outputPath: join(".agents", "commands", "review-pr.md") },
  { target: "grokcli", outputPath: join(".grok", "commands", "review-pr.md") },
  { target: "qwencode", outputPath: join(".qwen", "commands", "review-pr.md") },
  { target: "reasonix", outputPath: join(".reasonix", "commands", "review-pr.md") },
  { target: "rovodev", outputPath: join(".rovodev", "prompts", "review-pr.md") },
  { target: "zcode", outputPath: join(".zcode", "commands", "review-pr.md") },
] as const;

const commandsGlobalTargets = [
  { target: "claudecode", outputPath: join(".claude", "commands", "review-pr.md") },
  { target: "cursor", outputPath: join(".cursor", "commands", "review-pr.md") },
  { target: "augmentcode", outputPath: join(".augment", "commands", "review-pr.md") },
  { target: "bob", outputPath: join(".bob", "commands", "review-pr.md") },
  { target: "tabnine", outputPath: join(".tabnine", "agent", "commands", "review-pr.toml") },
  { target: "continue", outputPath: join(".continue", "prompts", "review-pr.md") },
  { target: "commandcode", outputPath: join(".commandcode", "commands", "review-pr.md") },
  { target: "qoder", outputPath: join(".qoder", "commands", "review-pr.md") },
  { target: "mimocode", outputPath: join(".config", "mimocode", "commands", "review-pr.md") },
  { target: "omp", outputPath: join(".omp", "agent", "commands", "review-pr.md") },
  { target: "opencode", outputPath: join(".config", "opencode", "commands", "review-pr.md") },
  { target: "codexcli", outputPath: join(".codex", "prompts", "review-pr.md") },
  { target: "cline", outputPath: join("Documents", "Cline", "Workflows", "review-pr.md") },
  { target: "codebuddy", outputPath: join(".codebuddy", "commands", "review-pr.md") },
  { target: "codewhale", outputPath: join(".codewhale", "commands", "review-pr.md") },
  { target: "kilo", outputPath: join(".config", "kilo", "commands", "review-pr.md") },
  { target: "junie", outputPath: join(".junie", "commands", "review-pr.md") },
  { target: "kiro-cli", outputPath: join(".kiro", "prompts", "review-pr.md") },
  {
    target: "antigravity-ide",
    outputPath: join(".gemini", "config", "skills", "review-pr", "SKILL.md"),
  },
  {
    target: "antigravity-cli",
    outputPath: join(".gemini", "antigravity-cli", "skills", "review-pr", "SKILL.md"),
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
  { target: "warp", outputPath: join(".warp", "skills", "review-pr", "SKILL.md") },
  { target: "factorydroid", outputPath: join(".factory", "commands", "review-pr.md") },
  { target: "goose", outputPath: join(".config", "goose", "recipes", "review-pr.yaml") },
  { target: "gitlabduo", outputPath: join(".gitlab", "duo", "commands", "review-pr.md") },
  { target: "grokcli", outputPath: join(".grok", "commands", "review-pr.md") },
  { target: "qwencode", outputPath: join(".qwen", "commands", "review-pr.md") },
  { target: "roo", outputPath: join(".roo", "commands", "review-pr.md") },
  { target: "zoocode", outputPath: join(".roo", "commands", "review-pr.md") },
  // Hermes commands are global plugin-backed slash commands, separate from skills.
  {
    target: "hermesagent",
    outputPath: join(getHermesagentGlobalDir(), "rulesync", "commands", "review-pr.json"),
  },
  { target: "reasonix", outputPath: join(".reasonix", "commands", "review-pr.md") },
  { target: "rovodev", outputPath: join(".rovodev", "prompts", "review-pr.md") },
  { target: "zcode", outputPath: join(".zcode", "commands", "review-pr.md") },
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
    { target: "bob", orphanPath: join(".bob", "commands", "orphan.md") },
    { target: "tabnine", orphanPath: join(".tabnine", "agent", "commands", "orphan.toml") },
    { target: "continue", orphanPath: join(".continue", "prompts", "orphan.md") },
    { target: "commandcode", orphanPath: join(".commandcode", "commands", "orphan.md") },
    { target: "qoder", orphanPath: join(".qoder", "commands", "orphan.md") },
    { target: "copilot", orphanPath: join(".github", "prompts", "orphan.prompt.md") },
    { target: "mimocode", orphanPath: join(".mimocode", "commands", "orphan.md") },
    { target: "omp", orphanPath: join(".omp", "commands", "orphan.md") },
    { target: "opencode", orphanPath: join(".opencode", "commands", "orphan.md") },
    { target: "cline", orphanPath: join(".clinerules", "workflows", "orphan.md") },
    { target: "codebuddy", orphanPath: join(".codebuddy", "commands", "orphan.md") },
    { target: "codewhale", orphanPath: join(".codewhale", "commands", "orphan.md") },
    { target: "kilo", orphanPath: join(".kilo", "commands", "orphan.md") },
    { target: "roo", orphanPath: join(".roo", "commands", "orphan.md") },
    { target: "kiro", orphanPath: join(".kiro", "prompts", "orphan.md") },
    { target: "antigravity-ide", orphanPath: join(".agents", "workflows", "orphan.md") },
    { target: "antigravity-cli", orphanPath: join(".agents", "workflows", "orphan.md") },
    { target: "junie", orphanPath: join(".junie", "commands", "orphan.md") },
    { target: "pi", orphanPath: join(".pi", "prompts", "orphan.md") },
    { target: "factorydroid", orphanPath: join(".factory", "commands", "orphan.md") },
    { target: "goose", orphanPath: join(".goose", "recipes", "orphan.yaml") },
    { target: "gitlabduo", orphanPath: join(".agents", "commands", "orphan.md") },
    { target: "grokcli", orphanPath: join(".grok", "commands", "orphan.md") },
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

  it.skipIf(process.platform === "win32")(
    "should keep both targets' commands when one commands directory is a link to the other",
    async () => {
      // `.cursor/commands -> .claude/commands` is one directory under two
      // spellings, so the cursor sweep must not read the claudecode-only
      // command as its orphan.
      const testDir = getTestDir();
      const stalePath = join(testDir, ".claude", "commands", "left-over.md");
      await writeFileContent(
        join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "claude-only.md"),
        [
          "---",
          'targets: ["claudecode"]',
          'description: "Claude only"',
          "---",
          "Claude body.",
        ].join("\n"),
      );
      await writeFileContent(stalePath, "# left over\n");
      await ensureDir(join(testDir, ".cursor"));
      await symlink(join(testDir, ".claude", "commands"), join(testDir, ".cursor", "commands"));

      await runGenerate({ target: "claudecode,cursor", features: "commands", deleteFiles: true });

      expect(
        await readFileContent(join(testDir, ".claude", "commands", "claude-only.md")),
      ).toContain("Claude body.");
      expect(await fileExists(stalePath)).toBe(false);
      await expect(
        runGenerate({
          target: "claudecode,cursor",
          features: "commands",
          deleteFiles: true,
          check: true,
          env: { NODE_ENV: "e2e" },
        }),
      ).resolves.toMatchObject({ stdout: expect.stringContaining("All files are up to date") });
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

describe("E2E: antigravity commands on the skills surface", () => {
  const { getTestDir } = useTestDirectory();

  const writeSources = async (testDir: string) => {
    await writeFileContent(
      join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "my-command.md"),
      `---
description: "My command"
targets: ["*"]
---
Do the thing.
`,
    );
    // A command and a skill with the same name: the skill wins.
    await writeFileContent(
      join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "shared-name.md"),
      `---
description: "Shadowed command"
targets: ["*"]
---
Command body.
`,
    );
    await writeFileContent(
      join(testDir, ".rulesync", "skills", "shared-name", "SKILL.md"),
      `---
name: shared-name
description: "Real skill"
targets: ["*"]
---
Skill body.
`,
    );
  };

  it("should migrate generated workflows to skills and keep them through every shared-root sweep", async () => {
    const testDir = getTestDir();
    await writeSources(testDir);
    // A workflow an earlier rulesync version generated, and an orphan skill.
    await writeFileContent(
      join(testDir, ".agents", "workflows", "my-command.md"),
      "---\ndescription: My command\n---\nold\n",
    );
    await writeFileContent(
      join(testDir, ".agents", "skills", "orphan-skill", "SKILL.md"),
      "---\nname: orphan-skill\ndescription: stale\n---\nold\n",
    );

    // `codexcli` sweeps the same `.agents/skills/` root.
    const target = "antigravity-ide,antigravity-cli,codexcli";
    await runGenerate({
      target,
      features: "commands,skills",
      deleteFiles: true,
      env: { NODE_ENV: "e2e" },
    });

    const commandSkill = await readFileContent(
      join(testDir, ".agents", "skills", "my-command", "SKILL.md"),
    );
    expect(commandSkill).toContain("name: my-command");
    expect(commandSkill).toContain("Do the thing.");
    expect(
      await readFileContent(join(testDir, ".agents", "skills", "shared-name", "SKILL.md")),
    ).toContain("Skill body.");
    expect(await fileExists(join(testDir, ".agents", "workflows", "my-command.md"))).toBe(false);
    expect(await fileExists(join(testDir, ".agents", "skills", "orphan-skill"))).toBe(false);

    await expect(
      runGenerate({
        target,
        features: "commands,skills",
        deleteFiles: true,
        check: true,
        env: { NODE_ENV: "e2e" },
      }),
    ).resolves.toMatchObject({ stdout: expect.stringContaining("All files are up to date") });
  });

  it("should keep command skills when a skills-only run deletes orphan skills", async () => {
    const testDir = getTestDir();
    await writeSources(testDir);

    await runGenerate({ target: "antigravity-ide", features: "commands,skills" });
    await runGenerate({
      target: "antigravity-ide",
      features: "skills",
      deleteFiles: true,
      env: { NODE_ENV: "e2e" },
    });

    expect(
      await readFileContent(join(testDir, ".agents", "skills", "my-command", "SKILL.md")),
    ).toContain("Do the thing.");
  });
});

describe("E2E: commands (import)", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "claudecode", sourcePath: join(".claude", "commands", "review-pr.md") },
    { target: "cursor", sourcePath: join(".cursor", "commands", "review-pr.md") },
    { target: "augmentcode", sourcePath: join(".augment", "commands", "review-pr.md") },
    { target: "bob", sourcePath: join(".bob", "commands", "review-pr.md") },
    { target: "continue", sourcePath: join(".continue", "prompts", "review-pr.md") },
    { target: "commandcode", sourcePath: join(".commandcode", "commands", "review-pr.md") },
    { target: "qoder", sourcePath: join(".qoder", "commands", "review-pr.md") },
    { target: "copilot", sourcePath: join(".github", "prompts", "review-pr.prompt.md") },
    { target: "mimocode", sourcePath: join(".mimocode", "commands", "review-pr.md") },
    { target: "omp", sourcePath: join(".omp", "commands", "review-pr.md") },
    { target: "opencode", sourcePath: join(".opencode", "commands", "review-pr.md") },
    { target: "cline", sourcePath: join(".clinerules", "workflows", "review-pr.md") },
    { target: "codebuddy", sourcePath: join(".codebuddy", "commands", "review-pr.md") },
    { target: "codewhale", sourcePath: join(".codewhale", "commands", "review-pr.md") },
    { target: "kilo", sourcePath: join(".kilo", "commands", "review-pr.md") },
    { target: "roo", sourcePath: join(".roo", "commands", "review-pr.md") },
    { target: "kiro", sourcePath: join(".kiro", "prompts", "review-pr.md") },
    { target: "antigravity-ide", sourcePath: join(".agents", "workflows", "review-pr.md") },
    { target: "antigravity-cli", sourcePath: join(".agents", "workflows", "review-pr.md") },
    { target: "junie", sourcePath: join(".junie", "commands", "review-pr.md") },
    { target: "pi", sourcePath: join(".pi", "prompts", "review-pr.md") },
    { target: "factorydroid", sourcePath: join(".factory", "commands", "review-pr.md") },
    { target: "gitlabduo", sourcePath: join(".agents", "commands", "review-pr.md") },
    { target: "grokcli", sourcePath: join(".grok", "commands", "review-pr.md") },
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

  it("should import tabnine commands (TOML)", async () => {
    const testDir = getTestDir();

    const commandToml = [
      'description = "Review a pull request"',
      'prompt = """',
      "Review the PR diff and provide feedback.",
      '"""',
    ].join("\n");
    await writeFileContent(
      join(testDir, ".tabnine", "agent", "commands", "review-pr.toml"),
      commandToml,
    );

    await runImport({ target: "tabnine", features: "commands" });

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
      join(homeDir, getHermesagentGlobalDir(), "plugins", "rulesync-commands", "__init__.py"),
    );
    const config = await readFileContent(join(homeDir, getHermesagentGlobalDir(), "config.yaml"));
    expect(plugin).toContain("ctx.register_command(slug, handler, description)");
    expect(plugin).toContain('"delegate_task"');
    expect(plugin).toContain('Path(__file__).resolve().parents[2] / "rulesync" / "commands"');
    expect(plugin).not.toContain('Path.home() / ".hermes"');
    expect(config).toContain("- rulesync-commands");
  });

  it("should clean the owned Hermes commands plugin and disable it with --delete", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();
    const commandPath = join(projectDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review-pr.md");
    await writeFileContent(
      commandPath,
      '---\ndescription: "Review a pull request"\ntargets: ["hermesagent"]\n---\nReview it.\n',
    );
    await writeFileContent(
      join(homeDir, getHermesagentGlobalDir(), "config.yaml"),
      "plugins:\n  enabled:\n    - existing-plugin\n",
    );

    await runGenerate({
      target: "hermesagent",
      features: "commands",
      global: true,
      env: { HOME_DIR: homeDir },
    });
    await removeFile(commandPath);
    await runGenerate({
      target: "hermesagent",
      features: "commands",
      global: true,
      deleteFiles: true,
      env: { HOME_DIR: homeDir },
    });

    expect(
      await fileExists(
        join(homeDir, getHermesagentGlobalDir(), "plugins", "rulesync-commands", "__init__.py"),
      ),
    ).toBe(false);
    const config = await readFileContent(join(homeDir, getHermesagentGlobalDir(), "config.yaml"));
    expect(config).toContain("- existing-plugin");
    expect(config).not.toContain("rulesync-commands");
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

import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import {
  runGenerate,
  runImport,
  useGlobalTestDirectories,
  useTestDirectory,
} from "./e2e-helper.js";

describe("E2E: commands", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "claudecode", outputPath: join(".claude", "commands", "review-pr.md") },
    { target: "cursor", outputPath: join(".cursor", "commands", "review-pr.md") },
    { target: "geminicli", outputPath: join(".gemini", "commands", "review-pr.toml") },
    { target: "copilot", outputPath: join(".github", "prompts", "review-pr.prompt.md") },
    { target: "opencode", outputPath: join(".opencode", "command", "review-pr.md") },
    { target: "cline", outputPath: join(".clinerules", "workflows", "review-pr.md") },
    { target: "kilo", outputPath: join(".kilo", "commands", "review-pr.md") },
    { target: "roo", outputPath: join(".roo", "commands", "review-pr.md") },
    { target: "kiro", outputPath: join(".kiro", "prompts", "review-pr.md") },
    { target: "antigravity", outputPath: join(".agent", "workflows", "review-pr.md") },
    { target: "junie", outputPath: join(".junie", "commands", "review-pr.md") },
    { target: "takt", outputPath: join(".takt", "facets", "instructions", "review-pr.md") },
  ])("should generate $target commands", async ({ target, outputPath }) => {
    const testDir = getTestDir();

    // Setup: Create .rulesync/commands/review-pr.md
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

    // Execute: Generate commands for the target
    await runGenerate({ target, features: "commands" });

    // Verify that the expected output file was generated
    const generatedContent = await readFileContent(join(testDir, outputPath));
    if (target === "geminicli") {
      // Gemini CLI uses TOML format
      expect(generatedContent).toContain('description = "Review a pull request"');
    } else {
      expect(generatedContent).toContain("Check the PR diff and provide feedback.");
    }
  });

  it.each([
    { target: "agentsmd", outputPath: join(".agents", "commands", "review-pr.md") },
    { target: "factorydroid", outputPath: join(".factory", "commands", "review-pr.md") },
  ])("should generate $target simulated commands", async ({ target, outputPath }) => {
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
  });

  it.each([
    { target: "claudecode", orphanPath: join(".claude", "commands", "orphan.md") },
    { target: "cursor", orphanPath: join(".cursor", "commands", "orphan.md") },
    { target: "geminicli", orphanPath: join(".gemini", "commands", "orphan.toml") },
    { target: "copilot", orphanPath: join(".github", "prompts", "orphan.prompt.md") },
    { target: "opencode", orphanPath: join(".opencode", "command", "orphan.md") },
    { target: "cline", orphanPath: join(".clinerules", "workflows", "orphan.md") },
    { target: "kilo", orphanPath: join(".kilo", "commands", "orphan.md") },
    { target: "roo", orphanPath: join(".roo", "commands", "orphan.md") },
    { target: "kiro", orphanPath: join(".kiro", "prompts", "orphan.md") },
    { target: "antigravity", orphanPath: join(".agent", "workflows", "orphan.md") },
    { target: "junie", orphanPath: join(".junie", "commands", "orphan.md") },
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

describe("E2E: commands (import)", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "claudecode", sourcePath: join(".claude", "commands", "review-pr.md") },
    { target: "cursor", sourcePath: join(".cursor", "commands", "review-pr.md") },
    { target: "copilot", sourcePath: join(".github", "prompts", "review-pr.prompt.md") },
    { target: "opencode", sourcePath: join(".opencode", "command", "review-pr.md") },
    { target: "cline", sourcePath: join(".clinerules", "workflows", "review-pr.md") },
    { target: "kilo", sourcePath: join(".kilo", "commands", "review-pr.md") },
    { target: "roo", sourcePath: join(".roo", "commands", "review-pr.md") },
    { target: "kiro", sourcePath: join(".kiro", "prompts", "review-pr.md") },
    { target: "antigravity", sourcePath: join(".agent", "workflows", "review-pr.md") },
    { target: "junie", sourcePath: join(".junie", "commands", "review-pr.md") },
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
});

describe("E2E: commands (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it.each([
    { target: "claudecode", outputPath: join(".claude", "commands", "review-pr.md") },
    { target: "cursor", outputPath: join(".cursor", "commands", "review-pr.md") },
    { target: "opencode", outputPath: join(".config", "opencode", "command", "review-pr.md") },
    { target: "geminicli", outputPath: join(".gemini", "commands", "review-pr.toml") },
    { target: "codexcli", outputPath: join(".codex", "prompts", "review-pr.md") },
    { target: "cline", outputPath: join("Documents", "Cline", "Workflows", "review-pr.md") },
    { target: "kilo", outputPath: join(".config", "kilo", "commands", "review-pr.md") },
    { target: "junie", outputPath: join(".junie", "commands", "review-pr.md") },
    {
      target: "takt",
      outputPath: join(".takt", "facets", "instructions", "review-pr.md"),
    },
  ])("should generate $target commands in home directory", async ({ target, outputPath }) => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    // Setup: Create .rulesync/commands/review-pr.md with root: true
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

    // Execute: Generate commands in global mode with HOME pointed to temp dir
    await runGenerate({
      target,
      features: "commands",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    // Verify that the expected output file was generated
    const generatedContent = await readFileContent(join(homeDir, outputPath));
    if (target === "geminicli") {
      // Gemini CLI uses TOML format
      expect(generatedContent).toContain('description = "Review a pull request"');
    } else {
      expect(generatedContent).toContain("Check the PR diff and provide feedback.");
    }
  });

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

import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import { runGenerate, useGlobalTestDirectories, useTestDirectory } from "./e2e-helper.js";

describe("E2E: commands", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "claudecode", outputPath: join(".claude", "commands", "review-pr.md") },
    { target: "cursor", outputPath: join(".cursor", "commands", "review-pr.md") },
    { target: "geminicli", outputPath: join(".gemini", "commands", "review-pr.toml") },
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
});

describe("E2E: commands (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it.each([
    { target: "claudecode", outputPath: join(".claude", "commands", "review-pr.md") },
    { target: "cursor", outputPath: join(".cursor", "commands", "review-pr.md") },
    { target: "opencode", outputPath: join(".config", "opencode", "command", "review-pr.md") },
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
    expect(generatedContent).toContain("Check the PR diff and provide feedback.");
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

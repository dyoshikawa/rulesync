import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { ensureDir, readFileContent, writeFileContent } from "../utils/file.js";
import { execFileAsync, rulesyncArgs, rulesyncCmd, useTestDirectory } from "./e2e-helper.js";

describe("E2E: commands", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "claudecode", outputPath: join(".claude", "commands", "review-pr.md") },
    { target: "copilot", outputPath: join(".github", "prompts", "review-pr.prompt.md") },
    { target: "geminicli", outputPath: join(".gemini", "commands", "review-pr.toml") },
  ])("should generate $target commands", async ({ target, outputPath }) => {
    const testDir = getTestDir();

    // Setup: Create .rulesync/commands/review-pr.md
    await ensureDir(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);

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
    await execFileAsync(rulesyncCmd, [
      ...rulesyncArgs,
      "generate",
      "--targets",
      target,
      "--features",
      "commands",
    ]);

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

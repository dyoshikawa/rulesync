import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { ensureDir, readFileContent, writeFileContent } from "../utils/file.js";
import { execFileAsync, rulesyncArgs, rulesyncCmd, useTestDirectory } from "./e2e-helper.js";

describe("E2E: skills", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    {
      target: "claudecode",
      outputPath: join(".claude", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "cursor",
      outputPath: join(".cursor", "skills", "test-skill", "SKILL.md"),
    },
  ])("should generate $target skills", async ({ target, outputPath }) => {
    const testDir = getTestDir();

    // Setup: Create .rulesync/skills/test-skill/SKILL.md
    await ensureDir(join(RULESYNC_SKILLS_RELATIVE_DIR_PATH, "test-skill"));

    const skillContent = `---
name: test-skill
description: "A test skill for E2E testing"
targets: ["*"]
---
This is the test skill body content.
`;
    await writeFileContent(
      join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "test-skill", "SKILL.md"),
      skillContent,
    );

    // Execute: Generate skills for the target
    await execFileAsync(rulesyncCmd, [
      ...rulesyncArgs,
      "generate",
      "--targets",
      target,
      "--features",
      "skills",
    ]);

    // Verify that the expected output file was generated
    const generatedContent = await readFileContent(join(testDir, outputPath));
    expect(generatedContent).toContain("test skill body content");
  });
});

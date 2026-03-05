import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import { runGenerate, useGlobalTestDirectories, useTestDirectory } from "./e2e-helper.js";

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
    await runGenerate({ target, features: "skills" });

    // Verify that the expected output file was generated
    const generatedContent = await readFileContent(join(testDir, outputPath));
    expect(generatedContent).toContain("test skill body content");
  });
});

describe("E2E: skills (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it.each([
    {
      target: "claudecode",
      outputPath: join(".claude", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "cursor",
      outputPath: join(".cursor", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "opencode",
      outputPath: join(".config", "opencode", "skill", "test-skill", "SKILL.md"),
    },
  ])("should generate $target skills in home directory", async ({ target, outputPath }) => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    // Setup: Create .rulesync/skills/test-skill/SKILL.md with root: true
    const skillContent = `---
root: true
name: test-skill
description: "A test skill for E2E testing"
targets: ["*"]
---
This is the test skill body content.
`;
    await writeFileContent(
      join(projectDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "test-skill", "SKILL.md"),
      skillContent,
    );

    // Execute: Generate skills in global mode with HOME pointed to temp dir
    await runGenerate({
      target,
      features: "skills",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    // Verify that the expected output file was generated
    const generatedContent = await readFileContent(join(homeDir, outputPath));
    expect(generatedContent).toContain("test skill body content");
  });

  it("should ignore non-root skills in global mode", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    // Setup: Create a root skill and a non-root skill
    const rootSkillContent = `---
root: true
name: root-skill
description: "Root skill"
targets: ["*"]
---
Root skill body
`;
    const nonRootSkillContent = `---
name: non-root-skill
description: "Non-root skill"
targets: ["*"]
---
Non-root skill body
`;
    await writeFileContent(
      join(projectDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "test-skill", "SKILL.md"),
      rootSkillContent,
    );
    await writeFileContent(
      join(projectDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "extra-skill", "SKILL.md"),
      nonRootSkillContent,
    );

    // Execute: Generate skills in global mode
    await runGenerate({
      target: "claudecode",
      features: "skills",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    // Verify: root skill content is present, non-root skill content is absent
    const generatedContent = await readFileContent(
      join(homeDir, ".claude", "skills", "test-skill", "SKILL.md"),
    );
    expect(generatedContent).toContain("Root skill body");
    expect(generatedContent).not.toContain("Non-root skill body");
  });
});

import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import {
  runGenerate,
  runImport,
  useGlobalTestDirectories,
  useTestDirectory,
} from "./e2e-helper.js";

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
    {
      target: "codexcli",
      outputPath: join(".codex", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "geminicli",
      outputPath: join(".gemini", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "copilot",
      outputPath: join(".github", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "deepagents",
      outputPath: join(".deepagents", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "cline",
      outputPath: join(".cline", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "kilo",
      outputPath: join(".kilo", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "roo",
      outputPath: join(".roo", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "rovodev",
      outputPath: join(".rovodev", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "windsurf",
      outputPath: join(".windsurf", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "kiro",
      outputPath: join(".kiro", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "antigravity",
      outputPath: join(".agent", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "junie",
      outputPath: join(".junie", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "replit",
      outputPath: join(".agents", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "agentsskills",
      outputPath: join(".agents", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "takt",
      outputPath: join(".takt", "facets", "knowledge", "test-skill.md"),
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

  it.each([
    {
      target: "agentsmd",
      outputPath: join(".agents", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "factorydroid",
      outputPath: join(".factory", "skills", "test-skill", "SKILL.md"),
    },
  ])("should generate $target simulated skills", async ({ target, outputPath }) => {
    const testDir = getTestDir();

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

    await runGenerate({ target, features: "skills", simulateSkills: true });

    const generatedContent = await readFileContent(join(testDir, outputPath));
    expect(generatedContent).toContain("test skill body content");
  });

  it.each([
    { target: "claudecode", orphanPath: join(".claude", "skills", "orphan-skill", "SKILL.md") },
    { target: "cursor", orphanPath: join(".cursor", "skills", "orphan-skill", "SKILL.md") },
    { target: "codexcli", orphanPath: join(".codex", "skills", "orphan-skill", "SKILL.md") },
    { target: "geminicli", orphanPath: join(".gemini", "skills", "orphan-skill", "SKILL.md") },
    { target: "copilot", orphanPath: join(".github", "skills", "orphan-skill", "SKILL.md") },
    { target: "deepagents", orphanPath: join(".deepagents", "skills", "orphan-skill", "SKILL.md") },
    { target: "cline", orphanPath: join(".cline", "skills", "orphan-skill", "SKILL.md") },
    { target: "kilo", orphanPath: join(".kilo", "skills", "orphan-skill", "SKILL.md") },
    { target: "roo", orphanPath: join(".roo", "skills", "orphan-skill", "SKILL.md") },
    { target: "rovodev", orphanPath: join(".rovodev", "skills", "orphan-skill", "SKILL.md") },
    { target: "windsurf", orphanPath: join(".windsurf", "skills", "orphan-skill", "SKILL.md") },
    { target: "kiro", orphanPath: join(".kiro", "skills", "orphan-skill", "SKILL.md") },
    { target: "antigravity", orphanPath: join(".agent", "skills", "orphan-skill", "SKILL.md") },
    { target: "junie", orphanPath: join(".junie", "skills", "orphan-skill", "SKILL.md") },
    { target: "replit", orphanPath: join(".agents", "skills", "orphan-skill", "SKILL.md") },
    { target: "agentsskills", orphanPath: join(".agents", "skills", "orphan-skill", "SKILL.md") },
  ])(
    "should fail in check mode when delete would remove an orphan $target skill file",
    async ({ target, orphanPath }) => {
      const testDir = getTestDir();

      await writeFileContent(join(testDir, ".rulesync", ".gitkeep"), "");
      await writeFileContent(join(testDir, orphanPath), "# orphan\n");

      await expect(
        runGenerate({
          target,
          features: "skills",
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

describe("E2E: skills (import)", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "claudecode", sourcePath: join(".claude", "skills", "test-skill", "SKILL.md") },
    { target: "cursor", sourcePath: join(".cursor", "skills", "test-skill", "SKILL.md") },
    { target: "codexcli", sourcePath: join(".codex", "skills", "test-skill", "SKILL.md") },
    { target: "geminicli", sourcePath: join(".gemini", "skills", "test-skill", "SKILL.md") },
    { target: "copilot", sourcePath: join(".github", "skills", "test-skill", "SKILL.md") },
    { target: "opencode", sourcePath: join(".opencode", "skill", "test-skill", "SKILL.md") },
    { target: "deepagents", sourcePath: join(".deepagents", "skills", "test-skill", "SKILL.md") },
    { target: "cline", sourcePath: join(".cline", "skills", "test-skill", "SKILL.md") },
    { target: "kilo", sourcePath: join(".kilo", "skills", "test-skill", "SKILL.md") },
    { target: "roo", sourcePath: join(".roo", "skills", "test-skill", "SKILL.md") },
    { target: "rovodev", sourcePath: join(".rovodev", "skills", "test-skill", "SKILL.md") },
    { target: "windsurf", sourcePath: join(".windsurf", "skills", "test-skill", "SKILL.md") },
    { target: "kiro", sourcePath: join(".kiro", "skills", "test-skill", "SKILL.md") },
    { target: "antigravity", sourcePath: join(".agent", "skills", "test-skill", "SKILL.md") },
    { target: "junie", sourcePath: join(".junie", "skills", "test-skill", "SKILL.md") },
    { target: "replit", sourcePath: join(".agents", "skills", "test-skill", "SKILL.md") },
  ])("should import $target skills", async ({ target, sourcePath }) => {
    const testDir = getTestDir();

    const skillContent = `---
name: test-skill
description: "A test skill for E2E testing"
---
This is the test skill body content.`;
    await writeFileContent(join(testDir, sourcePath), skillContent);

    await runImport({ target, features: "skills" });

    const importedContent = await readFileContent(
      join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "test-skill", "SKILL.md"),
    );
    expect(importedContent).toContain("test skill body content");
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
    {
      target: "codexcli",
      outputPath: join(".codex", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "geminicli",
      outputPath: join(".gemini", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "cline",
      outputPath: join(".cline", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "kilo",
      outputPath: join(".config", "kilo", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "roo",
      outputPath: join(".roo", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "rovodev",
      outputPath: join(".rovodev", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "windsurf",
      outputPath: join(".codeium", "windsurf", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "antigravity",
      outputPath: join(".gemini", "antigravity", "skills", "test-skill", "SKILL.md"),
    },
    {
      target: "takt",
      outputPath: join(".takt", "facets", "knowledge", "test-skill.md"),
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

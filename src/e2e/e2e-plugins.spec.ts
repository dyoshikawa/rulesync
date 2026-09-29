import { symlink } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import {
  ensureDir,
  fileExists,
  removeDirectory,
  readFileContent,
  writeFileContent,
} from "../utils/file.js";
import {
  runGenerate,
  runImport,
  useGlobalTestDirectories,
  useTestDirectory,
} from "./e2e-helper.js";

describe("E2E: plugin targets", () => {
  const { getTestDir } = useTestDirectory();

  it("generates and imports a Claude Code plugin from an explicit plugin root", async () => {
    const testDir = getTestDir();
    const pluginRoot = join(testDir, "packages", "review-plugin");
    const rulesyncSkillDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "review");

    await writeFileContent(
      join(rulesyncSkillDir, "SKILL.md"),
      `---
name: review
description: Review code changes
targets: ["claudecode-plugin"]
---
Review the current changes.
`,
    );
    await writeFileContent(
      join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "project-only", "SKILL.md"),
      `---
name: project-only
description: Project-only skill
targets: ["claudecode"]
---
Do not package this skill.
`,
    );
    await writeFileContent(
      join(pluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "review-plugin" }, null, 2),
    );
    await writeFileContent(join(pluginRoot, "scripts", "check.sh"), "#!/bin/sh\n");

    await runGenerate({
      target: "claudecode-plugin",
      features: "skills",
      outputRoots: pluginRoot,
    });

    const generatedSkill = join(pluginRoot, "skills", "review", "SKILL.md");
    expect(await readFileContent(generatedSkill)).toContain("Review the current changes.");
    expect(await fileExists(join(pluginRoot, "skills", "project-only", "SKILL.md"))).toBe(false);
    expect(await fileExists(join(pluginRoot, "scripts", "check.sh"))).toBe(true);

    await removeDirectory(join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH));
    await ensureDir(join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH));

    await runImport({
      target: "claudecode-plugin",
      features: "skills",
      outputRoot: pluginRoot,
    });

    expect(await readFileContent(join(rulesyncSkillDir, "SKILL.md"))).toContain(
      "Review the current changes.",
    );
    expect(await fileExists(join(pluginRoot, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(await fileExists(join(pluginRoot, "scripts", "check.sh"))).toBe(true);
  });

  it("generates and imports an Antigravity plugin from an explicit plugin root", async () => {
    const testDir = getTestDir();
    const pluginRoot = join(testDir, "packages", "review-plugin");
    const rulesyncRulePath = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "review.md");

    await writeFileContent(
      rulesyncRulePath,
      `---
targets: ["antigravity-plugin"]
description: Review conventions
---
Review changes before submission.
`,
    );
    await writeFileContent(
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "ide-only.md"),
      `---
targets: ["antigravity-ide"]
description: IDE-only conventions
---
Do not package this rule.
`,
    );
    await writeFileContent(
      join(pluginRoot, "plugin.json"),
      JSON.stringify({ name: "review-plugin" }, null, 2),
    );
    await writeFileContent(join(pluginRoot, "assets", "icon.txt"), "plugin icon\n");

    await runGenerate({
      target: "antigravity-plugin",
      features: "rules",
      outputRoots: pluginRoot,
    });

    const generatedRule = join(pluginRoot, "rules", "review.md");
    expect(await readFileContent(generatedRule)).toContain("Review changes before submission.");
    expect(await fileExists(join(pluginRoot, "rules", "ide-only.md"))).toBe(false);
    expect(await fileExists(join(pluginRoot, "assets", "icon.txt"))).toBe(true);

    await removeDirectory(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
    await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));

    await runImport({
      target: "antigravity-plugin",
      features: "rules",
      outputRoot: pluginRoot,
    });

    expect(await readFileContent(rulesyncRulePath)).toContain("Review changes before submission.");
    expect(await fileExists(join(pluginRoot, "plugin.json"))).toBe(true);
    expect(await fileExists(join(pluginRoot, "assets", "icon.txt"))).toBe(true);
  });

  it("generates and imports an AugmentCode plugin from an explicit plugin root", async () => {
    const testDir = getTestDir();
    const pluginRoot = join(testDir, "packages", "review-plugin");
    const rulesyncRulePath = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "review.md");

    await writeFileContent(
      rulesyncRulePath,
      `---
targets: ["augmentcode-plugin"]
description: Review conventions
augmentcode:
  type: agent_requested
---
Review changes before submission.
`,
    );
    await writeFileContent(
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "project-only.md"),
      `---
targets: ["augmentcode"]
description: Project-only conventions
---
Do not package this rule.
`,
    );
    await writeFileContent(
      join(pluginRoot, ".augment-plugin", "plugin.json"),
      JSON.stringify({ name: "review-plugin" }, null, 2),
    );

    await runGenerate({
      target: "augmentcode-plugin",
      features: "rules",
      outputRoots: pluginRoot,
    });

    const generatedRule = await readFileContent(join(pluginRoot, "rules", "review.md"));
    expect(generatedRule).toContain("type: agent_requested");
    expect(generatedRule).toContain("Review changes before submission.");
    expect(await fileExists(join(pluginRoot, "rules", "project-only.md"))).toBe(false);
    expect(await fileExists(join(testDir, ".augment", "rules", "review.md"))).toBe(false);

    await removeDirectory(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
    await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));

    await runImport({
      target: "augmentcode-plugin",
      features: "rules",
      outputRoot: pluginRoot,
    });

    const imported = await readFileContent(rulesyncRulePath);
    expect(imported).toContain("Review changes before submission.");
    expect(imported).toContain("type: agent_requested");
    expect(await fileExists(join(pluginRoot, ".augment-plugin", "plugin.json"))).toBe(true);
  });

  describe.skipIf(process.platform === "win32")("symbolic link safety", () => {
    it("rejects plugin imports containing symbolic links", async () => {
      const testDir = getTestDir();
      const pluginRoot = join(testDir, "plugins", "untrusted");
      const outsideFile = join(testDir, "secret.txt");
      await writeFileContent(
        join(pluginRoot, "skills", "review", "SKILL.md"),
        `---
name: review
description: Review code changes
---
Review the current changes.
`,
      );
      await writeFileContent(outsideFile, "secret");
      await symlink(outsideFile, join(pluginRoot, "skills", "review", "secret.txt"));

      await expect(
        runImport({
          target: "claudecode-plugin",
          features: "skills",
          outputRoot: pluginRoot,
        }),
      ).rejects.toThrow();
      expect(
        await fileExists(join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "review", "secret.txt")),
      ).toBe(false);
    });
  });
});

describe.skipIf(process.platform === "win32")("E2E: plugin targets in global mode", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  const writeHomeWithUnrelatedSymlink = async (homeDir: string): Promise<void> => {
    // An ordinary home directory contains symlinks (version managers, dotfile
    // managers, ...). A packaging target must never scan it for them.
    const outsideFile = join(homeDir, "tool", "bin", "real-binary");
    await writeFileContent(outsideFile, "#!/bin/sh\n");
    await ensureDir(join(homeDir, ".cache", "bin"));
    await symlink(outsideFile, join(homeDir, ".cache", "bin", "linked-binary"));
  };

  it("skips a packaging target with a warning and still generates the other targets", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();
    await writeHomeWithUnrelatedSymlink(homeDir);
    await writeFileContent(
      join(projectDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "review", "SKILL.md"),
      `---
name: review
description: Review code changes
targets: ["*"]
---
Review the current changes.
`,
    );

    const { stderr, stdout } = await runGenerate({
      target: "claudecode,claudecode-plugin",
      features: "skills",
      global: true,
      env: { HOME_DIR: homeDir, NODE_ENV: "e2e" },
    });

    const output = `${stdout}\n${stderr}`;
    expect(output).toContain(
      "Target 'claudecode-plugin' is a plugin packaging target and supports only project scope. Re-run without '--global'. Skipping.",
    );
    expect(output).not.toContain("symbolic link");
    expect(
      await readFileContent(join(homeDir, ".claude", "skills", "review", "SKILL.md")),
    ).toContain("Review the current changes.");
    expect(await fileExists(join(homeDir, "skills", "review", "SKILL.md"))).toBe(false);
  });

  it("rejects importing a packaging target", async () => {
    const homeDir = getHomeDir();
    await writeHomeWithUnrelatedSymlink(homeDir);

    await expect(
      runImport({
        target: "claudecode-plugin",
        features: "skills",
        global: true,
        env: { HOME_DIR: homeDir, NODE_ENV: "e2e" },
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        "Target 'claudecode-plugin' is a plugin packaging target and supports only project scope. Re-run without '--global'.",
      ),
    });
  });
});

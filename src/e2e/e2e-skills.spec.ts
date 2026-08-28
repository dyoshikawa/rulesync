import { symlink } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { SkillsProcessor } from "../features/skills/skills-processor.js";
import { ensureDir, fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { getHermesagentGlobalDir } from "../utils/hermesagent.js";
import {
  assertGenerateMatrixCoversTargets,
  runGenerate,
  runImport,
  useGlobalTestDirectories,
  useTestDirectory,
} from "./e2e-helper.js";

// One SKILL.md per tool skill directory.
const skillsGenerateTargets = [
  {
    target: "augmentcode",
    outputPath: join(".augment", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "claudecode",
    outputPath: join(".claude", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "claudecode-plugin",
    outputPath: join("skills", "test-skill", "SKILL.md"),
  },
  {
    target: "cursor",
    outputPath: join(".cursor", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "codexcli",
    outputPath: join(".agents", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "musecode",
    outputPath: join(".agents", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "grokcli",
    outputPath: join(".grok", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "goose",
    outputPath: join(".goose", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "qwencode",
    outputPath: join(".qwen", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "copilot",
    outputPath: join(".github", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "copilotcli",
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
    target: "kimi-code",
    outputPath: join(".kimi-code", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "roo",
    outputPath: join(".roo", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "zoocode",
    outputPath: join(".roo", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "rovodev",
    outputPath: join(".rovodev", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "devin",
    outputPath: join(".devin", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "warp",
    outputPath: join(".warp", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "kiro",
    outputPath: join(".kiro", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "antigravity-ide",
    outputPath: join(".agents", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "antigravity-plugin",
    outputPath: join("skills", "test-skill", "SKILL.md"),
  },
  {
    target: "antigravity-cli",
    outputPath: join(".agents", "skills", "test-skill", "SKILL.md"),
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
    target: "aiassistant",
    outputPath: join(".agents", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "amp",
    outputPath: join(".agents", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "takt",
    outputPath: join(".takt", "facets", "knowledge", "test-skill.md"),
  },
  {
    target: "pi",
    outputPath: join(".pi", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "zed",
    outputPath: join(".agents", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "factorydroid",
    outputPath: join(".factory", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "vibe",
    outputPath: join(".vibe", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "opencode",
    outputPath: join(".opencode", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "kiro-cli",
    outputPath: join(".kiro", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "kiro-ide",
    outputPath: join(".kiro", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "reasonix",
    outputPath: join(".reasonix", "skills", "test-skill", "SKILL.md"),
  },
] as const;

describe("E2E: skills", () => {
  const { getTestDir } = useTestDirectory();

  it("generate matrix must cover every native skills tool target", () => {
    // agentsmd is a simulated-only target (excluded from native getToolTargets),
    // so it is exercised by the dedicated simulated-skills matrix instead.
    assertGenerateMatrixCoversTargets({
      processor: SkillsProcessor,
      testedTargets: skillsGenerateTargets.map((e) => e.target),
    });
  });

  it.each(skillsGenerateTargets)(
    "should generate $target skills",
    async ({ target, outputPath }) => {
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

      await runGenerate({ target, features: "skills" });

      const generatedContent = await readFileContent(join(testDir, outputPath));
      expect(generatedContent).toContain("test skill body content");
    },
  );

  // The Agent Skills spec types `allowed-tools` as a space-separated string,
  // `compatibility` as a string and `metadata` as a string→string map, so the
  // legacy rulesync list/object/number spellings must not reach the file.
  // https://agentskills.io/specification
  it("should write spec-conformant scalar frontmatter for agentsskills", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "test-skill", "SKILL.md"),
      `---
name: test-skill
description: "A test skill for E2E testing"
targets: ["*"]
agentsskills:
  allowed-tools: ["Read", "Bash(git:*)"]
  compatibility:
    runtime: node
  metadata:
    version: 1
---
This is the test skill body content.
`,
    );

    await runGenerate({ target: "agentsskills", features: "skills" });

    const generatedContent = await readFileContent(
      join(testDir, ".agents", "skills", "test-skill", "SKILL.md"),
    );
    expect(generatedContent).toContain("allowed-tools: Read Bash(git:*)");
    expect(generatedContent).toContain("compatibility: 'runtime: node'");
    expect(generatedContent).toContain("version: '1'");
    expect(generatedContent).not.toContain("- Read");
  });

  it.each([
    {
      target: "agentsmd",
      outputPath: join(".agents", "skills", "test-skill", "SKILL.md"),
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
    { target: "codexcli", orphanPath: join(".agents", "skills", "orphan-skill", "SKILL.md") },
    { target: "copilot", orphanPath: join(".github", "skills", "orphan-skill", "SKILL.md") },
    { target: "deepagents", orphanPath: join(".deepagents", "skills", "orphan-skill", "SKILL.md") },
    { target: "cline", orphanPath: join(".cline", "skills", "orphan-skill", "SKILL.md") },
    { target: "kilo", orphanPath: join(".kilo", "skills", "orphan-skill", "SKILL.md") },
    { target: "roo", orphanPath: join(".roo", "skills", "orphan-skill", "SKILL.md") },
    { target: "rovodev", orphanPath: join(".rovodev", "skills", "orphan-skill", "SKILL.md") },
    { target: "devin", orphanPath: join(".devin", "skills", "orphan-skill", "SKILL.md") },
    { target: "warp", orphanPath: join(".warp", "skills", "orphan-skill", "SKILL.md") },
    { target: "kiro", orphanPath: join(".kiro", "skills", "orphan-skill", "SKILL.md") },
    {
      target: "antigravity-ide",
      orphanPath: join(".agents", "skills", "orphan-skill", "SKILL.md"),
    },
    {
      target: "antigravity-cli",
      orphanPath: join(".agents", "skills", "orphan-skill", "SKILL.md"),
    },
    { target: "junie", orphanPath: join(".junie", "skills", "orphan-skill", "SKILL.md") },
    { target: "replit", orphanPath: join(".agents", "skills", "orphan-skill", "SKILL.md") },
    { target: "agentsskills", orphanPath: join(".agents", "skills", "orphan-skill", "SKILL.md") },
    { target: "aiassistant", orphanPath: join(".agents", "skills", "orphan-skill", "SKILL.md") },
    { target: "pi", orphanPath: join(".pi", "skills", "orphan-skill", "SKILL.md") },
    { target: "zed", orphanPath: join(".agents", "skills", "orphan-skill", "SKILL.md") },
    { target: "factorydroid", orphanPath: join(".factory", "skills", "orphan-skill", "SKILL.md") },
    { target: "vibe", orphanPath: join(".vibe", "skills", "orphan-skill", "SKILL.md") },
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
    { target: "codexcli", sourcePath: join(".agents", "skills", "test-skill", "SKILL.md") },
    { target: "copilot", sourcePath: join(".github", "skills", "test-skill", "SKILL.md") },
    { target: "opencode", sourcePath: join(".opencode", "skill", "test-skill", "SKILL.md") },
    { target: "deepagents", sourcePath: join(".deepagents", "skills", "test-skill", "SKILL.md") },
    { target: "cline", sourcePath: join(".cline", "skills", "test-skill", "SKILL.md") },
    { target: "kilo", sourcePath: join(".kilo", "skills", "test-skill", "SKILL.md") },
    {
      target: "kimi-code",
      sourcePath: join(".kimi-code", "skills", "test-skill", "SKILL.md"),
    },
    { target: "roo", sourcePath: join(".roo", "skills", "test-skill", "SKILL.md") },
    { target: "rovodev", sourcePath: join(".rovodev", "skills", "test-skill", "SKILL.md") },
    { target: "devin", sourcePath: join(".devin", "skills", "test-skill", "SKILL.md") },
    { target: "warp", sourcePath: join(".warp", "skills", "test-skill", "SKILL.md") },
    { target: "kiro", sourcePath: join(".kiro", "skills", "test-skill", "SKILL.md") },
    { target: "antigravity-ide", sourcePath: join(".agents", "skills", "test-skill", "SKILL.md") },
    { target: "antigravity-cli", sourcePath: join(".agents", "skills", "test-skill", "SKILL.md") },
    { target: "junie", sourcePath: join(".junie", "skills", "test-skill", "SKILL.md") },
    { target: "aiassistant", sourcePath: join(".agents", "skills", "test-skill", "SKILL.md") },
    { target: "replit", sourcePath: join(".agents", "skills", "test-skill", "SKILL.md") },
    { target: "pi", sourcePath: join(".pi", "skills", "test-skill", "SKILL.md") },
    { target: "zed", sourcePath: join(".agents", "skills", "test-skill", "SKILL.md") },
    { target: "factorydroid", sourcePath: join(".factory", "skills", "test-skill", "SKILL.md") },
    { target: "vibe", sourcePath: join(".vibe", "skills", "test-skill", "SKILL.md") },
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

  it("should import vibe skills from the .agents/skills fallback root", async () => {
    const testDir = getTestDir();

    const skillContent = `---
name: fallback-skill
description: "A fallback Vibe skill"
---
This is the fallback skill body content.`;
    await writeFileContent(
      join(testDir, ".agents", "skills", "fallback-skill", "SKILL.md"),
      skillContent,
    );

    await runImport({ target: "vibe", features: "skills" });

    const importedContent = await readFileContent(
      join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "fallback-skill", "SKILL.md"),
    );
    expect(importedContent).toContain("fallback skill body content");
  });

  it("should import Kimi flat and shared skills with Kimi-specific precedence", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".kimi-code", "skills", "review.md"),
      "Primary flat skill description\n\nPrimary flat skill body.",
    );
    await writeFileContent(
      join(testDir, ".agents", "skills", "review", "SKILL.md"),
      [
        "---",
        "name: review",
        'description: "Lower-precedence shared skill"',
        "---",
        "Shared duplicate body.",
      ].join("\n"),
    );
    await writeFileContent(
      join(testDir, ".agents", "skills", "shared", "SKILL.md"),
      [
        "---",
        "name: shared",
        'description: "Shared Agent Skill"',
        "---",
        "Shared-only skill body.",
      ].join("\n"),
    );
    await writeFileContent(
      join(testDir, ".kimi-code", "skills", "primary", "SKILL.md"),
      [
        "---",
        "name: Logical-Review",
        'description: "Directory-form logical skill"',
        "---",
        "Primary directory-form logical skill.",
      ].join("\n"),
    );
    await writeFileContent(
      join(testDir, ".kimi-code", "skills", "alternate.md"),
      [
        "---",
        "name: logical-review",
        'description: "Flat logical duplicate"',
        "---",
        "This flat logical duplicate must lose.",
      ].join("\n"),
    );
    await writeFileContent(
      join(testDir, ".agents", "skills", "different-path", "SKILL.md"),
      [
        "---",
        "name: LOGICAL-REVIEW",
        'description: "Shared logical duplicate"',
        "---",
        "This shared logical duplicate must lose.",
      ].join("\n"),
    );
    await writeFileContent(
      join(testDir, ".kimi-code", "skills", "collision", "SKILL.md"),
      [
        "---",
        "name: directory-logical",
        'description: "Directory collision skill"',
        "---",
        "Directory collision body.",
      ].join("\n"),
    );
    await writeFileContent(
      join(testDir, ".kimi-code", "skills", "collision.md"),
      [
        "---",
        "name: flat-logical",
        'description: "Flat collision skill"',
        "---",
        "Flat collision body.",
      ].join("\n"),
    );

    await runImport({ target: "kimi-code", features: "skills" });

    const review = await readFileContent(
      join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "review", "SKILL.md"),
    );
    expect(review).toContain("name: review");
    expect(review).toContain("description: Primary flat skill description");
    expect(review).toContain("Primary flat skill body");
    expect(review).not.toContain("Shared duplicate body");
    expect(
      await readFileContent(join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "shared", "SKILL.md")),
    ).toContain("Shared-only skill body");
    const logicalReview = await readFileContent(
      join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "logical-review", "SKILL.md"),
    );
    expect(logicalReview).toContain("Primary directory-form logical skill");
    expect(logicalReview).not.toContain("logical duplicate must lose");
    expect(
      await fileExists(join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "alternate", "SKILL.md")),
    ).toBe(false);
    expect(
      await fileExists(
        join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "different-path", "SKILL.md"),
      ),
    ).toBe(false);
    expect(
      await readFileContent(
        join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "directory-logical", "SKILL.md"),
      ),
    ).toContain("Directory collision body");
    expect(
      await fileExists(
        join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "flat-logical", "SKILL.md"),
      ),
    ).toBe(false);
  });

  it("should not delete Kimi shared-root skills", async () => {
    const testDir = getTestDir();
    const sharedSkillPath = join(testDir, ".agents", "skills", "shared", "SKILL.md");
    await writeFileContent(join(testDir, ".rulesync", ".gitkeep"), "");
    await writeFileContent(
      sharedSkillPath,
      [
        "---",
        "name: shared",
        'description: "Shared Agent Skill"',
        "---",
        "User-owned shared skill.",
      ].join("\n"),
    );

    await runGenerate({
      target: "kimi-code",
      features: "skills",
      deleteFiles: true,
    });

    expect(await readFileContent(sharedSkillPath)).toContain("User-owned shared skill");
  });

  it("should keep both targets' skills when they share the .agents/skills root", async () => {
    // `agentsskills` and `replit` write into one directory, so a per-target
    // orphan sweep sees the sibling's freshly written skill as a leftover and
    // deletes the whole directory.
    const testDir = getTestDir();
    await writeFileContent(
      join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "spec-only", "SKILL.md"),
      [
        "---",
        'targets: ["agentsskills"]',
        "name: spec-only",
        'description: "Spec only skill"',
        "---",
        "Spec body.",
      ].join("\n"),
    );
    await writeFileContent(
      join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "replit-only", "SKILL.md"),
      [
        "---",
        'targets: ["replit"]',
        "name: replit-only",
        'description: "Replit only skill"',
        "---",
        "Replit body.",
      ].join("\n"),
    );

    await runGenerate({
      target: "agentsskills,replit",
      features: "skills",
      deleteFiles: true,
    });

    expect(
      await readFileContent(join(testDir, ".agents", "skills", "spec-only", "SKILL.md")),
    ).toContain("Spec body.");
    expect(
      await readFileContent(join(testDir, ".agents", "skills", "replit-only", "SKILL.md")),
    ).toContain("Replit body.");

    // A second run must be a no-op: the delete/rewrite churn a per-target sweep
    // causes is what makes `--check` report a permanently out-of-date tree.
    await expect(
      runGenerate({
        target: "agentsskills,replit",
        features: "skills",
        deleteFiles: true,
        check: true,
        env: { NODE_ENV: "e2e" },
      }),
    ).resolves.toMatchObject({ stdout: expect.stringContaining("All files are up to date") });
  });

  it("should still delete a genuine orphan from the shared .agents/skills root", async () => {
    const testDir = getTestDir();
    const orphanPath = join(testDir, ".agents", "skills", "left-over", "SKILL.md");
    await writeFileContent(
      join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "review", "SKILL.md"),
      ["---", "name: review", 'description: "Review"', "---", "Review body."].join("\n"),
    );
    await writeFileContent(
      orphanPath,
      ["---", "name: left-over", 'description: "Left over"', "---", "Left over body."].join("\n"),
    );

    await runGenerate({
      target: "agentsskills",
      features: "skills",
      deleteFiles: true,
    });

    expect(await fileExists(orphanPath)).toBe(false);
  });

  it("should not delete the takt facet root when the run generates no takt skill", async () => {
    // takt skills are flat files under one shared root, so every candidate the
    // orphan sweep enumerates reports that root as its path. With no takt skill
    // to claim it, the sweep used to delete the root itself and everything the
    // user had put there by hand.
    const testDir = getTestDir();
    const handAuthoredPath = join(testDir, ".takt", "facets", "knowledge", "my-notes", "notes.md");
    await writeFileContent(join(testDir, ".rulesync", ".gitkeep"), "");
    await writeFileContent(handAuthoredPath, "Hand-authored notes.");

    await runGenerate({
      target: "takt",
      features: "skills",
      deleteFiles: true,
    });

    expect(await readFileContent(handAuthoredPath)).toContain("Hand-authored notes.");
  });

  it("should keep a hand-authored takt facet file when a takt skill is generated", async () => {
    // The companion case: once the root is claimed the sweep never reached it,
    // so this has always worked. Pinning it keeps the two halves of the guard
    // from drifting apart — the fix must not start sweeping the root when a
    // skill *is* generated either.
    const testDir = getTestDir();
    const handAuthoredPath = join(testDir, ".takt", "facets", "knowledge", "my-notes", "notes.md");
    await writeFileContent(handAuthoredPath, "Hand-authored notes.");
    await writeFileContent(
      join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "review", "SKILL.md"),
      ["---", "name: review", 'description: "Review"', "---", "Review body."].join("\n"),
    );

    await runGenerate({
      target: "takt",
      features: "skills",
      deleteFiles: true,
    });

    expect(await readFileContent(handAuthoredPath)).toContain("Hand-authored notes.");
    expect(
      await readFileContent(join(testDir, ".takt", "facets", "knowledge", "review.md")),
    ).toContain("Review body.");
  });

  it("should sweep a takt knowledge file whose skill source is gone", async () => {
    // Regression test for #2785. The flat files under the shared root are
    // swept by name, since there is no per-skill directory to remove: renaming
    // a skill used to leave its old knowledge file behind for good, and
    // deleting a skill never revoked it from takt.
    const testDir = getTestDir();
    const stalePath = join(testDir, ".takt", "facets", "knowledge", "runbook.md");
    const nestedPath = join(testDir, ".takt", "facets", "knowledge", "my-notes", "notes.md");
    // A hand-authored file directly in the root, under a name takt could never
    // have written. Deliberate: one that *does* look generated is swept, which
    // is why the docs tell users to keep notes in a subdirectory.
    const keptByPolicyPath = join(testDir, ".takt", "facets", "knowledge", "Design Doc.md");
    await writeFileContent(stalePath, "Stale runbook.");
    await writeFileContent(nestedPath, "Hand-authored notes.");
    await writeFileContent(keptByPolicyPath, "Hand-authored design doc.");
    await writeFileContent(
      join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "review", "SKILL.md"),
      ["---", "name: review", 'description: "Review"', "---", "Review body."].join("\n"),
    );

    await runGenerate({
      target: "takt",
      features: "skills",
      deleteFiles: true,
    });

    expect(await fileExists(stalePath)).toBe(false);
    // Only the flat files takt itself could have written are the skills
    // feature's to sweep.
    expect(await readFileContent(nestedPath)).toContain("Hand-authored notes.");
    expect(await readFileContent(keptByPolicyPath)).toContain("Hand-authored design doc.");
    expect(
      await readFileContent(join(testDir, ".takt", "facets", "knowledge", "review.md")),
    ).toContain("Review body.");
  });

  it("should leave the takt knowledge root alone when no skill targets takt", async () => {
    // The root has no source behind it, so rulesync does not manage it: a
    // takt user who keeps their own notes there and runs `--delete` for an
    // unrelated tool's skills must not lose them.
    const testDir = getTestDir();
    const handAuthoredPath = join(testDir, ".takt", "facets", "knowledge", "architecture.md");
    await writeFileContent(handAuthoredPath, "Hand-authored architecture notes.");
    await writeFileContent(
      join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "review", "SKILL.md"),
      [
        "---",
        "name: review",
        'description: "Review"',
        "targets:",
        "  - claudecode",
        "---",
        "Review body.",
      ].join("\n"),
    );

    await runGenerate({
      target: "takt",
      features: "skills",
      deleteFiles: true,
    });

    expect(await readFileContent(handAuthoredPath)).toContain("Hand-authored architecture notes.");
  });

  it("should reject a symlinked Kimi managed skills root during deletion", async () => {
    const testDir = getTestDir();
    const protectedDir = join(testDir, "protected-skills");
    const protectedFile = join(protectedDir, "protected", "SKILL.md");
    const managedRoot = join(testDir, ".kimi-code", "skills");
    await writeFileContent(join(testDir, ".rulesync", ".gitkeep"), "");
    await writeFileContent(
      protectedFile,
      ["---", "name: protected", 'description: "Protected skill"', "---", "Keep me."].join("\n"),
    );
    await ensureDir(join(testDir, ".kimi-code"));
    await symlink(protectedDir, managedRoot, process.platform === "win32" ? "junction" : "dir");

    await expect(
      runGenerate({
        target: "kimi-code",
        features: "skills",
        deleteFiles: true,
      }),
    ).rejects.toThrow();
    expect(await readFileContent(protectedFile)).toContain("Keep me.");
  });
});

// Skills written under the pseudo-home dir.
const skillsGlobalTargets = [
  {
    target: "augmentcode",
    outputPath: join(".augment", "skills", "test-skill", "SKILL.md"),
  },
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
    outputPath: join(".config", "opencode", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "agentsskills",
    outputPath: join(".agents", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "amp",
    outputPath: join(".config", "agents", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "deepagents",
    outputPath: join(".deepagents", "deepagents", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "codexcli",
    outputPath: join(".agents", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "musecode",
    outputPath: join(".config", "muse", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "copilot",
    outputPath: join(".copilot", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "copilotcli",
    outputPath: join(".copilot", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "grokcli",
    outputPath: join(".grok", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "qwencode",
    outputPath: join(".qwen", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "junie",
    outputPath: join(".junie", "skills", "test-skill", "SKILL.md"),
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
    target: "kimi-code",
    outputPath: join(".kimi-code", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "roo",
    outputPath: join(".roo", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "zoocode",
    outputPath: join(".roo", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "rovodev",
    outputPath: join(".rovodev", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "devin",
    outputPath: join(".config", "devin", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "warp",
    outputPath: join(".warp", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "antigravity-ide",
    outputPath: join(".gemini", "config", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "antigravity-cli",
    outputPath: join(".gemini", "antigravity-cli", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "takt",
    outputPath: join(".takt", "facets", "knowledge", "test-skill.md"),
  },
  {
    target: "pi",
    outputPath: join(".pi", "agent", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "replit",
    outputPath: join(".agents", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "zed",
    outputPath: join(".agents", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "factorydroid",
    outputPath: join(".factory", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "vibe",
    outputPath: join(".vibe", "skills", "test-skill", "SKILL.md"),
  },
  {
    // Hermes Agent reads skills from ~/.hermes/skills/ (global only).
    target: "hermesagent",
    outputPath: join(getHermesagentGlobalDir(), "skills", "test-skill", "SKILL.md"),
  },
  {
    // Kiro reads global skills from ~/.kiro/skills/.
    target: "kiro-cli",
    outputPath: join(".kiro", "skills", "test-skill", "SKILL.md"),
  },
  {
    target: "kiro-ide",
    outputPath: join(".kiro", "skills", "test-skill", "SKILL.md"),
  },
  {
    // Reasonix reads global skills from ~/.reasonix/skills/.
    target: "reasonix",
    outputPath: join(".reasonix", "skills", "test-skill", "SKILL.md"),
  },
] as const;

describe("E2E: skills (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it("global matrix must cover every native global skills tool target", () => {
    assertGenerateMatrixCoversTargets({
      processor: SkillsProcessor,
      testedTargets: skillsGlobalTargets.map((e) => e.target),
      global: true,
    });
  });

  it("should import Hermes skill metadata into a target override", async () => {
    const homeDir = getHomeDir();
    await writeFileContent(
      join(homeDir, getHermesagentGlobalDir(), "skills", "test-skill", "SKILL.md"),
      [
        "---",
        "name: test-skill",
        "description: Hermes metadata E2E",
        "version: 2.0.0",
        "author:",
        "  name: Rulesync",
        "platforms: [darwin]",
        "required_environment_variables: [API_TOKEN]",
        "metadata:",
        "  hermes:",
        "    config:",
        "      mode: strict",
        "---",
        "Skill body.",
        "",
      ].join("\n"),
    );

    await runImport({
      target: "hermesagent",
      features: "skills",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const imported = await readFileContent(
      join(homeDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "test-skill", "SKILL.md"),
    );
    expect(imported).toContain("hermesagent:");
    expect(imported).toContain("version: 2.0.0");
    expect(imported).toContain("required_environment_variables:");
    expect(imported).toContain("mode: strict");
  });

  it.each(skillsGlobalTargets)(
    "should generate $target skills in home directory",
    async ({ target, outputPath }) => {
      const projectDir = getProjectDir();
      const homeDir = getHomeDir();

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

      await runGenerate({
        target,
        features: "skills",
        global: true,
        env: { HOME_DIR: homeDir },
      });

      const generatedContent = await readFileContent(join(homeDir, outputPath));
      expect(generatedContent).toContain("test skill body content");
    },
  );

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

  it("should import Kimi flat skills from the shared global root", async () => {
    const homeDir = getHomeDir();

    await writeFileContent(
      join(homeDir, ".agents", "skills", "global-review.md"),
      ["---", 'description: "Reviews changes globally"', "---", "Global flat skill body."].join(
        "\n",
      ),
    );

    await runImport({
      target: "kimi-code",
      features: "skills",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const imported = await readFileContent(
      join(homeDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "global-review", "SKILL.md"),
    );
    expect(imported).toContain("name: global-review");
    expect(imported).toContain("Global flat skill body");
  });
});

describe("E2E: skills (claudecode scheduled-task)", () => {
  const { getTestDir } = useTestDirectory();

  it("should route claudecode scheduled-task skills to .claude/scheduled-tasks/", async () => {
    const testDir = getTestDir();

    const skillContent = `---
name: weekly-review
description: "A scheduled-task skill for E2E testing"
targets: ["*"]
claudecode:
  scheduled-task: true
---
This is the scheduled task body content.
`;
    await writeFileContent(
      join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "weekly-review", "SKILL.md"),
      skillContent,
    );

    await runGenerate({ target: "claudecode", features: "skills" });

    const generatedContent = await readFileContent(
      join(testDir, ".claude", "scheduled-tasks", "weekly-review", "SKILL.md"),
    );
    expect(generatedContent).toContain("scheduled task body content");

    expect(await fileExists(join(testDir, ".claude", "skills", "weekly-review", "SKILL.md"))).toBe(
      false,
    );
  });

  it.each([
    {
      target: "cursor",
      excludedPath: join(".cursor", "skills", "weekly-review", "SKILL.md"),
    },
    {
      target: "copilot",
      excludedPath: join(".github", "skills", "weekly-review", "SKILL.md"),
    },
  ])(
    "should not emit claudecode scheduled-task skills to $target even with targets: ['*']",
    async ({ target, excludedPath }) => {
      const testDir = getTestDir();

      const skillContent = `---
name: weekly-review
description: "A scheduled-task skill for E2E testing"
targets: ["*"]
claudecode:
  scheduled-task: true
---
This is the scheduled task body content.
`;
      await writeFileContent(
        join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "weekly-review", "SKILL.md"),
        skillContent,
      );

      await runGenerate({ target, features: "skills" });

      expect(await fileExists(join(testDir, excludedPath))).toBe(false);
    },
  );

  it("should import claudecode skills from .claude/scheduled-tasks/ with scheduled-task flag", async () => {
    const testDir = getTestDir();

    const skillContent = `---
name: weekly-review
description: "A scheduled-task skill for E2E testing"
---
This is the scheduled task body content.`;
    await writeFileContent(
      join(testDir, ".claude", "scheduled-tasks", "weekly-review", "SKILL.md"),
      skillContent,
    );

    await runImport({ target: "claudecode", features: "skills" });

    const importedContent = await readFileContent(
      join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "weekly-review", "SKILL.md"),
    );
    expect(importedContent).toContain("scheduled task body content");
    expect(importedContent).toContain("scheduled-task: true");
  });
});

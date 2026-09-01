import { symlink } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { SubagentsProcessor } from "../features/subagents/subagents-processor.js";
import { ensureDir, fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { getHermesagentGlobalDir } from "../utils/hermesagent.js";
import {
  assertGenerateMatrixCoversTargets,
  runGenerate,
  runImport,
  useGlobalTestDirectories,
  useTestDirectory,
} from "./e2e-helper.js";

const subagentsGenerateTargets = [
  {
    target: "antigravity-cli",
    outputPath: join(".agents", "agents", "planner.md"),
  },
  {
    target: "antigravity-ide",
    outputPath: join(".agents", "agents", "planner.md"),
  },
  {
    target: "antigravity-plugin",
    outputPath: join("agents", "planner.md"),
  },
  {
    target: "augmentcode",
    outputPath: join(".augment", "agents", "planner.md"),
  },
  {
    target: "claudecode",
    outputPath: join(".claude", "agents", "planner.md"),
  },
  {
    target: "claudecode-plugin",
    outputPath: join("agents", "planner.md"),
  },
  {
    target: "cursor",
    outputPath: join(".cursor", "agents", "planner.md"),
  },
  {
    target: "grokcli",
    outputPath: join(".grok", "agents", "planner.md"),
  },
  {
    target: "qwencode",
    outputPath: join(".qwen", "agents", "planner.md"),
  },
  {
    target: "codexcli",
    outputPath: join(".codex", "agents", "planner.toml"),
  },
  {
    target: "copilot",
    outputPath: join(".github", "agents", "planner.agent.md"),
  },
  {
    target: "copilotcli",
    outputPath: join(".github", "agents", "planner.agent.md"),
  },
  {
    target: "deepagents",
    outputPath: join(".deepagents", "agents", "planner", "AGENTS.md"),
  },
  {
    target: "devin",
    outputPath: join(".devin", "agents", "planner", "AGENT.md"),
  },
  {
    target: "kiro",
    outputPath: join(".kiro", "agents", "planner.json"),
  },
  {
    target: "kiro-cli",
    outputPath: join(".kiro", "agents", "planner.json"),
  },
  {
    target: "kiro-ide",
    outputPath: join(".kiro", "agents", "planner.md"),
  },
  {
    target: "kilo",
    outputPath: join(".kilo", "agents", "planner.md"),
  },
  {
    target: "kimi-code",
    outputPath: join(".kimi-code", "agents", "planner.md"),
  },
  {
    target: "opencode",
    outputPath: join(".opencode", "agents", "planner.md"),
  },
  {
    target: "rovodev",
    outputPath: join(".rovodev", "subagents", "planner.md"),
  },
  {
    target: "junie",
    outputPath: join(".junie", "agents", "planner.md"),
  },
  {
    target: "takt",
    outputPath: join(".takt", "facets", "personas", "planner.md"),
  },
  {
    target: "factorydroid",
    outputPath: join(".factory", "droids", "planner.md"),
  },
  {
    target: "cline",
    outputPath: join(".cline", "agents", "planner.yaml"),
  },
  {
    target: "vibe",
    outputPath: join(".vibe", "agents", "planner.toml"),
  },
  {
    target: "goose",
    outputPath: join(".goose", "agents", "planner.md"),
  },
  {
    target: "reasonix",
    outputPath: join(".reasonix", "skills", "planner", "SKILL.md"),
  },
  {
    target: "roo",
    outputPath: ".roomodes",
  },
  {
    target: "zoocode",
    outputPath: ".roomodes",
  },
  {
    target: "hermesagent",
    outputPath: join(".hermes", "rulesync", "subagents", "planner.json"),
  },
] as const;

const subagentsGlobalTargets = [
  { target: "antigravity-cli", outputPath: join(".gemini", "config", "agents", "planner.md") },
  { target: "antigravity-ide", outputPath: join(".gemini", "config", "agents", "planner.md") },
  { target: "augmentcode", outputPath: join(".augment", "agents", "planner.md") },
  { target: "claudecode", outputPath: join(".claude", "agents", "planner.md") },
  { target: "codexcli", outputPath: join(".codex", "agents", "planner.toml") },
  { target: "copilot", outputPath: join(".copilot", "agents", "planner.agent.md") },
  { target: "copilotcli", outputPath: join(".copilot", "agents", "planner.agent.md") },
  { target: "cursor", outputPath: join(".cursor", "agents", "planner.md") },
  { target: "grokcli", outputPath: join(".grok", "agents", "planner.md") },
  { target: "qwencode", outputPath: join(".qwen", "agents", "planner.md") },
  { target: "junie", outputPath: join(".junie", "agents", "planner.md") },
  { target: "kiro-cli", outputPath: join(".kiro", "agents", "planner.json") },
  { target: "kiro-ide", outputPath: join(".kiro", "agents", "planner.md") },
  { target: "kilo", outputPath: join(".config", "kilo", "agents", "planner.md") },
  { target: "kimi-code", outputPath: join(".kimi-code", "agents", "planner.md") },
  { target: "opencode", outputPath: join(".config", "opencode", "agents", "planner.md") },
  { target: "rovodev", outputPath: join(".rovodev", "subagents", "planner.md") },
  { target: "takt", outputPath: join(".takt", "facets", "personas", "planner.md") },
  { target: "factorydroid", outputPath: join(".factory", "droids", "planner.md") },
  { target: "cline", outputPath: join(".cline", "agents", "planner.yaml") },
  {
    target: "deepagents",
    outputPath: join(".deepagents", "agent", "agents", "planner", "AGENTS.md"),
  },
  {
    target: "devin",
    outputPath: join(".config", "devin", "agents", "planner", "AGENT.md"),
  },
  { target: "vibe", outputPath: join(".vibe", "agents", "planner.toml") },
  {
    target: "goose",
    outputPath: join(".config", "goose", "agents", "planner.md"),
  },
  {
    target: "reasonix",
    outputPath: join(".reasonix", "skills", "planner", "SKILL.md"),
  },
  {
    target: "hermesagent",
    outputPath: join(getHermesagentGlobalDir(), "rulesync", "subagents", "planner.json"),
  },
  { target: "zcode", outputPath: join(".zcode", "agents", "planner.md") },
] as const;

describe("E2E: subagents", () => {
  const { getTestDir } = useTestDirectory();

  it("generate matrix must cover every native subagents tool target", () => {
    assertGenerateMatrixCoversTargets({
      processor: SubagentsProcessor,
      testedTargets: subagentsGenerateTargets.map((e) => e.target),
    });
  });

  it.each(subagentsGenerateTargets)(
    "should generate $target subagents",
    async ({ target, outputPath }) => {
      const testDir = getTestDir();

      const subagentContent = `---
name: planner
targets: ["*"]
description: "Plans implementation tasks"
---
You are the planner. Analyze files and create a plan.
`;
      await writeFileContent(
        join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
        subagentContent,
      );

      const homeDir = join(testDir, "home");
      await runGenerate({
        target,
        features: "subagents",
        env: { HOME_DIR: homeDir },
      });

      const generatedContent = await readFileContent(join(testDir, outputPath));
      expect(generatedContent).toContain("planner");
      if (target === "vibe") {
        // Vibe ignores `system_prompt`; the body rides `.vibe/prompts/<id>.md`
        // referenced by `system_prompt_id` (issue #2423).
        expect(generatedContent).toContain('system_prompt_id = "planner"');
        expect(await readFileContent(join(testDir, ".vibe", "prompts", "planner.md"))).toContain(
          "Analyze files and create a plan.",
        );
      } else {
        expect(generatedContent).toContain("Analyze files and create a plan.");
      }

      if (target === "hermesagent") {
        expect(
          await readFileContent(join(homeDir, getHermesagentGlobalDir(), "config.yaml")),
        ).toContain("rulesync-subagents");
        expect(await fileExists(join(homeDir, getHermesagentGlobalDir(), ".env"))).toBe(false);
        expect(
          await readFileContent(
            join(testDir, ".hermes", "plugins", "rulesync-subagents", "__init__.py"),
          ),
        ).toContain('Path(__file__).resolve().parents[2] / "rulesync" / "subagents"');
      }
    },
  );

  it.each([{ target: "agentsmd", outputPath: join(".agents", "agents", "planner.md") }])(
    "should generate $target simulated subagents",
    async ({ target, outputPath }) => {
      const testDir = getTestDir();

      const subagentContent = `---
name: planner
targets: ["*"]
description: "Plans implementation tasks"
---
You are the planner. Analyze files and create a plan.
`;
      await writeFileContent(
        join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
        subagentContent,
      );

      await runGenerate({ target, features: "subagents", simulateSubagents: true });

      const generatedContent = await readFileContent(join(testDir, outputPath));
      expect(generatedContent).toContain("planner");
      expect(generatedContent).toContain("Analyze files and create a plan.");
    },
  );

  it("should preserve opencode.mode when generating OpenCode subagents", async () => {
    const testDir = getTestDir();

    // Setup: Create a subagent with opencode.mode: primary
    const subagentContent = `---
name: primary-agent
targets: ["*"]
description: "A primary mode agent"
opencode:
  mode: primary
  hidden: false
  tools:
    bash: true
    edit: true
---
You are a primary agent. You appear in the Tab rotation.
`;
    await writeFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "primary-agent.md"),
      subagentContent,
    );

    await runGenerate({ target: "opencode", features: "subagents" });

    // Verify that the mode is preserved as primary, not defaulting to subagent
    const generatedContent = await readFileContent(
      join(testDir, ".opencode", "agents", "primary-agent.md"),
    );
    expect(generatedContent).toContain("mode: primary");
    expect(generatedContent).not.toContain("mode: subagent");
    expect(generatedContent).toContain("A primary mode agent");
  });

  it("should default kilo.mode to 'all' when omitted in source", async () => {
    const testDir = getTestDir();

    // Kilo's documented default for user-defined agents is `all`
    // (https://kilo.ai/docs/customize/custom-modes). Rulesync must
    // emit `mode: all` when source frontmatter has no `kilo.mode`,
    // otherwise generated agents are hidden from Kilo's agent picker.
    const subagentContent = `---
name: planner
targets: ["*"]
description: "Plans implementation tasks"
---
You are the planner. Analyze files and create a plan.
`;
    await writeFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
      subagentContent,
    );

    await runGenerate({ target: "kilo", features: "subagents" });

    const generatedContent = await readFileContent(join(testDir, ".kilo", "agents", "planner.md"));
    expect(generatedContent).toContain("mode: all");
    expect(generatedContent).not.toContain("mode: subagent");
    expect(generatedContent).toContain("Analyze files and create a plan.");
  });

  it("should preserve explicit kilo.mode: subagent override", async () => {
    const testDir = getTestDir();

    // Users who want the previous (hidden) behavior can opt back in by
    // explicitly setting `kilo.mode: subagent` in source frontmatter.
    const subagentContent = `---
name: hidden-helper
targets: ["*"]
description: "A subagent-only helper"
kilo:
  mode: subagent
---
You are a subagent-only helper.
`;
    await writeFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "hidden-helper.md"),
      subagentContent,
    );

    await runGenerate({ target: "kilo", features: "subagents" });

    const generatedContent = await readFileContent(
      join(testDir, ".kilo", "agents", "hidden-helper.md"),
    );
    expect(generatedContent).toContain("mode: subagent");
    expect(generatedContent).not.toContain("mode: all");
  });

  it.each([
    { target: "claudecode", orphanPath: join(".claude", "agents", "orphan.md") },
    { target: "cursor", orphanPath: join(".cursor", "agents", "orphan.md") },
    { target: "grokcli", orphanPath: join(".grok", "agents", "orphan.md") },
    { target: "codexcli", orphanPath: join(".codex", "agents", "orphan.toml") },
    { target: "copilot", orphanPath: join(".github", "agents", "orphan.md") },
    { target: "deepagents", orphanPath: join(".deepagents", "agents", "orphan", "AGENTS.md") },
    { target: "devin", orphanPath: join(".devin", "agents", "orphan", "AGENT.md") },
    { target: "kiro", orphanPath: join(".kiro", "agents", "orphan.json") },
    { target: "kiro-cli", orphanPath: join(".kiro", "agents", "orphan.json") },
    { target: "kiro-ide", orphanPath: join(".kiro", "agents", "orphan.md") },
    { target: "junie", orphanPath: join(".junie", "agents", "orphan.md") },
    { target: "factorydroid", orphanPath: join(".factory", "droids", "orphan.md") },
    { target: "cline", orphanPath: join(".cline", "agents", "orphan.yaml") },
    { target: "vibe", orphanPath: join(".vibe", "agents", "orphan.toml") },
    { target: "goose", orphanPath: join(".goose", "agents", "orphan.md") },
  ])(
    "should fail in check mode when delete would remove an orphan $target subagent file",
    async ({ target, orphanPath }) => {
      const testDir = getTestDir();

      await writeFileContent(join(testDir, ".rulesync", ".gitkeep"), "");
      await writeFileContent(join(testDir, orphanPath), "# orphan\n");

      await expect(
        runGenerate({
          target,
          features: "subagents",
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

describe("E2E: subagents (import)", () => {
  const { getTestDir } = useTestDirectory();

  it("should import Hermes project subagents into the RuleSync source directory", async () => {
    const testDir = getTestDir();
    await writeFileContent(
      join(testDir, ".hermes", "rulesync", "subagents", "planner.json"),
      JSON.stringify({
        slug: "planner",
        name: "Planner",
        description: "Plans implementation tasks",
        prompt: "Break down tasks into steps.",
      }),
    );

    await runImport({ target: "hermesagent", features: "subagents" });

    const importedContent = await readFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
    );
    expect(importedContent).toContain("Planner");
    expect(importedContent).toContain("Break down tasks into steps.");
  });

  it.each([
    { target: "claudecode", sourcePath: join(".claude", "agents", "planner.md") },
    { target: "antigravity-cli", sourcePath: join(".agents", "agents", "planner.md") },
    { target: "antigravity-ide", sourcePath: join(".agents", "agents", "planner.md") },
    { target: "cursor", sourcePath: join(".cursor", "agents", "planner.md") },
    { target: "copilot", sourcePath: join(".github", "agents", "planner.md") },
    { target: "kimi-code", sourcePath: join(".kimi-code", "agents", "planner.md") },
    { target: "opencode", sourcePath: join(".opencode", "agents", "planner.md") },
    { target: "deepagents", sourcePath: join(".deepagents", "agents", "planner", "AGENTS.md") },
    { target: "junie", sourcePath: join(".junie", "agents", "planner.md") },
    { target: "factorydroid", sourcePath: join(".factory", "droids", "planner.md") },
    { target: "cline", sourcePath: join(".cline", "agents", "planner.yaml") },
    { target: "devin", sourcePath: join(".devin", "agents", "planner", "AGENT.md") },
  ])("should import $target subagents", async ({ target, sourcePath }) => {
    const testDir = getTestDir();

    const subagentContent = `---
name: planner
description: "Plans implementation tasks"
roleDefinition: You are the planner. Analyze files and create a plan.
---
# Instructions
Break down tasks into steps.
`;
    await writeFileContent(join(testDir, sourcePath), subagentContent);

    await runImport({ target, features: "subagents" });

    const importedContent = await readFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
    );
    expect(importedContent).toContain("planner");
  });

  it("should import junie subagents from the shared .agents directory", async () => {
    const testDir = getTestDir();

    const subagentContent = `---
name: planner
description: "Plans implementation tasks"
---
# Instructions
Break down tasks into steps.
`;
    // Junie also discovers subagents from the cross-tool `.agents/` directory,
    // not just `.junie/agents/`.
    await writeFileContent(join(testDir, ".agents", "planner.md"), subagentContent);

    await runImport({ target: "junie", features: "subagents" });

    const importedContent = await readFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
    );
    expect(importedContent).toContain("planner");
  });

  it("should recursively import Kimi Code subagents and flatten them by agent name", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".kimi-code", "agents", "review", "security.md"),
      [
        "---",
        "name: security-reviewer",
        'description: "Reviews security-sensitive changes"',
        "---",
        "Review the change for security issues.",
      ].join("\n"),
    );
    await writeFileContent(
      join(testDir, ".kimi-code", "agents", "audit", "security.md"),
      [
        "---",
        "name: security-auditor",
        'description: "Audits security controls"',
        "---",
        "Audit the configured security controls.",
      ].join("\n"),
    );
    await writeFileContent(
      join(testDir, ".kimi-code", "agents", "z-duplicate", "reviewer.md"),
      [
        "---",
        "name: security-reviewer",
        'description: "Duplicate reviewer"',
        "---",
        "This duplicate must not overwrite the first reviewer.",
      ].join("\n"),
    );

    await runImport({ target: "kimi-code", features: "subagents" });

    const reviewer = await readFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "security-reviewer.md"),
    );
    expect(reviewer).toContain("Review the change");
    expect(reviewer).not.toContain("duplicate must not overwrite");
    expect(
      await readFileContent(
        join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "security-auditor.md"),
      ),
    ).toContain("Audit the configured");
  });

  it("should import Kimi Code subagents from the shared .agents root", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".agents", "agents", "shared-reviewer.md"),
      [
        "---",
        "name: shared-reviewer",
        'description: "Reviews from the shared root"',
        "---",
        "Review changes from the shared agent root.",
      ].join("\n"),
    );

    await runImport({ target: "kimi-code", features: "subagents" });

    expect(
      await readFileContent(
        join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "shared-reviewer.md"),
      ),
    ).toContain("shared agent root");
  });

  it("should preserve distinct Kimi subagents with the same relative path", async () => {
    const testDir = getTestDir();
    await writeFileContent(
      join(testDir, ".kimi-code", "agents", "team", "reviewer.md"),
      [
        "---",
        "name: primary-reviewer",
        'description: "Primary reviewer"',
        "---",
        "Primary reviewer body.",
      ].join("\n"),
    );
    await writeFileContent(
      join(testDir, ".agents", "agents", "team", "reviewer.md"),
      [
        "---",
        "name: shared-reviewer",
        'description: "Shared reviewer"',
        "---",
        "Shared reviewer body.",
      ].join("\n"),
    );

    await runImport({ target: "kimi-code", features: "subagents" });

    expect(
      await readFileContent(
        join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "primary-reviewer.md"),
      ),
    ).toContain("Primary reviewer body");
    expect(
      await readFileContent(
        join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "shared-reviewer.md"),
      ),
    ).toContain("Shared reviewer body");
  });

  it("should not delete Kimi Code subagents from the shared .agents root", async () => {
    const testDir = getTestDir();
    const sharedAgentPath = join(testDir, ".agents", "agents", "shared-reviewer.md");
    await writeFileContent(join(testDir, ".rulesync", ".gitkeep"), "");
    await writeFileContent(
      sharedAgentPath,
      [
        "---",
        "name: shared-reviewer",
        'description: "Shared reviewer"',
        "---",
        "User-owned shared reviewer.",
      ].join("\n"),
    );

    await runGenerate({
      target: "kimi-code",
      features: "subagents",
      deleteFiles: true,
    });

    expect(await readFileContent(sharedAgentPath)).toContain("User-owned shared reviewer");
  });

  it("should keep both targets' subagents when they share the .agents/agents root", async () => {
    // `antigravity-ide` and `antigravity-cli` write into one directory, so a
    // per-target orphan sweep sees the sibling's freshly written file as a
    // leftover and deletes it.
    const testDir = getTestDir();
    await writeFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "cli-only.md"),
      [
        "---",
        'targets: ["antigravity-cli"]',
        "name: cli-only",
        'description: "CLI only agent"',
        "---",
        "CLI body.",
      ].join("\n"),
    );
    await writeFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "ide-only.md"),
      [
        "---",
        'targets: ["antigravity-ide"]',
        "name: ide-only",
        'description: "IDE only agent"',
        "---",
        "IDE body.",
      ].join("\n"),
    );

    await runGenerate({
      target: "antigravity-ide,antigravity-cli",
      features: "subagents",
      deleteFiles: true,
    });

    expect(await readFileContent(join(testDir, ".agents", "agents", "cli-only.md"))).toContain(
      "CLI body.",
    );
    expect(await readFileContent(join(testDir, ".agents", "agents", "ide-only.md"))).toContain(
      "IDE body.",
    );

    // A second run must be a no-op: the delete/rewrite churn a per-target sweep
    // causes is what makes `--check` report a permanently out-of-date tree.
    await expect(
      runGenerate({
        target: "antigravity-ide,antigravity-cli",
        features: "subagents",
        deleteFiles: true,
        check: true,
        env: { NODE_ENV: "e2e" },
      }),
    ).resolves.toMatchObject({ stdout: expect.stringContaining("All files are up to date") });
  });

  it("should still delete a genuine orphan from the shared .agents/agents root", async () => {
    const testDir = getTestDir();
    const orphanPath = join(testDir, ".agents", "agents", "left-over.md");
    await writeFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "reviewer.md"),
      [
        "---",
        'targets: ["antigravity-cli"]',
        "name: reviewer",
        'description: "Reviewer"',
        "---",
        "Reviewer body.",
      ].join("\n"),
    );
    await writeFileContent(
      orphanPath,
      ["---", "name: left-over", 'description: "Left over"', "---", "Left over body."].join("\n"),
    );

    await runGenerate({
      target: "antigravity-cli",
      features: "subagents",
      deleteFiles: true,
    });

    expect(await fileExists(orphanPath)).toBe(false);
  });

  it("should not follow directory symlinks while deleting Kimi Code subagents", async () => {
    const testDir = getTestDir();
    const protectedDir = join(testDir, "protected-agents");
    const protectedFile = join(protectedDir, "notes.md");
    const linkedDir = join(testDir, ".kimi-code", "agents", "external");
    await writeFileContent(join(testDir, ".rulesync", ".gitkeep"), "");
    await writeFileContent(protectedFile, "Protected notes.\n");
    await ensureDir(join(testDir, ".kimi-code", "agents"));
    await symlink(protectedDir, linkedDir, process.platform === "win32" ? "junction" : "dir");

    await runGenerate({
      target: "kimi-code",
      features: "subagents",
      deleteFiles: true,
    });

    expect(await readFileContent(protectedFile)).toBe("Protected notes.\n");
  });

  it("should import goose subagents (custom-agent Markdown)", async () => {
    const testDir = getTestDir();

    const agentContent = [
      "---",
      "name: planner",
      "description: Plans tasks",
      "---",
      "",
      "Break down tasks into steps.",
    ].join("\n");
    await writeFileContent(join(testDir, ".goose", "agents", "planner.md"), agentContent);

    await runImport({ target: "goose", features: "subagents" });

    const importedContent = await readFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
    );
    expect(importedContent).toContain("planner");
  });

  it("should import kiro subagents (JSON format)", async () => {
    const testDir = getTestDir();

    const subagentContent = JSON.stringify(
      { description: "Plans tasks", prompt: "Break down tasks into steps." },
      null,
      2,
    );
    await writeFileContent(join(testDir, ".kiro", "agents", "planner.json"), subagentContent);

    await runImport({ target: "kiro", features: "subagents" });

    const importedContent = await readFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
    );
    expect(importedContent).toContain("planner");
    expect(importedContent).toContain("kiro");
  });

  it("should import kiro-cli subagents (JSON format)", async () => {
    const testDir = getTestDir();

    const subagentContent = JSON.stringify(
      { description: "Plans tasks", prompt: "Break down tasks into steps." },
      null,
      2,
    );
    await writeFileContent(join(testDir, ".kiro", "agents", "planner.json"), subagentContent);

    await runImport({ target: "kiro-cli", features: "subagents" });

    const importedContent = await readFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
    );
    expect(importedContent).toContain("planner");
    expect(importedContent).toContain("kiro-cli");
  });

  it("should import kiro-ide subagents (Markdown format)", async () => {
    const testDir = getTestDir();

    const subagentContent = `---
name: planner
description: "Plans implementation tasks"
---
Break down tasks into steps.
`;
    await writeFileContent(join(testDir, ".kiro", "agents", "planner.md"), subagentContent);

    await runImport({ target: "kiro-ide", features: "subagents" });

    const importedContent = await readFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
    );
    expect(importedContent).toContain("planner");
  });

  it("should import vibe subagents from TOML", async () => {
    const testDir = getTestDir();

    const subagentContent = [
      'agent_type = "agent"',
      'display_name = "Planner"',
      'description = "Plans implementation tasks"',
      'system_prompt = "Break down tasks into steps."',
    ].join("\n");
    await writeFileContent(join(testDir, ".vibe", "agents", "planner.toml"), subagentContent);

    await runImport({ target: "vibe", features: "subagents" });

    const importedContent = await readFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
    );
    expect(importedContent).toContain("Planner");
    // The legacy `system_prompt` key is still read back.
    expect(importedContent).toContain("Break down tasks into steps.");
  });

  it("should import a vibe subagent whose prompt lives in .vibe/prompts (issue #2423)", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".vibe", "agents", "planner.toml"),
      [
        'agent_type = "agent"',
        'display_name = "Planner"',
        'description = "Plans implementation tasks"',
        'system_prompt_id = "planner"',
      ].join("\n"),
    );
    await writeFileContent(
      join(testDir, ".vibe", "prompts", "planner.md"),
      "Break down tasks into steps.",
    );

    await runImport({ target: "vibe", features: "subagents" });

    const importedContent = await readFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
    );
    expect(importedContent).toContain("Break down tasks into steps.");
  });
});

describe("E2E: subagents (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it("should import Hermes global subagents into the global RuleSync source directory", async () => {
    const homeDir = getHomeDir();
    await writeFileContent(
      join(homeDir, getHermesagentGlobalDir(), "rulesync", "subagents", "planner.json"),
      JSON.stringify({
        slug: "planner",
        name: "Planner",
        description: "Plans implementation tasks",
        prompt: "Break down tasks into steps.",
      }),
    );

    await runImport({
      target: "hermesagent",
      features: "subagents",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const importedContent = await readFileContent(
      join(homeDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
    );
    expect(importedContent).toContain("Planner");
    expect(importedContent).toContain("Break down tasks into steps.");
  });

  it("global matrix must cover every native global subagents tool target", () => {
    assertGenerateMatrixCoversTargets({
      processor: SubagentsProcessor,
      testedTargets: subagentsGlobalTargets.map((e) => e.target),
      global: true,
    });
  });

  it.each(subagentsGlobalTargets)(
    "should generate $target subagents in home directory",
    async ({ target, outputPath }) => {
      const projectDir = getProjectDir();
      const homeDir = getHomeDir();

      const subagentContent = `---
root: true
name: planner
targets: ["*"]
description: "Plans implementation tasks"
---
You are the planner. Analyze files and create a plan.
`;
      await writeFileContent(
        join(projectDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
        subagentContent,
      );

      await runGenerate({
        target,
        features: "subagents",
        global: true,
        env: { HOME_DIR: homeDir },
      });

      const generatedContent = await readFileContent(join(homeDir, outputPath));
      expect(generatedContent).toContain("planner");
      if (target === "vibe") {
        expect(generatedContent).toContain('system_prompt_id = "planner"');
        expect(await readFileContent(join(homeDir, ".vibe", "prompts", "planner.md"))).toContain(
          "Analyze files and create a plan.",
        );
      } else {
        expect(generatedContent).toContain("Analyze files and create a plan.");
      }
    },
  );

  it("should ignore non-root subagents in global mode", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    // Setup: Create a root subagent and a non-root subagent
    const rootSubagentContent = `---
root: true
name: planner
targets: ["*"]
description: "Root subagent"
---
Root subagent body
`;
    const nonRootSubagentContent = `---
name: helper
targets: ["*"]
description: "Non-root subagent"
---
Non-root subagent body
`;
    await writeFileContent(
      join(projectDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
      rootSubagentContent,
    );
    await writeFileContent(
      join(projectDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "helper.md"),
      nonRootSubagentContent,
    );

    // Execute: Generate subagents in global mode
    await runGenerate({
      target: "claudecode",
      features: "subagents",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    // Verify: root subagent content is present, non-root subagent content is absent
    const generatedContent = await readFileContent(
      join(homeDir, ".claude", "agents", "planner.md"),
    );
    expect(generatedContent).toContain("Root subagent body");
    expect(generatedContent).not.toContain("Non-root subagent body");
  });

  it("should import shared global Kimi subagents without overriding Kimi-specific agents", async () => {
    const homeDir = getHomeDir();
    const primaryAgent = [
      "---",
      "name: reviewer",
      'description: "Primary reviewer"',
      "---",
      "Primary Kimi-specific reviewer.",
    ].join("\n");
    const sharedDuplicate = [
      "---",
      "name: reviewer",
      'description: "Shared duplicate reviewer"',
      "---",
      "Lower-precedence shared reviewer.",
    ].join("\n");
    const sharedAgent = [
      "---",
      "name: shared-helper",
      'description: "Shared helper"',
      "---",
      "Shared global helper.",
    ].join("\n");

    await writeFileContent(join(homeDir, ".kimi-code", "agents", "reviewer.md"), primaryAgent);
    await writeFileContent(join(homeDir, ".agents", "agents", "reviewer.md"), sharedDuplicate);
    await writeFileContent(join(homeDir, ".agents", "agents", "shared-helper.md"), sharedAgent);

    await runImport({
      target: "kimi-code",
      features: "subagents",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const reviewer = await readFileContent(
      join(homeDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "reviewer.md"),
    );
    expect(reviewer).toContain("Primary Kimi-specific reviewer");
    expect(reviewer).not.toContain("Lower-precedence shared reviewer");
    expect(
      await readFileContent(
        join(homeDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "shared-helper.md"),
      ),
    ).toContain("Shared global helper");
  });
});

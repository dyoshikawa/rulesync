import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import {
  runGenerate,
  runImport,
  useGlobalTestDirectories,
  useTestDirectory,
} from "./e2e-helper.js";

describe("E2E: subagents", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    {
      target: "claudecode",
      outputPath: join(".claude", "agents", "planner.md"),
    },
    {
      target: "cursor",
      outputPath: join(".cursor", "agents", "planner.md"),
    },
    {
      target: "geminicli",
      outputPath: join(".gemini", "agents", "planner.md"),
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
      outputPath: join(".deepagents", "agents", "planner.md"),
    },
    {
      target: "kiro",
      outputPath: join(".kiro", "agents", "planner.json"),
    },
    {
      target: "junie",
      outputPath: join(".junie", "agents", "planner.md"),
    },
    {
      target: "takt",
      outputPath: join(".takt", "facets", "personas", "planner.md"),
    },
  ])("should generate $target subagents", async ({ target, outputPath }) => {
    const testDir = getTestDir();

    // Setup: Create .rulesync/subagents/planner.md
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

    // Execute: Generate subagents for the target
    await runGenerate({ target, features: "subagents" });

    // Verify that the expected output file was generated
    const generatedContent = await readFileContent(join(testDir, outputPath));
    expect(generatedContent).toContain("planner");
    expect(generatedContent).toContain("Analyze files and create a plan.");
  });

  it.each([
    { target: "agentsmd", outputPath: join(".agents", "subagents", "planner.md") },
    { target: "factorydroid", outputPath: join(".factory", "droids", "planner.md") },
    { target: "roo", outputPath: join(".roo", "subagents", "planner.md") },
  ])("should generate $target simulated subagents", async ({ target, outputPath }) => {
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
  });

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

    // Execute: Generate subagents for opencode
    await runGenerate({ target: "opencode", features: "subagents" });

    // Verify that the mode is preserved as primary, not defaulting to subagent
    const generatedContent = await readFileContent(
      join(testDir, ".opencode", "agent", "primary-agent.md"),
    );
    expect(generatedContent).toContain("mode: primary");
    expect(generatedContent).not.toContain("mode: subagent");
    expect(generatedContent).toContain("A primary mode agent");
  });

  it.each([
    { target: "claudecode", orphanPath: join(".claude", "agents", "orphan.md") },
    { target: "cursor", orphanPath: join(".cursor", "agents", "orphan.md") },
    { target: "geminicli", orphanPath: join(".gemini", "agents", "orphan.md") },
    { target: "codexcli", orphanPath: join(".codex", "agents", "orphan.toml") },
    { target: "copilot", orphanPath: join(".github", "agents", "orphan.md") },
    { target: "deepagents", orphanPath: join(".deepagents", "agents", "orphan.md") },
    { target: "kiro", orphanPath: join(".kiro", "agents", "orphan.json") },
    { target: "junie", orphanPath: join(".junie", "agents", "orphan.md") },
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

  it.each([
    { target: "claudecode", sourcePath: join(".claude", "agents", "planner.md") },
    { target: "cursor", sourcePath: join(".cursor", "agents", "planner.md") },
    { target: "geminicli", sourcePath: join(".gemini", "agents", "planner.md") },
    { target: "copilot", sourcePath: join(".github", "agents", "planner.md") },
    { target: "opencode", sourcePath: join(".opencode", "agent", "planner.md") },
    { target: "deepagents", sourcePath: join(".deepagents", "agents", "planner.md") },
    { target: "junie", sourcePath: join(".junie", "agents", "planner.md") },
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

  it("should import kiro subagents (JSON format)", async () => {
    const testDir = getTestDir();

    const subagentContent = JSON.stringify(
      { name: "planner", description: "Plans tasks", prompt: "Break down tasks into steps." },
      null,
      2,
    );
    await writeFileContent(join(testDir, ".kiro", "agents", "planner.json"), subagentContent);

    await runImport({ target: "kiro", features: "subagents" });

    const importedContent = await readFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
    );
    expect(importedContent).toContain("planner");
  });
});

describe("E2E: subagents (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it.each([
    { target: "claudecode", outputPath: join(".claude", "agents", "planner.md") },
    { target: "codexcli", outputPath: join(".codex", "agents", "planner.toml") },
    { target: "copilotcli", outputPath: join(".copilot", "agents", "planner.agent.md") },
    { target: "cursor", outputPath: join(".cursor", "agents", "planner.md") },
    { target: "geminicli", outputPath: join(".gemini", "agents", "planner.md") },
    { target: "opencode", outputPath: join(".config", "opencode", "agent", "planner.md") },
    { target: "rovodev", outputPath: join(".rovodev", "subagents", "planner.md") },
    { target: "takt", outputPath: join(".takt", "facets", "personas", "planner.md") },
  ])("should generate $target subagents in home directory", async ({ target, outputPath }) => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    // Setup: Create .rulesync/subagents/planner.md with root: true
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

    // Execute: Generate subagents in global mode with HOME pointed to temp dir
    await runGenerate({
      target,
      features: "subagents",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    // Verify that the expected output file was generated
    const generatedContent = await readFileContent(join(homeDir, outputPath));
    expect(generatedContent).toContain("planner");
    expect(generatedContent).toContain("Analyze files and create a plan.");
  });

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
});

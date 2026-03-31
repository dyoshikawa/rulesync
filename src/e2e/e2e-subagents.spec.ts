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
      simulateSubagents: false,
    },
    {
      target: "cursor",
      outputPath: join(".cursor", "agents", "planner.md"),
      simulateSubagents: false,
    },
    {
      target: "geminicli",
      outputPath: join(".gemini", "agents", "planner.md"),
      simulateSubagents: true,
    },
  ])("should generate $target subagents", async ({ target, outputPath, simulateSubagents }) => {
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
    await runGenerate({ target, features: "subagents", simulateSubagents });

    // Verify that the expected output file was generated
    const generatedContent = await readFileContent(join(testDir, outputPath));
    expect(generatedContent).toContain("planner");
    expect(generatedContent).toContain("Analyze files and create a plan.");
  });

  it("should inject experimental.enableAgents into .gemini/settings.json when generating geminicli subagents", async () => {
    const testDir = getTestDir();

    const subagentContent = `---
name: planner
targets: ["geminicli"]
description: "Plans implementation tasks"
---
You are the planner. Analyze files and create a plan.
`;
    await writeFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
      subagentContent,
    );

    await runGenerate({ target: "geminicli", features: "subagents", simulateSubagents: true });

    const settingsContent = await readFileContent(join(testDir, ".gemini", "settings.json"));
    const settings = JSON.parse(settingsContent);
    expect(settings.experimental?.enableAgents).toBe(true);
  });

  it("should preserve existing settings when injecting experimental.enableAgents", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".gemini", "settings.json"),
      JSON.stringify({ mcpServers: { myServer: { command: "node" } } }, null, 2),
    );

    const subagentContent = `---
name: planner
targets: ["geminicli"]
description: "Plans implementation tasks"
---
You are the planner.
`;
    await writeFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
      subagentContent,
    );

    await runGenerate({ target: "geminicli", features: "subagents", simulateSubagents: true });

    const settingsContent = await readFileContent(join(testDir, ".gemini", "settings.json"));
    const settings = JSON.parse(settingsContent);
    expect(settings.experimental?.enableAgents).toBe(true);
    expect(settings.mcpServers).toEqual({ myServer: { command: "node" } });
  });

  it("should preserve other experimental flags when injecting experimental.enableAgents", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".gemini", "settings.json"),
      JSON.stringify({ experimental: { otherFlag: true } }, null, 2),
    );

    const subagentContent = `---
name: planner
targets: ["geminicli"]
description: "Plans implementation tasks"
---
You are the planner.
`;
    await writeFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
      subagentContent,
    );

    await runGenerate({ target: "geminicli", features: "subagents", simulateSubagents: true });

    const settingsContent = await readFileContent(join(testDir, ".gemini", "settings.json"));
    const settings = JSON.parse(settingsContent);
    expect(settings.experimental?.enableAgents).toBe(true);
    expect(settings.experimental?.otherFlag).toBe(true);
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
});

describe("E2E: subagents (import)", () => {
  const { getTestDir } = useTestDirectory();

  it("should import claudecode subagents", async () => {
    const testDir = getTestDir();

    // Setup: Create a Claude Code agent file
    const subagentContent = `---
name: planner
roleDefinition: You are the planner. Analyze files and create a plan.
---
# Instructions
Break down tasks into steps.
`;
    await writeFileContent(join(testDir, ".claude", "agents", "planner.md"), subagentContent);

    // Execute: Import claudecode subagents
    await runImport({ target: "claudecode", features: "subagents" });

    // Verify that the imported subagent file was created
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
    { target: "cursor", outputPath: join(".cursor", "agents", "planner.md") },
    { target: "opencode", outputPath: join(".config", "opencode", "agent", "planner.md") },
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

import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import { runGenerate, useTestDirectory } from "./e2e-helper.js";

describe("E2E: subagents", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "claudecode", outputPath: join(".claude", "agents", "planner.md") },
    { target: "copilot", outputPath: join(".github", "agents", "planner.md") },
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
});

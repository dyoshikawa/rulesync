import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_SCHEDULED_TASKS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import {
  execFileAsync,
  rulesyncArgs,
  rulesyncCmd,
  runGenerate,
  useGlobalTestDirectories,
} from "./e2e-helper.js";

describe("E2E: scheduled tasks (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it("should generate Claude Code scheduled tasks", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();
    const scheduledTaskContent = `---
name: test-task
description: "A test scheduled task for E2E testing"
targets: ["claudecode"]
---
This is the test scheduled task body content.
`;

    await writeFileContent(
      join(projectDir, RULESYNC_SCHEDULED_TASKS_RELATIVE_DIR_PATH, "test-task", "SKILL.md"),
      scheduledTaskContent,
    );

    await runGenerate({
      target: "claudecode",
      features: "scheduledTasks",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generatedContent = await readFileContent(
      join(homeDir, ".claude", "scheduled-tasks", "test-task", "SKILL.md"),
    );
    expect(generatedContent).toContain("test scheduled task body content");
  });

  it("should import Claude Code scheduled tasks", async () => {
    const homeDir = getHomeDir();

    const scheduledTaskContent = `---
name: test-task
description: "A test scheduled task for E2E testing"
---
This is the test scheduled task body content.
`;
    await writeFileContent(
      join(homeDir, ".claude", "scheduled-tasks", "test-task", "SKILL.md"),
      scheduledTaskContent,
    );

    await execFileAsync(
      rulesyncCmd,
      [
        ...rulesyncArgs,
        "import",
        "--targets",
        "claudecode",
        "--features",
        "scheduledTasks",
        "--global",
      ],
      { env: { ...process.env, HOME_DIR: homeDir } },
    );

    const importedContent = await readFileContent(
      join(homeDir, RULESYNC_SCHEDULED_TASKS_RELATIVE_DIR_PATH, "test-task", "SKILL.md"),
    );
    expect(importedContent).toContain("test scheduled task body content");
  });
});

import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import { runGenerate, useTestDirectory } from "./e2e-helper.js";

describe("E2E: takt Tool x Feature matrix (1:1 facet mapping)", () => {
  const { getTestDir } = useTestDirectory();

  it("generates rules, commands, subagents, and skills into their dedicated facet dirs", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "style.md"),
      `---
targets: ["*"]
---
Rule body for style.
`,
    );
    await writeFileContent(
      join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review.md"),
      `---
description: "Review"
targets: ["*"]
---
Command body for review.
`,
    );
    await writeFileContent(
      join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
      `---
targets: ["*"]
name: planner
description: "plans"
---
Subagent body for planner.
`,
    );
    await writeFileContent(
      join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "runbook", "SKILL.md"),
      `---
name: runbook
description: "Runbook skill"
targets: ["*"]
---
Skill body for runbook.
`,
    );

    await runGenerate({
      target: "takt",
      features: "rules,commands,subagents,skills",
    });

    expect(
      await readFileContent(join(testDir, ".takt", "facets", "policies", "style.md")),
    ).toContain("Rule body for style.");
    expect(
      await readFileContent(join(testDir, ".takt", "facets", "instructions", "review.md")),
    ).toContain("Command body for review.");
    expect(
      await readFileContent(join(testDir, ".takt", "facets", "personas", "planner.md")),
    ).toContain("Subagent body for planner.");
    expect(
      await readFileContent(join(testDir, ".takt", "facets", "knowledge", "runbook.md")),
    ).toContain("Skill body for runbook.");
  });

  it("generates commands and skills into separate facet dirs with shared stems (no collision)", async () => {
    const testDir = getTestDir();

    // Both share the stem `review` but target different facet directories now:
    // commands → instructions/, skills → knowledge/
    await writeFileContent(
      join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review.md"),
      `---
description: "Review"
targets: ["*"]
---
Command body for review.
`,
    );
    await writeFileContent(
      join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "review", "SKILL.md"),
      `---
name: review
description: "Review skill"
targets: ["*"]
---
Skill body for review.
`,
    );

    const { stderr } = await runGenerate({
      target: "takt",
      features: "commands,skills",
      env: { NODE_ENV: "e2e" },
    });

    // No more collision warnings: commands and skills map to different dirs.
    expect(stderr).not.toMatch(/TAKT collision/);
    expect(
      await readFileContent(join(testDir, ".takt", "facets", "instructions", "review.md")),
    ).toContain("Command body for review.");
    expect(
      await readFileContent(join(testDir, ".takt", "facets", "knowledge", "review.md")),
    ).toContain("Skill body for review.");
  });
});

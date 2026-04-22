import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { runGenerate, useTestDirectory } from "./e2e-helper.js";

describe("E2E: takt instructions-facet collisions", () => {
  const { getTestDir } = useTestDirectory();

  it("skips both colliding command and skill, keeps non-colliding files, logs a warning", async () => {
    const testDir = getTestDir();

    // Setup: a command and a skill that share the stem `review` (both write
    // to .takt/facets/instructions/review.md). Plus a non-colliding command
    // and a non-colliding skill so we can verify the rest of the run still
    // produces output.
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
      join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "ship.md"),
      `---
description: "Ship"
targets: ["*"]
---
Command body for ship.
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

    const { stderr } = await runGenerate({
      target: "takt",
      features: "commands,skills",
      // Override NODE_ENV so the Logger's warn output reaches stderr (the
      // default vitest NODE_ENV=test silences all Logger output).
      env: { NODE_ENV: "e2e" },
    });

    // Warning should mention the colliding sources and the conflicting target.
    expect(stderr).toMatch(/TAKT collision/);
    expect(stderr).toContain("review");

    const collidingPath = join(testDir, ".takt", "facets", "instructions", "review.md");
    const nonCollidingCommandPath = join(testDir, ".takt", "facets", "instructions", "ship.md");
    const nonCollidingSkillPath = join(testDir, ".takt", "facets", "instructions", "runbook.md");

    // Colliding output should NOT exist.
    expect(await fileExists(collidingPath)).toBe(false);

    // Non-colliding command and skill should still be generated.
    expect(await readFileContent(nonCollidingCommandPath)).toContain("Command body for ship.");
    expect(await readFileContent(nonCollidingSkillPath)).toContain("Skill body for runbook.");
  });

  it("generates both files when stems do not collide (no warning)", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review.md"),
      `---
description: "Review"
targets: ["*"]
---
Command body.
`,
    );
    await writeFileContent(
      join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "runbook", "SKILL.md"),
      `---
name: runbook
description: "Runbook"
targets: ["*"]
---
Skill body.
`,
    );

    const { stderr } = await runGenerate({
      target: "takt",
      features: "commands,skills",
      env: { NODE_ENV: "e2e" },
    });

    expect(stderr).not.toMatch(/TAKT collision/);
    expect(
      await readFileContent(join(testDir, ".takt", "facets", "instructions", "review.md")),
    ).toContain("Command body.");
    expect(
      await readFileContent(join(testDir, ".takt", "facets", "instructions", "runbook.md")),
    ).toContain("Skill body.");
  });
});

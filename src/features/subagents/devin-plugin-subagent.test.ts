import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { RulesyncTargets } from "../../types/tool-targets.js";
import { writeFileContent } from "../../utils/file.js";
import { DevinPluginSubagent } from "./devin-plugin-subagent.js";
import { DevinSubagent } from "./devin-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("DevinPluginSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  const buildRulesyncSubagent = (targets: RulesyncTargets = ["*"]) =>
    new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "reviewer.md",
      frontmatter: { targets, name: "reviewer", description: "Reviews code" },
      body: "Review the changes.",
      validate: false,
    });

  it("writes agents/<name>/AGENT.md, while devin keeps .devin/agents/", () => {
    const rulesyncSubagent = buildRulesyncSubagent();

    const pluginSubagent = DevinPluginSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: "agents",
      rulesyncSubagent,
    });
    const projectSubagent = DevinSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: join(".devin", "agents"),
      rulesyncSubagent,
    });

    expect(pluginSubagent).toBeInstanceOf(DevinPluginSubagent);
    expect(pluginSubagent.getRelativeDirPath()).toBe("agents");
    expect(pluginSubagent.getRelativeFilePath()).toBe(join("reviewer", "AGENT.md"));
    expect(projectSubagent.getRelativeDirPath()).toBe(join(".devin", "agents"));
  });

  it("reads a subagent back from the plugin's agents/ directory into the project .rulesync/", async () => {
    await writeFileContent(
      join(testDir, "agents", "reviewer", "AGENT.md"),
      "---\nname: reviewer\ndescription: Reviews code\n---\nReview the changes.\n",
    );

    const subagent = await DevinPluginSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: join("reviewer", "AGENT.md"),
    });

    expect(subagent).toBeInstanceOf(DevinPluginSubagent);
    expect(subagent.getRelativeDirPath()).toBe("agents");
    expect(subagent.toRulesyncSubagent().getRelativeFilePath()).toBe("reviewer.md");
    // The imported file belongs to the project .rulesync/, not the plugin root.
    expect(subagent.toRulesyncSubagent().getOutputRoot()).toBe(".");
  });

  it("is targeted by the wildcard and by devin-plugin, not by devin alone", () => {
    expect(DevinPluginSubagent.isTargetedByRulesyncSubagent(buildRulesyncSubagent())).toBe(true);
    expect(
      DevinPluginSubagent.isTargetedByRulesyncSubagent(buildRulesyncSubagent(["devin-plugin"])),
    ).toBe(true);
    expect(DevinPluginSubagent.isTargetedByRulesyncSubagent(buildRulesyncSubagent(["devin"]))).toBe(
      false,
    );
    expect(
      DevinSubagent.isTargetedByRulesyncSubagent(buildRulesyncSubagent(["devin-plugin"])),
    ).toBe(false);
  });
});

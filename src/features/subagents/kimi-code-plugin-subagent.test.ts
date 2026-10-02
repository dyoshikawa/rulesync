import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { writeFileContent } from "../../utils/file.js";
import { KimiCodePluginSubagent } from "./kimi-code-plugin-subagent.js";
import { KimiCodeSubagent } from "./kimi-code-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("KimiCodePluginSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  const buildRulesyncSubagent = (targets: Array<ToolTarget | "*">) =>
    new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "reviewer.md",
      frontmatter: { targets, name: "reviewer", description: "Reviews code" },
      body: "Review the changes.",
      validate: true,
    });

  it("writes into the plugin's agents/ directory, while kimi-code keeps .kimi-code/agents/", () => {
    const rulesyncSubagent = buildRulesyncSubagent(["*"]);

    const pluginSubagent = KimiCodePluginSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      rulesyncSubagent,
    });
    const projectSubagent = KimiCodeSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      rulesyncSubagent,
    });

    expect(pluginSubagent).toBeInstanceOf(KimiCodePluginSubagent);
    expect(pluginSubagent.getRelativeDirPath()).toBe("agents");
    expect(pluginSubagent.getRelativeFilePath()).toBe("reviewer.md");
    expect(projectSubagent.getRelativeDirPath()).toBe(join(".kimi-code", "agents"));
  });

  it("imports a plugin agent into the project's .rulesync/, not into the plugin root", async () => {
    await writeFileContent(
      join(testDir, "agents", "reviewer.md"),
      "---\nname: reviewer\ndescription: Reviews code\n---\nReview the changes.\n",
    );

    const subagent = await KimiCodePluginSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: "reviewer.md",
    });
    const rulesyncSubagent = subagent.toRulesyncSubagent();

    expect(subagent).toBeInstanceOf(KimiCodePluginSubagent);
    expect(subagent.getRelativeDirPath()).toBe("agents");
    expect(rulesyncSubagent.getOutputRoot()).toBe(".");
    expect(rulesyncSubagent.getFrontmatter()).toMatchObject({
      name: "reviewer",
      description: "Reviews code",
    });
  });

  it("returns a plugin instance for deletion", () => {
    const subagent = KimiCodePluginSubagent.forDeletion({
      outputRoot: testDir,
      relativeDirPath: "agents",
      relativeFilePath: "stale.md",
    });

    expect(subagent).toBeInstanceOf(KimiCodePluginSubagent);
  });

  it("is targeted by the wildcard and by kimi-code-plugin, not by kimi-code alone", () => {
    expect(KimiCodePluginSubagent.isTargetedByRulesyncSubagent(buildRulesyncSubagent(["*"]))).toBe(
      true,
    );
    expect(
      KimiCodePluginSubagent.isTargetedByRulesyncSubagent(
        buildRulesyncSubagent(["kimi-code-plugin"]),
      ),
    ).toBe(true);
    expect(
      KimiCodePluginSubagent.isTargetedByRulesyncSubagent(buildRulesyncSubagent(["kimi-code"])),
    ).toBe(false);
    expect(
      KimiCodeSubagent.isTargetedByRulesyncSubagent(buildRulesyncSubagent(["kimi-code-plugin"])),
    ).toBe(false);
  });
});

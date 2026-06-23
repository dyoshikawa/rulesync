import { describe, expect, test } from "vitest";

import {
  HERMESAGENT_GLOBAL_DIR,
  HERMESAGENT_RULESYNC_SUBAGENTS_DIR_PATH,
  HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_DIR_PATH,
} from "../../constants/hermesagent-paths.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { HermesagentSubagent } from "./hermesagent-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("HermesagentSubagent", () => {
  test("generates native Hermes delegation plugin files", () => {
    const rulesyncSubagent = new RulesyncSubagent({
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: `${RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH}/reviewer.md`,
      frontmatter: {
        name: "Reviewer",
        description: "Review code changes",
      },
      body: "Review the code carefully.",
    });

    const files = HermesagentSubagent.fromRulesyncSubagents({
      rulesyncSubagents: [rulesyncSubagent],
    });

    expect(files.map((file) => file.getRelativeFilePath()).toSorted()).toEqual(
      [`reviewer.json`, `plugin.yaml`, `__init__.py`, `config.yaml`].toSorted(),
    );

    const subagentSpec = files.find((file) => file.getRelativeFilePath() === `reviewer.json`);
    expect(JSON.parse(subagentSpec?.getFileContent() ?? "{}")).toMatchObject({
      slug: "reviewer",
      name: "Reviewer",
      description: "Review code changes",
      prompt: "Review the code carefully.",
      hermes: {
        command: "rulesync_subagent_reviewer",
        dispatch: "delegate_task",
      },
    });

    const plugin = files.find((file) => file.getRelativeFilePath() === `__init__.py`);
    expect(plugin?.getFileContent()).toContain("ctx.dispatch_tool(");
    expect(plugin?.getFileContent()).toContain('"delegate_task"');
    expect(plugin?.getFileContent()).toContain("ctx.register_command");

    const manifest = files.find((file) => file.getRelativeFilePath() === `plugin.yaml`);
    expect(manifest?.getFileContent()).toContain("name: rulesync-subagents");

    const config = files.find((file) => file.getRelativeFilePath() === `config.yaml`);
    expect(config?.getFileContent()).toContain("rulesync-subagents");
  });

  test("declares the Hermes subagent directory as settable", () => {
    expect(HermesagentSubagent.getSettablePaths()).toEqual({
      relativeDirPath: HERMESAGENT_RULESYNC_SUBAGENTS_DIR_PATH,
    });
  });

  test("declares per-subagent generated paths", () => {
    const rulesyncSubagent = new RulesyncSubagent({
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: `${RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH}/reviewer.md`,
      frontmatter: {
        name: "Reviewer",
      },
      body: "Review the code carefully.",
    });

    expect(HermesagentSubagent.getSettablePathsForRulesyncSubagent(rulesyncSubagent)).toEqual([
      `${HERMESAGENT_RULESYNC_SUBAGENTS_DIR_PATH}/reviewer.json`,
    ]);
  });

  test("uses Hermes plugin directories", () => {
    expect(HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_DIR_PATH).toBe(
      `${HERMESAGENT_GLOBAL_DIR}/plugins/rulesync-subagents`,
    );
  });
});

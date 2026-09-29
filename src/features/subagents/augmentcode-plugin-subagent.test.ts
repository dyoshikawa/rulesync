import { describe, expect, it } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { AugmentcodePluginSubagent } from "./augmentcode-plugin-subagent.js";
import { AugmentcodeSubagent } from "./augmentcode-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

const buildRulesyncSubagent = () =>
  new RulesyncSubagent({
    outputRoot: ".",
    relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    relativeFilePath: "reviewer.md",
    frontmatter: {
      targets: ["*"],
      name: "reviewer",
      description: "Reviews code",
      augmentcode: {
        model: "sonnet",
        hidden: true,
        tools: ["view"],
        disabled_tools: ["save-file"],
        color: "blue",
        replace_system_prompt: true,
      },
    },
    body: "Review the changes.",
    validate: false,
  });

describe("AugmentcodePluginSubagent", () => {
  it("writes into agents/ and drops the fields Auggie ignores for plugin agents", () => {
    const logger = createMockLogger();

    const subagent = AugmentcodePluginSubagent.fromRulesyncSubagent({
      outputRoot: ".",
      relativeDirPath: "agents",
      rulesyncSubagent: buildRulesyncSubagent(),
      logger,
    });

    expect(subagent.getRelativeDirPath()).toBe("agents");
    const { frontmatter } = parseFrontmatter(subagent.getFileContent(), "reviewer.md");
    expect(frontmatter).toEqual({
      name: "reviewer",
      description: "Reviews code",
      model: "sonnet",
      hidden: true,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "Dropping tools, disabled_tools, color, replace_system_prompt from augmentcode-plugin subagent reviewer.md",
      ),
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("full tool set"));
  });

  it("keeps those fields for the augmentcode target", () => {
    const subagent = AugmentcodeSubagent.fromRulesyncSubagent({
      outputRoot: ".",
      relativeDirPath: "agents",
      rulesyncSubagent: buildRulesyncSubagent(),
    });

    const { frontmatter } = parseFrontmatter(subagent.getFileContent(), "reviewer.md");
    expect(frontmatter).toMatchObject({ tools: ["view"], disabled_tools: ["save-file"] });
  });

  it("has no cross-tool import root", () => {
    expect(AugmentcodePluginSubagent.getSettablePaths()).toEqual({ relativeDirPath: "agents" });
  });
});

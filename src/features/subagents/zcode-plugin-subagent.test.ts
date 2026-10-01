import { describe, expect, it } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import type { RulesyncTargets } from "../../types/tool-targets.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { ZcodePluginSubagent } from "./zcode-plugin-subagent.js";
import { ZcodeSubagent } from "./zcode-subagent.js";

const buildRulesyncSubagent = (targets: RulesyncTargets = ["*"]) =>
  new RulesyncSubagent({
    outputRoot: ".",
    relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    relativeFilePath: "reviewer.md",
    frontmatter: {
      targets,
      name: "reviewer",
      description: "Reviews code",
      zcode: { permissionMode: "plan" },
    },
    body: "Review the changes.",
    validate: false,
  });

describe("ZcodePluginSubagent", () => {
  it("writes into agents/ and keeps permissionMode, which ZCode honors for plugin agents", () => {
    const logger = createMockLogger();

    const subagent = ZcodePluginSubagent.fromRulesyncSubagent({
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
      permissionMode: "plan",
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("leaves the project-scope zcode target dropping permissionMode", () => {
    const logger = createMockLogger();

    const subagent = ZcodeSubagent.fromRulesyncSubagent({
      outputRoot: ".",
      relativeDirPath: ".zcode/agents",
      rulesyncSubagent: buildRulesyncSubagent(),
      logger,
    });

    const { frontmatter } = parseFrontmatter(subagent.getFileContent(), "reviewer.md");
    expect(frontmatter).not.toHaveProperty("permissionMode");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("permissionMode"));
  });

  it("is targeted by the wildcard and by zcode-plugin, not by zcode alone", () => {
    expect(ZcodePluginSubagent.isTargetedByRulesyncSubagent(buildRulesyncSubagent(["*"]))).toBe(
      true,
    );
    expect(
      ZcodePluginSubagent.isTargetedByRulesyncSubagent(buildRulesyncSubagent(["zcode-plugin"])),
    ).toBe(true);
    expect(ZcodePluginSubagent.isTargetedByRulesyncSubagent(buildRulesyncSubagent(["zcode"]))).toBe(
      false,
    );
  });
});

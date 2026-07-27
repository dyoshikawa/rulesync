import * as smolToml from "smol-toml";
import { describe, expect, it } from "vitest";

import { KimiCodePermissions } from "./kimi-code-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

function rulesyncPermissions(json: Record<string, unknown>): RulesyncPermissions {
  return new RulesyncPermissions({
    outputRoot: ".",
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.jsonc",
    fileContent: JSON.stringify(json),
  });
}

/**
 * Run the write path the processor drives: build from the rulesync source, then
 * merge over whatever is already on disk.
 */
function generate({
  json,
  existingContent = "",
}: {
  json: Record<string, unknown>;
  existingContent?: string;
}): Record<string, unknown> {
  const permissions = KimiCodePermissions.fromRulesyncPermissions({
    outputRoot: ".",
    rulesyncPermissions: rulesyncPermissions(json),
  });
  permissions.setFileContent(existingContent);
  return smolToml.parse(permissions.getFileContent()) as Record<string, unknown>;
}

describe("KimiCodePermissions [tools] section", () => {
  it("should write the authored enable and disable lists", () => {
    const config = generate({
      json: {
        permission: {},
        "kimi-code": { tools: { enabled: ["Bash", "Read"], disabled: ["mcp__github__*"] } },
      },
    });

    expect(config.tools).toEqual({ enabled: ["Bash", "Read"], disabled: ["mcp__github__*"] });
  });

  it("should preserve the sibling list when only one is authored", () => {
    // The gateway replaces an owned key wholesale and `tools` is a table, so a
    // partial override must not delete the other documented list.
    const config = generate({
      json: { permission: {}, "kimi-code": { tools: { enabled: ["Bash"] } } },
      existingContent: '[tools]\ndisabled = ["EnterPlanMode"]\n',
    });

    expect(config.tools).toEqual({ enabled: ["Bash"], disabled: ["EnterPlanMode"] });
  });

  it("should leave an existing section untouched when no tools override is authored", () => {
    const config = generate({
      json: { permission: {} },
      existingContent: '[tools]\ndisabled = ["EnterPlanMode"]\n',
    });

    expect(config.tools).toEqual({ disabled: ["EnterPlanMode"] });
  });

  it.each([
    { name: "an absent tools block", override: {} },
    { name: "an empty tools block", override: { tools: {} } },
    { name: "empty lists", override: { tools: { enabled: [], disabled: [] } } },
    { name: "a non-record tools value", override: { tools: "nope" } },
  ])("should not write the section for $name", ({ override }) => {
    const config = generate({ json: { permission: {}, "kimi-code": override } });

    expect(config.tools).toBeUndefined();
  });

  it("should drop non-string entries rather than writing them", () => {
    const config = generate({
      json: {
        permission: {},
        "kimi-code": { tools: { enabled: ["Bash", 42, null, "Read"] } },
      },
    });

    expect(config.tools).toEqual({ enabled: ["Bash", "Read"] });
  });

  it("should round-trip the section back into the kimi-code override on import", () => {
    const permissions = new KimiCodePermissions({
      outputRoot: ".",
      fileContent: '[tools]\nenabled = ["Bash"]\ndisabled = ["mcp__github__*"]\n',
      global: true,
    });

    const imported = JSON.parse(permissions.toRulesyncPermissions().getFileContent());

    expect(imported["kimi-code"].tools).toEqual({
      enabled: ["Bash"],
      disabled: ["mcp__github__*"],
    });
  });
});

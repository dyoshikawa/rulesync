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

  it("should preserve keys in the section that rulesync does not manage", () => {
    const config = generate({
      json: { permission: {}, "kimi-code": { tools: { disabled: ["mcp__github__*"] } } },
      existingContent: '[tools]\nenabled = ["Bash"]\nsome_future_key = true\nmax_concurrent = 4\n',
    });

    expect(config.tools).toEqual({
      enabled: ["Bash"],
      disabled: ["mcp__github__*"],
      some_future_key: true,
      max_concurrent: 4,
    });
  });

  it("should leave a mistyped list exactly as authored rather than deleting it", () => {
    const config = generate({
      json: { permission: {}, "kimi-code": { tools: { enabled: ["Bash"] } } },
      existingContent: '[tools]\ndisabled = "NotAList"\n',
    });

    expect(config.tools).toEqual({ enabled: ["Bash"], disabled: "NotAList" });
  });

  it.each([
    { name: "an absent tools block", override: {} },
    { name: "an empty tools block", override: { tools: {} } },
    { name: "a non-record tools value", override: { tools: "nope" } },
  ])("should not write the section for $name", ({ override }) => {
    const config = generate({ json: { permission: {}, "kimi-code": override } });

    expect(config.tools).toBeUndefined();
  });

  it("should keep an empty allowlist, which admits nothing rather than everything", () => {
    // For Kimi `enabled = []` is an allowlist matching no tool — the strictest
    // setting there is — while an absent key means no allowlist at all.
    const config = generate({
      json: { permission: {}, "kimi-code": { tools: { enabled: [] } } },
    });

    expect(config.tools).toEqual({ enabled: [] });
  });

  it("should not delete a user's empty allowlist when the override says nothing", () => {
    const config = generate({
      json: { permission: {} },
      existingContent: '[tools]\nenabled = []\ndisabled = ["Bash"]\n',
    });

    expect(config.tools).toEqual({ enabled: [], disabled: ["Bash"] });
  });

  it("should round-trip an empty allowlist rather than losing it on import", () => {
    const permissions = new KimiCodePermissions({
      outputRoot: ".",
      fileContent: "[tools]\nenabled = []\n",
      global: true,
    });

    const imported = JSON.parse(permissions.toRulesyncPermissions().getFileContent());

    expect(imported["kimi-code"].tools).toEqual({ enabled: [] });
  });

  it("should leave a hand-written value of an unexpected type out of the import", () => {
    // It stays in config.toml — the merge preserves it — but the override
    // schema only models string lists.
    const permissions = new KimiCodePermissions({
      outputRoot: ".",
      fileContent: '[tools]\nenabled = ["Bash"]\ndisabled = "NotAList"\n',
      global: true,
    });

    const imported = JSON.parse(permissions.toRulesyncPermissions().getFileContent());

    expect(imported["kimi-code"].tools).toEqual({ enabled: ["Bash"] });
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

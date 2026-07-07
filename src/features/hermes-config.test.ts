import { describe, expect, it } from "vitest";

import { deepMergeHermesConfig, parseHermesConfig } from "./hermes-config.js";

describe("parseHermesConfig", () => {
  it("returns empty config for non-object YAML roots", () => {
    expect(parseHermesConfig("- item")).toEqual({});
  });

  it("drops prototype-pollution keys recursively", () => {
    const config = parseHermesConfig(`
model: hermes-3
__proto__:
  polluted: true
mcp_servers:
  docs:
    url: https://example.com/mcp
    constructor:
      polluted: true
plugins:
  enabled:
    - rulesync-subagents
  prototype:
    polluted: true
`);

    expect(config).toEqual({
      model: "hermes-3",
      mcp_servers: {
        docs: {
          url: "https://example.com/mcp",
        },
      },
      plugins: {
        enabled: ["rulesync-subagents"],
      },
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("deepMergeHermesConfig", () => {
  it("merges nested plain objects key-by-key (patch wins)", () => {
    const merged = deepMergeHermesConfig(
      { approvals: { deny: ["rm -rf *"] } },
      { approvals: { mode: "smart" } },
    );
    expect(merged).toEqual({ approvals: { deny: ["rm -rf *"], mode: "smart" } });
  });

  it("replaces arrays and scalars wholesale", () => {
    const merged = deepMergeHermesConfig({ list: [1, 2], flag: true }, { list: [3], flag: false });
    expect(merged).toEqual({ list: [3], flag: false });
  });

  it("drops prototype-pollution keys from the patch", () => {
    const merged = deepMergeHermesConfig({}, JSON.parse('{"__proto__":{"polluted":true},"ok":1}'));
    expect(merged).toEqual({ ok: 1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

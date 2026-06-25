import { describe, expect, it } from "vitest";

import { parseHermesConfig } from "./hermes-config.js";

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

import { describe, expect, it } from "vite-plus/test";

import {
  findOpencodeMcpToolKeyOwner,
  isBareOpencodeMcpServerPrefix,
} from "./opencode-family-mcp-tool-keys.js";

describe("isBareOpencodeMcpServerPrefix", () => {
  it.each([
    { key: "a_b_", serverNames: ["a.b"], expected: true },
    { key: "a_b_", serverNames: ["a_b"], expected: true },
    { key: "a_b_", serverNames: ["other", "a!b"], expected: true },
    { key: "a.b_", serverNames: ["a.b"], expected: false },
    { key: "a_b_read", serverNames: ["a.b"], expected: false },
    { key: "a_b", serverNames: ["a.b"], expected: false },
    { key: "a_b_", serverNames: ["a"], expected: false },
    { key: "a_b_", serverNames: [], expected: false },
  ])("returns $expected for $key with servers $serverNames", ({ key, serverNames, expected }) => {
    expect(isBareOpencodeMcpServerPrefix({ key, serverNames })).toBe(expected);
  });

  it("covers exactly the keys the owner lookup leaves unowned for lack of a tool name", () => {
    const serverNames = ["a.b"];
    expect(
      findOpencodeMcpToolKeyOwner({ key: "a_b_", serverNames, builtinKeys: new Set() }),
    ).toBeUndefined();
    expect(
      findOpencodeMcpToolKeyOwner({ key: "a_b_x", serverNames, builtinKeys: new Set() }),
    ).toEqual({ serverName: "a.b", toolName: "x" });
  });
});

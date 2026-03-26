import { describe, expect, it } from "vitest";

import { isMcpServers } from "./mcp.js";

describe("isMcpServers", () => {
  it("should return true for a plain object", () => {
    expect(isMcpServers({ foo: { command: "npx" } })).toBe(true);
    expect(isMcpServers({})).toBe(true);
  });

  it("should return false for arrays", () => {
    expect(isMcpServers([])).toBe(false);
    expect(isMcpServers([{ command: "npx" }])).toBe(false);
  });

  it("should return false for null, undefined, and non-objects", () => {
    expect(isMcpServers(null)).toBe(false);
    expect(isMcpServers(undefined)).toBe(false);
    expect(isMcpServers("x")).toBe(false);
    expect(isMcpServers(1)).toBe(false);
    expect(isMcpServers(true)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { parseTaktConfig } from "./takt-config.js";

describe("parseTaktConfig", () => {
  it("parses a YAML mapping into a plain object", () => {
    expect(parseTaktConfig("provider: claude\n", ".takt", "config.yaml")).toEqual({
      provider: "claude",
    });
  });

  it("treats an empty file as an empty object", () => {
    expect(parseTaktConfig("", ".takt", "config.yaml")).toEqual({});
    expect(parseTaktConfig("   \n", ".takt", "config.yaml")).toEqual({});
  });

  it("throws with the config path on invalid YAML", () => {
    expect(() => parseTaktConfig("a: [1, 2", ".takt", "config.yaml")).toThrow(
      /Failed to parse Takt config at/,
    );
  });

  it("throws when the YAML is not a mapping", () => {
    expect(() => parseTaktConfig("- a\n- b\n", ".takt", "config.yaml")).toThrow(
      /expected a YAML mapping/,
    );
  });
});

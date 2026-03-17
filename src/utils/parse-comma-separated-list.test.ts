import { describe, expect, it } from "vitest";

import { parseCommaSeparatedList } from "./parse-comma-separated-list.js";

describe("parseCommaSeparatedList", () => {
  it("splits a comma-separated string into trimmed values", () => {
    expect(parseCommaSeparatedList("a, b, c")).toEqual(["a", "b", "c"]);
  });

  it("handles values without spaces", () => {
    expect(parseCommaSeparatedList("copilot,cursor,cline")).toEqual(["copilot", "cursor", "cline"]);
  });

  it("filters out empty strings from trailing commas", () => {
    expect(parseCommaSeparatedList("rules,")).toEqual(["rules"]);
  });

  it("filters out empty strings from leading commas", () => {
    expect(parseCommaSeparatedList(",rules")).toEqual(["rules"]);
  });

  it("filters out empty strings from consecutive commas", () => {
    expect(parseCommaSeparatedList("a,,b")).toEqual(["a", "b"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseCommaSeparatedList("")).toEqual([]);
  });

  it("returns an empty array for only commas", () => {
    expect(parseCommaSeparatedList(",,,")).toEqual([]);
  });

  it("handles a single value", () => {
    expect(parseCommaSeparatedList("*")).toEqual(["*"]);
  });
});

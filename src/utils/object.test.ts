import { describe, expect, it } from "vitest";

import { compact } from "./object.js";

describe("compact", () => {
  it("drops undefined and null values", () => {
    expect(compact({ a: 1, b: undefined, c: null, d: "x" })).toEqual({ a: 1, d: "x" });
  });

  it("keeps falsy-but-defined values", () => {
    expect(compact({ a: 0, b: "", c: false })).toEqual({ a: 0, b: "", c: false });
  });

  it("returns an empty object when all values are nullish", () => {
    expect(compact({ a: undefined, b: null })).toEqual({});
  });
});

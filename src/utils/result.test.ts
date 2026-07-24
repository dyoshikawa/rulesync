import { describe, expect, it } from "vitest";

import { calculateTotalCount, type CountableResult } from "./result.js";

const emptyResult: CountableResult = {
  rulesCount: 0,
  ignoreCount: 0,
  mcpCount: 0,
  commandsCount: 0,
  subagentsCount: 0,
  skillsCount: 0,
  hooksCount: 0,
  permissionsCount: 0,
  checksCount: 0,
};

describe("calculateTotalCount", () => {
  it("includes Hermes project-plugin activation files", () => {
    expect(calculateTotalCount({ ...emptyResult, activationCount: 2 })).toBe(2);
  });

  it("keeps activation optional for import and convert results", () => {
    expect(calculateTotalCount(emptyResult)).toBe(0);
  });
});

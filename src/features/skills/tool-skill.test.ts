import { describe, expect, it } from "vitest";

import { isAgentSkillsInteropRoot } from "./tool-skill.js";

describe("isAgentSkillsInteropRoot", () => {
  it("matches the project/global .agents/skills root", () => {
    expect(isAgentSkillsInteropRoot(".agents/skills")).toBe(true);
  });

  it("matches Amp's global .config/agents/skills root", () => {
    expect(isAgentSkillsInteropRoot(".config/agents/skills")).toBe(true);
  });

  it("normalizes Windows separators before matching", () => {
    expect(isAgentSkillsInteropRoot(".agents\\skills")).toBe(true);
    expect(isAgentSkillsInteropRoot(".config\\agents\\skills")).toBe(true);
  });

  it("does not match tools' native roots or lookalike paths", () => {
    expect(isAgentSkillsInteropRoot(".rovodev/skills")).toBe(false);
    expect(isAgentSkillsInteropRoot(".deepagents/skills")).toBe(false);
    expect(isAgentSkillsInteropRoot("agents/skills")).toBe(false);
    expect(isAgentSkillsInteropRoot("nested/.agents/skills")).toBe(false);
  });
});

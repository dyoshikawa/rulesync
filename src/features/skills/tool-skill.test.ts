import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AmpSkill } from "./amp-skill.js";
import { ClaudecodeSkill } from "./claudecode-skill.js";
import { ClineSkill } from "./cline-skill.js";
import { KimiCodeSkill } from "./kimi-code-skill.js";
import { isLenientImportSkillRoot, ToolSkill } from "./tool-skill.js";

describe("isLenientImportSkillRoot", () => {
  it("matches the project/global .agents/skills root", () => {
    expect(isLenientImportSkillRoot(".agents/skills")).toBe(true);
  });

  it("matches Amp's global .config/agents/skills root", () => {
    expect(isLenientImportSkillRoot(".config/agents/skills")).toBe(true);
  });

  it("normalizes Windows separators before matching", () => {
    expect(isLenientImportSkillRoot(".agents\\skills")).toBe(true);
    expect(isLenientImportSkillRoot(".config\\agents\\skills")).toBe(true);
    expect(isLenientImportSkillRoot(".config\\amp\\skills")).toBe(true);
  });

  it("matches Amp's read-only native global discovery root", () => {
    expect(isLenientImportSkillRoot(".config/amp/skills")).toBe(true);
    expect(isLenientImportSkillRoot("nested/.config/amp/skills")).toBe(false);
  });

  it("does not match tools' native roots or lookalike paths", () => {
    expect(isLenientImportSkillRoot(".rovodev/skills")).toBe(false);
    expect(isLenientImportSkillRoot(".deepagents/skills")).toBe(false);
    expect(isLenientImportSkillRoot("agents/skills")).toBe(false);
    expect(isLenientImportSkillRoot("nested/.agents/skills")).toBe(false);
  });
});

describe("ToolSkill subclass validate() messages", () => {
  const outputRoot = join("/", "project");
  const relativeDirPath = join(".tool", "skills");

  type SkillCtor = new (params: {
    outputRoot: string;
    relativeDirPath: string;
    dirName: string;
    frontmatter: { name: string; description: string };
    body: string;
    validate: boolean;
  }) => ToolSkill;

  const create = (ctor: SkillCtor, frontmatter: Record<string, unknown>, dirName = "my-skill") =>
    new ctor({
      outputRoot,
      relativeDirPath,
      dirName,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- deliberately invalid input
      frontmatter: frontmatter as { name: string; description: string },
      body: "body",
      validate: false,
    });

  const dirPath = join(outputRoot, relativeDirPath, "my-skill");

  describe.each([
    ["AmpSkill", AmpSkill],
    ["ClaudecodeSkill", ClaudecodeSkill],
    ["KimiCodeSkill", KimiCodeSkill],
    ["ClineSkill", ClineSkill],
  ] satisfies Array<[string, SkillCtor]>)("%s", (_name, ctor) => {
    it("succeeds for valid frontmatter", () => {
      const result = create(ctor, { name: "my-skill", description: "desc" }).validate();
      expect(result).toEqual({ success: true, error: null });
    });

    it("reports a missing SKILL.md main file", () => {
      const skill = create(ctor, { name: "my-skill", description: "desc" });
      Object.assign(skill, { mainFile: undefined });
      const result = skill.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe(`${dirPath}: SKILL.md file does not exist`);
    });

    it("reports invalid frontmatter", () => {
      const result = create(ctor, { name: "my-skill", description: 1 }).validate();
      expect(result.success).toBe(false);
      expect(result.error?.message.startsWith(`Invalid frontmatter in ${dirPath}: `)).toBe(true);
    });
  });

  it("reports a frontmatter name that does not match the directory name", () => {
    const result = create(ClineSkill, { name: "other", description: "desc" }).validate();
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe(
      `${dirPath}: frontmatter name (other) must match directory name (my-skill)`,
    );
  });
});

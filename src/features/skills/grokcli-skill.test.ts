import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { GrokcliSkill } from "./grokcli-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("GrokcliSkill", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("discovers skills under .grok/skills", () => {
      expect(GrokcliSkill.getSettablePaths().relativeDirPath).toBe(".grok/skills");
    });

    it("uses the same relative path in global mode (resolved by outputRoot)", () => {
      expect(GrokcliSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(".grok/skills");
    });
  });

  describe("fromRulesyncSkill", () => {
    it("creates a SKILL.md skill with name and description under .grok/skills", () => {
      const rulesyncSkill = new RulesyncSkill({
        dirName: "greet",
        frontmatter: { name: "greet", description: "Greet the user", targets: ["*"] },
        body: "Say hello.",
      });

      const grokcliSkill = GrokcliSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });
      const frontmatter = grokcliSkill.getFrontmatter();

      expect(frontmatter.name).toBe("greet");
      expect(frontmatter.description).toBe("Greet the user");
      expect(grokcliSkill.getDirName()).toBe("greet");
      expect(grokcliSkill.getBody()).toBe("Say hello.");
    });
  });

  describe("toRulesyncSkill", () => {
    it("converts back to a rulesync skill targeting all tools", () => {
      const grokcliSkill = new GrokcliSkill({
        outputRoot: testDir,
        dirName: "greet",
        frontmatter: { name: "greet", description: "Greet the user" },
        body: "Say hello.",
      });

      const rulesyncSkill = grokcliSkill.toRulesyncSkill();
      const frontmatter = rulesyncSkill.getFrontmatter();

      expect(frontmatter.name).toBe("greet");
      expect(frontmatter.description).toBe("Greet the user");
      expect(frontmatter.targets).toEqual(["*"]);
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("targets skills for grokcli and for all tools (*)", () => {
      const grok = new RulesyncSkill({
        dirName: "s",
        frontmatter: { name: "s", description: "d", targets: ["grokcli"] },
        body: "b",
      });
      const all = new RulesyncSkill({
        dirName: "s",
        frontmatter: { name: "s", description: "d", targets: ["*"] },
        body: "b",
      });
      const other = new RulesyncSkill({
        dirName: "s",
        frontmatter: { name: "s", description: "d", targets: ["cursor"] },
        body: "b",
      });

      expect(GrokcliSkill.isTargetedByRulesyncSkill(grok)).toBe(true);
      expect(GrokcliSkill.isTargetedByRulesyncSkill(all)).toBe(true);
      expect(GrokcliSkill.isTargetedByRulesyncSkill(other)).toBe(false);
    });
  });

  describe("validate", () => {
    it("succeeds for a well-formed skill", () => {
      const grokcliSkill = new GrokcliSkill({
        outputRoot: testDir,
        dirName: "greet",
        frontmatter: { name: "greet", description: "Greet the user" },
        body: "Say hello.",
        validate: false,
      });

      const result = grokcliSkill.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });
});

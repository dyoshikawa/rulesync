import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { KiloSkill } from "./kilo-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("KiloSkill", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return .kilocode/skills for project mode", () => {
      const paths = KiloSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".kilocode", "skills"));
    });

    it("should use same relative path for global mode", () => {
      const projectPaths = KiloSkill.getSettablePaths({ global: false });
      const globalPaths = KiloSkill.getSettablePaths({ global: true });
      expect(projectPaths.relativeDirPath).toBe(join(".kilocode", "skills"));
      expect(globalPaths.relativeDirPath).toBe(join(".kilocode", "skills"));
    });
  });

  describe("constructor", () => {
    it("should create instance when data is valid", () => {
      const skill = new KiloSkill({
        baseDir: testDir,
        dirName: "api-design",
        frontmatter: { name: "api-design", description: "API conventions" },
        body: "Document API conventions.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(KiloSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "api-design",
        description: "API conventions",
      });
      expect(skill.getBody()).toBe("Document API conventions.");
    });

    it("should throw when frontmatter name does not match directory", () => {
      expect(
        () =>
          new KiloSkill({
            baseDir: testDir,
            dirName: "api-design",
            frontmatter: { name: "api", description: "desc" },
            body: "content",
            validate: true,
          }),
      ).toThrow(/frontmatter name/);
    });
  });

  describe("fromDir", () => {
    it("should load valid skill directory", async () => {
      const skillDir = join(testDir, ".kilocode", "skills", "api-design");
      await ensureDir(skillDir);
      const skillContent = `---
name: api-design
description: API conventions
---

Document API conventions.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await KiloSkill.fromDir({
        baseDir: testDir,
        dirName: "api-design",
      });

      expect(skill).toBeInstanceOf(KiloSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "api-design",
        description: "API conventions",
      });
    });

    it("should throw when name in frontmatter differs from directory", async () => {
      const skillDir = join(testDir, ".kilocode", "skills", "api-design");
      await ensureDir(skillDir);
      const skillContent = `---
name: api
description: API conventions
---

Document API conventions.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      await expect(
        KiloSkill.fromDir({
          baseDir: testDir,
          dirName: "api-design",
        }),
      ).rejects.toThrow(/must match directory name/);
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill with wildcard targets", () => {
      const kiloSkill = new KiloSkill({
        baseDir: testDir,
        dirName: "api-design",
        frontmatter: { name: "api-design", description: "API conventions" },
        body: "Document API conventions.",
      });

      const rulesyncSkill = kiloSkill.toRulesyncSkill();

      expect(rulesyncSkill).toBeInstanceOf(RulesyncSkill);
      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "api-design",
        description: "API conventions",
        targets: ["*"],
      });
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create KiloSkill from RulesyncSkill", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "api-design",
        frontmatter: {
          name: "api-design",
          description: "API conventions",
          targets: ["kilo"],
        },
        body: "Document API conventions.",
      });

      const kiloSkill = KiloSkill.fromRulesyncSkill({ rulesyncSkill });

      expect(kiloSkill).toBeInstanceOf(KiloSkill);
      expect(kiloSkill.getFrontmatter()).toEqual({
        name: "api-design",
        description: "API conventions",
      });
      expect(kiloSkill.getDirName()).toBe("api-design");
      expect(kiloSkill.getRelativeDirPath()).toBe(join(".kilocode", "skills"));
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should accept wildcard targets", () => {
      const rulesyncSkill = new RulesyncSkill({
        dirName: "api-design",
        frontmatter: { name: "api-design", description: "API conventions", targets: ["*"] },
        body: "content",
      });

      expect(KiloSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should accept kilo-specific targets", () => {
      const rulesyncSkill = new RulesyncSkill({
        dirName: "api-design",
        frontmatter: { name: "api-design", description: "API conventions", targets: ["kilo"] },
        body: "content",
      });

      expect(KiloSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should reject non-matching targets", () => {
      const rulesyncSkill = new RulesyncSkill({
        dirName: "api-design",
        frontmatter: { name: "api-design", description: "API conventions", targets: ["roo"] },
        body: "content",
      });

      expect(KiloSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });
});

import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileBuffer, writeFileContent } from "../../utils/file.js";
import { PiSkill } from "./pi-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("PiSkill", () => {
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
    it("should return project skills directory by default", () => {
      const paths = PiSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".pi", "skills"));
    });

    it("should return global skills directory when global is true", () => {
      const paths = PiSkill.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".pi", "agent", "skills"));
    });
  });

  describe("constructor", () => {
    it("should create a PiSkill with valid frontmatter", () => {
      const skill = new PiSkill({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "skills"),
        dirName: "test-skill",
        frontmatter: { name: "Test Skill", description: "Desc" },
        body: "Body",
      });

      expect(skill).toBeInstanceOf(PiSkill);
      expect(skill.getBody()).toBe("Body");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Desc",
      });
    });

    it("should throw on invalid frontmatter when validating", () => {
      expect(() => {
        new PiSkill({
          outputRoot: testDir,
          relativeDirPath: join(".pi", "skills"),
          dirName: "bad",
          frontmatter: { name: 123 as any, description: "Desc" },
          body: "Body",
          validate: true,
        });
      }).toThrow();
    });
  });

  describe("fromDir", () => {
    it("should load a PiSkill from a project skill directory", async () => {
      const skillDir = join(testDir, ".pi", "skills", "demo");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---
name: demo
description: Demo skill
---

Body content`,
      );

      const skill = await PiSkill.fromDir({
        outputRoot: testDir,
        dirName: "demo",
      });

      expect(skill).toBeInstanceOf(PiSkill);
      expect(skill.getBody()).toBe("Body content");
      expect(skill.getFrontmatter()).toEqual({
        name: "demo",
        description: "Demo skill",
      });
    });

    it("should load a PiSkill from the global skills directory", async () => {
      const skillDir = join(testDir, ".pi", "agent", "skills", "demo");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---
name: demo
description: Global demo
---

Body content`,
      );

      const skill = await PiSkill.fromDir({
        outputRoot: testDir,
        dirName: "demo",
        global: true,
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "demo",
        description: "Global demo",
      });
      expect(skill.getRelativeDirPath()).toBe(join(".pi", "agent", "skills"));
    });

    it("should preserve other files through fromDir and round-trip", async () => {
      const skillDir = join(testDir, ".pi", "skills", "demo");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---
name: demo
description: Demo skill
---

Body content`,
      );
      await writeFileBuffer(join(skillDir, "ref.md"), Buffer.from("# Reference\nAuxiliary file."));

      const skill = await PiSkill.fromDir({
        outputRoot: testDir,
        dirName: "demo",
      });

      const otherFiles = skill.getOtherFiles();
      expect(otherFiles).toHaveLength(1);
      expect(otherFiles[0]?.relativeFilePathToDirPath).toBe("ref.md");
      expect(otherFiles[0]?.fileBuffer.toString()).toBe("# Reference\nAuxiliary file.");

      const rulesyncSkill = skill.toRulesyncSkill();
      expect(rulesyncSkill.getOtherFiles()).toEqual(otherFiles);

      const restored = PiSkill.fromRulesyncSkill({
        outputRoot: testDir,
        rulesyncSkill,
      });
      expect(restored.getOtherFiles()).toEqual(otherFiles);
    });

    it("should throw when the frontmatter is invalid", async () => {
      const skillDir = join(testDir, ".pi", "skills", "bad");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---
name: 123
description: Bad
---

Body`,
      );

      await expect(
        PiSkill.fromDir({
          outputRoot: testDir,
          dirName: "bad",
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create a PiSkill from a RulesyncSkill", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo",
        frontmatter: {
          name: "demo",
          description: "Demo",
          targets: ["*"],
        },
        body: "Body",
        validate: true,
      });

      const skill = PiSkill.fromRulesyncSkill({
        outputRoot: testDir,
        rulesyncSkill,
      });

      expect(skill).toBeInstanceOf(PiSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "demo",
        description: "Demo",
      });
      expect(skill.getRelativeDirPath()).toBe(join(".pi", "skills"));
    });

    it("should emit to the global path when global is true", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo",
        frontmatter: {
          name: "demo",
          description: "Demo",
          targets: ["*"],
        },
        body: "Body",
        validate: true,
      });

      const skill = PiSkill.fromRulesyncSkill({
        outputRoot: testDir,
        rulesyncSkill,
        global: true,
      });

      expect(skill.getRelativeDirPath()).toBe(join(".pi", "agent", "skills"));
    });

    it("should emit Pi-specific frontmatter from the pi block", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo",
        frontmatter: {
          name: "demo",
          description: "Demo",
          targets: ["*"],
          pi: {
            "allowed-tools": ["read", "write"],
            "disable-model-invocation": true,
            license: "MIT",
            compatibility: { "pi-version": ">=0.75.0" },
            metadata: { author: "rulesync" },
          },
        },
        body: "Body",
        validate: true,
      });

      const skill = PiSkill.fromRulesyncSkill({
        outputRoot: testDir,
        rulesyncSkill,
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "demo",
        description: "Demo",
        "allowed-tools": ["read", "write"],
        "disable-model-invocation": true,
        license: "MIT",
        compatibility: { "pi-version": ">=0.75.0" },
        metadata: { author: "rulesync" },
      });
    });

    it("should pick up root-level disable-model-invocation when pi section omits it", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "root-default",
        frontmatter: {
          name: "root-default",
          description: "Root flag",
          "disable-model-invocation": true,
        },
        body: "Body",
        validate: true,
      });

      const skill = PiSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });
      expect(skill.getFrontmatter()["disable-model-invocation"]).toBe(true);
    });

    it("should let pi disable-model-invocation override the root-level value", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "override",
        frontmatter: {
          name: "override",
          description: "Pi opts out of root default",
          "disable-model-invocation": true,
          pi: { "disable-model-invocation": false },
        },
        body: "Body",
        validate: true,
      });

      const skill = PiSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });
      expect(skill.getFrontmatter()["disable-model-invocation"]).toBe(false);
    });

    it("should omit disable-model-invocation when neither root nor pi set it", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "no-flag",
        frontmatter: { name: "no-flag", description: "No flag" },
        body: "Body",
        validate: true,
      });

      const skill = PiSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });
      expect(skill.getFrontmatter()["disable-model-invocation"]).toBeUndefined();
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert a PiSkill to a RulesyncSkill with wildcard targets", () => {
      const skill = new PiSkill({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "skills"),
        dirName: "demo",
        frontmatter: { name: "demo", description: "Demo" },
        body: "Body",
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "demo",
        description: "Demo",
        targets: ["*"],
      });
      expect(rulesyncSkill.getBody()).toBe("Body");
    });

    it("should carry Pi-specific frontmatter into the pi block", () => {
      const skill = new PiSkill({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "skills"),
        dirName: "demo",
        frontmatter: {
          name: "demo",
          description: "Demo",
          "allowed-tools": ["read", "write"],
          "disable-model-invocation": true,
          license: "MIT",
          compatibility: { "pi-version": ">=0.75.0" },
          metadata: { author: "rulesync" },
        },
        body: "Body",
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "demo",
        description: "Demo",
        targets: ["*"],
        pi: {
          "allowed-tools": ["read", "write"],
          "disable-model-invocation": true,
          license: "MIT",
          compatibility: { "pi-version": ">=0.75.0" },
          metadata: { author: "rulesync" },
        },
      });
    });
  });

  describe("validate", () => {
    it("should succeed for valid frontmatter", () => {
      const skill = new PiSkill({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "skills"),
        dirName: "demo",
        frontmatter: { name: "demo", description: "Demo" },
        body: "Body",
      });

      const result = skill.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("forDeletion", () => {
    it("should produce a deletion stub", () => {
      const skill = PiSkill.forDeletion({
        dirName: "stale",
        relativeDirPath: join(".pi", "skills"),
      });

      expect(skill.getDirName()).toBe("stale");
      expect(skill.getRelativeDirPath()).toBe(join(".pi", "skills"));
      expect(skill.getBody()).toBe("");
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should return true for wildcard", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo",
        frontmatter: { name: "demo", description: "Demo", targets: ["*"] },
        body: "Body",
        validate: true,
      });

      expect(PiSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true for pi target", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo",
        frontmatter: { name: "demo", description: "Demo", targets: ["pi"] },
        body: "Body",
        validate: true,
      });

      expect(PiSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false for unrelated targets", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo",
        frontmatter: { name: "demo", description: "Demo", targets: ["cursor"] },
        body: "Body",
        validate: true,
      });

      expect(PiSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });
});

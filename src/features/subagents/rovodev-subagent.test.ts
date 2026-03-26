import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RovodevSubagent } from "./rovodev-subagent.js";
import { RulesyncSubagent, type RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";

describe("RovodevSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const rovodevSubagentsDir = () => join(testDir, ".rovodev", "subagents");

  const validMarkdown = `---
name: Rovo Agent
description: Does useful work
---

Body line one.
Body line two.`;

  const invalidMarkdown = `---
# not a valid schema for rovodev
---

oops`;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return .rovodev/subagents for project mode", () => {
      expect(RovodevSubagent.getSettablePaths()).toEqual({
        relativeDirPath: join(".rovodev", "subagents"),
      });
    });

    it("should return the same relative path for global mode", () => {
      expect(RovodevSubagent.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".rovodev", "subagents"),
      });
    });
  });

  describe("constructor", () => {
    it("should pass fileContent through to the base class unchanged", () => {
      const frontmatter = { name: "A", description: "B" };
      const body = "hello";
      const customFile = "---\nname: A\ndescription: B\n---\n\nhello\n";
      const canonical = stringifyFrontmatter(body, frontmatter);

      const subagent = new RovodevSubagent({
        baseDir: testDir,
        relativeDirPath: join(".rovodev", "subagents"),
        relativeFilePath: "a.md",
        frontmatter,
        body,
        fileContent: customFile,
        validate: true,
      });

      expect(subagent.getFileContent()).toBe(customFile);
      expect(subagent.getFileContent()).not.toBe(canonical);
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should map name, description, and extra keys into rulesync rovodev section", () => {
      const subagent = new RovodevSubagent({
        baseDir: testDir,
        relativeDirPath: join(".rovodev", "subagents"),
        relativeFilePath: "planner.md",
        frontmatter: {
          name: "Planner",
          description: "Plans tasks",
          tools: ["open_files", "bash"],
          model: null,
        },
        body: "Do the planning.",
        fileContent: stringifyFrontmatter("Do the planning.", {
          name: "Planner",
          description: "Plans tasks",
          tools: ["open_files", "bash"],
          model: null,
        }),
        validate: true,
      });

      const rulesync = subagent.toRulesyncSubagent();

      expect(rulesync).toBeInstanceOf(RulesyncSubagent);
      expect(rulesync.getRelativeFilePath()).toBe("planner.md");
      expect(rulesync.getRelativeDirPath()).toBe(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);

      const fm = rulesync.getFrontmatter();
      expect(fm.targets).toEqual(["*"]);
      expect(fm.name).toBe("Planner");
      expect(fm.description).toBe("Plans tasks");
      expect(fm.rovodev).toEqual({
        tools: ["open_files", "bash"],
        model: null,
      });
      expect(rulesync.getBody()).toBe("Do the planning.");
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should merge rulesync rovodev section and set fileContent with avoidBlockScalars", () => {
      const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
        targets: ["rovodev"],
        name: "Sync Agent",
        description: "From rulesync",
        rovodev: {
          tools: ["grep"],
        },
      };
      const body = "Synced body.\nSecond line.";
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "sync-agent.md",
        frontmatter: rulesyncFrontmatter,
        body,
        validate: true,
      });

      const rovodev = RovodevSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: join(".rovodev", "subagents"),
        rulesyncSubagent,
        validate: true,
        global: false,
      }) as RovodevSubagent;

      expect(rovodev).toBeInstanceOf(RovodevSubagent);
      expect(rovodev.getRelativeDirPath()).toBe(join(".rovodev", "subagents"));
      expect(rovodev.getRelativeFilePath()).toBe("sync-agent.md");
      expect(rovodev.getBody()).toBe(body);
      expect(rovodev.getFrontmatter()).toEqual({
        name: "Sync Agent",
        description: "From rulesync",
        tools: ["grep"],
      });

      const expectedContent = stringifyFrontmatter(body, rovodev.getFrontmatter(), {
        avoidBlockScalars: true,
      });
      expect(rovodev.getFileContent()).toBe(expectedContent);
    });

    it("should merge rovodev-only fields from the rovodev section", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "x.md",
        frontmatter: {
          targets: ["rovodev"],
          name: "top-name",
          description: "top-desc",
          rovodev: {
            tools: ["bash"],
            extra: 1,
          },
        },
        body: "b",
        validate: true,
      });

      const rovodev = RovodevSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: join(".rovodev", "subagents"),
        rulesyncSubagent,
        validate: true,
      }) as RovodevSubagent;

      expect(rovodev.getFrontmatter().name).toBe("top-name");
      expect(rovodev.getFrontmatter().description).toBe("top-desc");
      expect((rovodev.getFrontmatter() as { tools?: string[]; extra?: number }).tools).toEqual([
        "bash",
      ]);
      expect((rovodev.getFrontmatter() as { extra?: number }).extra).toBe(1);
    });
  });

  describe("fromFile", () => {
    it("should load from project .rovodev/subagents and preserve raw file content", async () => {
      const filePath = join(rovodevSubagentsDir(), "disk.md");
      await writeFileContent(filePath, validMarkdown);

      const subagent = await RovodevSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "disk.md",
        validate: true,
        global: false,
      });

      expect(subagent).toBeInstanceOf(RovodevSubagent);
      expect(subagent.getFileContent()).toBe(validMarkdown);
      expect(subagent.getFrontmatter()).toEqual({
        name: "Rovo Agent",
        description: "Does useful work",
      });
      expect(subagent.getBody()).toBe("Body line one.\nBody line two.");
      expect(subagent.getRelativeDirPath()).toBe(join(".rovodev", "subagents"));
    });

    it("should load with global: true using the same relative directory", async () => {
      const filePath = join(rovodevSubagentsDir(), "global-agent.md");
      await writeFileContent(filePath, validMarkdown);

      const subagent = await RovodevSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "global-agent.md",
        validate: true,
        global: true,
      });

      expect(subagent.getRelativeDirPath()).toBe(join(".rovodev", "subagents"));
      expect(subagent.getFileContent()).toBe(validMarkdown);
    });

    it("should support nested relativeFilePath under subagents", async () => {
      const nestedDir = join(rovodevSubagentsDir(), "team");
      const filePath = join(nestedDir, "nested.md");
      await writeFileContent(filePath, validMarkdown);

      const subagent = await RovodevSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "team/nested.md",
        validate: true,
      });

      expect(subagent.getRelativeFilePath()).toBe("team/nested.md");
    });

    it("should throw when frontmatter is invalid", async () => {
      const filePath = join(rovodevSubagentsDir(), "bad.md");
      await writeFileContent(filePath, invalidMarkdown);

      await expect(
        RovodevSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "bad.md",
          validate: true,
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });

    it("should throw when file is missing", async () => {
      await expect(
        RovodevSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "missing.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("round-trip", () => {
    it("fromRulesyncSubagent then toRulesyncSubagent preserves semantic content", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "rt.md",
        frontmatter: {
          targets: ["rovodev"],
          name: "RT",
          description: "Round trip",
          rovodev: { tools: ["bash"] },
        },
        body: "content",
        validate: true,
      });

      const rovodev = RovodevSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: join(".rovodev", "subagents"),
        rulesyncSubagent,
        validate: true,
      }) as RovodevSubagent;

      const back = rovodev.toRulesyncSubagent();
      expect(back.getFrontmatter().name).toBe("RT");
      expect(back.getFrontmatter().description).toBe("Round trip");
      expect(back.getFrontmatter().rovodev).toEqual({ tools: ["bash"] });
      expect(back.getBody()).toBe("content");
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should match rovodev and wildcard targets", () => {
      const forRovodev = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "a.md",
        frontmatter: { targets: ["rovodev"], name: "n", description: "d" },
        body: "",
      });
      const forStar = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "b.md",
        frontmatter: { targets: ["*"], name: "n", description: "d" },
        body: "",
      });
      const forOther = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "c.md",
        frontmatter: { targets: ["junie"], name: "n", description: "d" },
        body: "",
      });

      expect(RovodevSubagent.isTargetedByRulesyncSubagent(forRovodev)).toBe(true);
      expect(RovodevSubagent.isTargetedByRulesyncSubagent(forStar)).toBe(true);
      expect(RovodevSubagent.isTargetedByRulesyncSubagent(forOther)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create a minimal instance for deletion", () => {
      const subagent = RovodevSubagent.forDeletion({
        baseDir: testDir,
        relativeDirPath: join(".rovodev", "subagents"),
        relativeFilePath: "gone.md",
        global: false,
      });

      expect(subagent.getRelativeFilePath()).toBe("gone.md");
      expect(subagent.getFileContent()).toBe("");
      expect(subagent.getFrontmatter().name).toBe("");
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const subagent = new RovodevSubagent({
        baseDir: testDir,
        relativeDirPath: join(".rovodev", "subagents"),
        relativeFilePath: "v.md",
        frontmatter: { name: "V", description: "ok" },
        body: "b",
        fileContent: "---\nname: V\ndescription: ok\n---\n\nb",
        validate: false,
      });

      expect(subagent.validate()).toEqual({ success: true, error: null });
    });
  });
});

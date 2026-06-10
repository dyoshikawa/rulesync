import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { ClineSubagent } from "./cline-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { ToolSubagent } from "./tool-subagent.js";

describe("ClineSubagent", () => {
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
    it("should return .cline/agents for both project and global mode", () => {
      expect(ClineSubagent.getSettablePaths()).toEqual({
        relativeDirPath: join(".cline", "agents"),
      });
      expect(ClineSubagent.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".cline", "agents"),
      });
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should map name/description and emit a .yaml file", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "reviewer.md",
        frontmatter: {
          targets: ["cline"],
          name: "reviewer",
          description: "Reviews code",
        },
        body: "Review the code carefully.",
        validate: true,
      });

      const subagent = ClineSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".cline", "agents"),
        rulesyncSubagent,
        validate: true,
      }) as ClineSubagent;

      expect(subagent).toBeInstanceOf(ClineSubagent);
      expect(subagent.getFrontmatter()).toEqual({
        name: "reviewer",
        description: "Reviews code",
      });
      expect(subagent.getBody()).toBe("Review the code carefully.");
      expect(subagent.getRelativeDirPath()).toBe(join(".cline", "agents"));
      // rulesync `.md` source becomes a Cline `.yaml` agent file.
      expect(subagent.getRelativeFilePath()).toBe("reviewer.yaml");
      expect(subagent.getFileContent()).toContain("name: reviewer");
      expect(subagent.getFileContent()).toContain("Review the code carefully.");
    });

    it("should round-trip cline-specific extra fields", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "custom.md",
        frontmatter: {
          targets: ["cline"],
          name: "custom",
          description: "Custom agent",
          cline: {
            model: "claude-sonnet",
          },
        },
        body: "Body",
        validate: true,
      });

      const subagent = ClineSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".cline", "agents"),
        rulesyncSubagent,
        validate: true,
      }) as ClineSubagent;

      expect(subagent.getFrontmatter()).toEqual({
        name: "custom",
        description: "Custom agent",
        model: "claude-sonnet",
      });
    });

    it("should support global mode", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "global-agent.md",
        frontmatter: {
          targets: ["cline"],
          name: "global-agent",
          description: "Global agent",
        },
        body: "Body",
        validate: true,
      });

      const subagent = ClineSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".cline", "agents"),
        rulesyncSubagent,
        global: true,
        validate: true,
      }) as ClineSubagent;

      expect(subagent.getRelativeDirPath()).toBe(join(".cline", "agents"));
      expect(subagent.getRelativeFilePath()).toBe("global-agent.yaml");
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should map back to a .md rulesync file and round-trip extra fields", () => {
      const subagent = new ClineSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".cline", "agents"),
        relativeFilePath: "reviewer.yaml",
        frontmatter: {
          name: "reviewer",
          description: "Reviews code",
          model: "gpt",
        },
        body: "Body",
        validate: true,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      const frontmatter = rulesyncSubagent.getFrontmatter();
      expect(frontmatter.name).toBe("reviewer");
      expect(frontmatter.description).toBe("Reviews code");
      expect(frontmatter.cline).toEqual({ model: "gpt" });
      expect(rulesyncSubagent.getRelativeFilePath()).toBe("reviewer.md");
    });

    it("should omit the cline section when there are no extra fields", () => {
      const subagent = new ClineSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".cline", "agents"),
        relativeFilePath: "plain.yaml",
        frontmatter: { name: "plain", description: "Plain agent" },
        body: "Body",
        validate: true,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      expect(rulesyncSubagent.getFrontmatter().cline).toBeUndefined();
    });
  });

  describe("fromFile", () => {
    it("should load a subagent from .cline/agents", async () => {
      const fileContent = `---
name: reviewer
description: Reviews code
---

Review carefully.`;
      await writeFileContent(join(testDir, ".cline", "agents", "reviewer.yaml"), fileContent);

      const subagent = await ClineSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "reviewer.yaml",
        validate: true,
      });

      expect(subagent.getFrontmatter()).toEqual({
        name: "reviewer",
        description: "Reviews code",
      });
      expect(subagent.getBody()).toBe("Review carefully.");
    });

    it("should throw for invalid frontmatter", async () => {
      await writeFileContent(
        join(testDir, ".cline", "agents", "bad.yaml"),
        `---\ninvalid: true\n---\n\nBody`,
      );
      await expect(
        ClineSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "bad.yaml",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should return true for cline and wildcard targets", () => {
      const make = (targets: string[]) =>
        new RulesyncSubagent({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
          relativeFilePath: "a.md",
          frontmatter: { targets: targets as never, name: "a", description: "d" },
          body: "b",
          validate: false,
        });

      expect(ClineSubagent.isTargetedByRulesyncSubagent(make(["cline"]))).toBe(true);
      expect(ClineSubagent.isTargetedByRulesyncSubagent(make(["*"]))).toBe(true);
      expect(ClineSubagent.isTargetedByRulesyncSubagent(make(["cursor"]))).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create a deletable instance", () => {
      const subagent = ClineSubagent.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".cline", "agents"),
        relativeFilePath: "reviewer.yaml",
      });
      expect(subagent).toBeInstanceOf(ToolSubagent);
      expect(subagent.isDeletable()).toBe(true);
    });
  });
});

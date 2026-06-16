import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { AugmentcodeSubagent } from "./augmentcode-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { ToolSubagent } from "./tool-subagent.js";

describe("AugmentcodeSubagent", () => {
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
    it("should return .augment/agents with .agents as an import-only root for both modes", () => {
      expect(AugmentcodeSubagent.getSettablePaths()).toEqual({
        relativeDirPath: join(".augment", "agents"),
        importDirPaths: [".agents"],
      });
      expect(AugmentcodeSubagent.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".augment", "agents"),
        importDirPaths: [".agents"],
      });
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should map name/description and round-trip augmentcode-specific fields", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "reviewer.md",
        frontmatter: {
          targets: ["augmentcode"],
          name: "reviewer",
          description: "Reviews code",
          augmentcode: {
            color: "blue",
            model: "claude-sonnet",
            tools: ["read", "edit"],
            disabled_tools: ["bash"],
          },
        },
        body: "Review the code carefully.",
        validate: true,
      });

      const subagent = AugmentcodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".augment", "agents"),
        rulesyncSubagent,
        validate: true,
      }) as AugmentcodeSubagent;

      expect(subagent).toBeInstanceOf(AugmentcodeSubagent);
      expect(subagent.getFrontmatter()).toEqual({
        name: "reviewer",
        description: "Reviews code",
        color: "blue",
        model: "claude-sonnet",
        tools: ["read", "edit"],
        disabled_tools: ["bash"],
      });
      expect(subagent.getBody()).toBe("Review the code carefully.");
      expect(subagent.getRelativeDirPath()).toBe(join(".augment", "agents"));
    });

    it("should support global mode", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "global-agent.md",
        frontmatter: {
          targets: ["augmentcode"],
          name: "global-agent",
          description: "Global agent",
        },
        body: "Body",
        validate: true,
      });

      const subagent = AugmentcodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".augment", "agents"),
        rulesyncSubagent,
        global: true,
        validate: true,
      }) as AugmentcodeSubagent;

      expect(subagent.getRelativeDirPath()).toBe(join(".augment", "agents"));
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should round-trip tool-specific fields into the augmentcode section", () => {
      const subagent = new AugmentcodeSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".augment", "agents"),
        relativeFilePath: "reviewer.md",
        frontmatter: {
          name: "reviewer",
          description: "Reviews code",
          color: "green",
          model: "gpt",
          tools: ["read"],
          disabled_tools: ["bash"],
        },
        body: "Body",
        validate: true,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      const frontmatter = rulesyncSubagent.getFrontmatter();
      expect(frontmatter.name).toBe("reviewer");
      expect(frontmatter.description).toBe("Reviews code");
      expect(frontmatter.augmentcode).toEqual({
        color: "green",
        model: "gpt",
        tools: ["read"],
        disabled_tools: ["bash"],
      });
    });

    it("should omit the augmentcode section when there are no extra fields", () => {
      const subagent = new AugmentcodeSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".augment", "agents"),
        relativeFilePath: "plain.md",
        frontmatter: { name: "plain", description: "Plain agent" },
        body: "Body",
        validate: true,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      expect(rulesyncSubagent.getFrontmatter().augmentcode).toBeUndefined();
    });
  });

  describe("fromFile", () => {
    it("should load a subagent from .augment/agents", async () => {
      const fileContent = `---
name: reviewer
description: Reviews code
color: red
tools:
  - read
disabled_tools:
  - bash
---

Review carefully.`;
      await writeFileContent(join(testDir, ".augment", "agents", "reviewer.md"), fileContent);

      const subagent = await AugmentcodeSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "reviewer.md",
        validate: true,
      });

      expect(subagent.getFrontmatter()).toEqual({
        name: "reviewer",
        description: "Reviews code",
        color: "red",
        tools: ["read"],
        disabled_tools: ["bash"],
      });
      expect(subagent.getBody()).toBe("Review carefully.");
    });

    it("should load a subagent from the .agents/ import root when relativeDirPath is set", async () => {
      const fileContent = `---
name: planner
description: Plans work
---

Plan ahead.`;
      await writeFileContent(join(testDir, ".agents", "planner.md"), fileContent);

      const subagent = await AugmentcodeSubagent.fromFile({
        outputRoot: testDir,
        relativeDirPath: ".agents",
        relativeFilePath: "planner.md",
        validate: true,
      });

      expect(subagent.getRelativeDirPath()).toBe(".agents");
      expect(subagent.getFrontmatter().name).toBe("planner");
      expect(subagent.getBody()).toBe("Plan ahead.");
    });

    it("should throw for invalid frontmatter", async () => {
      await writeFileContent(
        join(testDir, ".augment", "agents", "bad.md"),
        `---\ninvalid: true\n---\n\nBody`,
      );
      await expect(
        AugmentcodeSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "bad.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should return true for augmentcode and wildcard targets", () => {
      const make = (targets: string[]) =>
        new RulesyncSubagent({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
          relativeFilePath: "a.md",
          frontmatter: { targets: targets as never, name: "a", description: "d" },
          body: "b",
          validate: false,
        });

      expect(AugmentcodeSubagent.isTargetedByRulesyncSubagent(make(["augmentcode"]))).toBe(true);
      expect(AugmentcodeSubagent.isTargetedByRulesyncSubagent(make(["*"]))).toBe(true);
      expect(AugmentcodeSubagent.isTargetedByRulesyncSubagent(make(["cursor"]))).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create a deletable instance", () => {
      const subagent = AugmentcodeSubagent.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".augment", "agents"),
        relativeFilePath: "reviewer.md",
      });
      expect(subagent).toBeInstanceOf(ToolSubagent);
      expect(subagent.isDeletable()).toBe(true);
    });
  });
});

import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ReasonixSubagent } from "./reasonix-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

const SKILLS_DIR = join(".reasonix", "skills");

describe("ReasonixSubagent", () => {
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
    it("should return .reasonix/skills for project mode", () => {
      const paths = ReasonixSubagent.getSettablePaths();
      expect(paths.relativeDirPath).toBe(SKILLS_DIR);
    });

    it("should return the same directory for global mode", () => {
      const paths = ReasonixSubagent.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(SKILLS_DIR);
    });
  });

  describe("constructor", () => {
    it("should create with name and description", () => {
      const subagent = new ReasonixSubagent({
        outputRoot: testDir,
        relativeDirPath: SKILLS_DIR,
        relativeFilePath: join("my-agent", "SKILL.md"),
        frontmatter: { name: "reviewer", description: "Reviews changes." },
        body: "You are a reviewer.",
      });

      expect(subagent.getFrontmatter().name).toBe("reviewer");
      expect(subagent.getBody()).toBe("You are a reviewer.");
    });

    it("should create with Reasonix-specific optional fields", () => {
      const subagent = new ReasonixSubagent({
        outputRoot: testDir,
        relativeDirPath: SKILLS_DIR,
        relativeFilePath: join("reviewer", "SKILL.md"),
        frontmatter: {
          name: "reviewer",
          description: "Reviews changes.",
          invocation: "manual",
          runAs: "subagent",
          model: "deepseek-pro",
          effort: "high",
          "allowed-tools": ["read_file", "grep", "bash"],
          color: "orange",
        },
        body: "System prompt.",
      });

      expect(subagent.getFrontmatter().runAs).toBe("subagent");
      expect(subagent.getFrontmatter().invocation).toBe("manual");
      expect(subagent.getFrontmatter().model).toBe("deepseek-pro");
      expect(subagent.getFrontmatter().effort).toBe("high");
      expect(subagent.getFrontmatter()["allowed-tools"]).toEqual(["read_file", "grep", "bash"]);
      expect(subagent.getFrontmatter().color).toBe("orange");
    });
  });

  describe("fromFile", () => {
    it("should read subagent from .reasonix/skills/<name>/SKILL.md", async () => {
      const agentDir = join(testDir, ".reasonix", "skills", "reviewer");
      await ensureDir(agentDir);
      const content = `---
name: reviewer
description: Review changes for correctness and regressions
color: orange
invocation: manual
runAs: subagent
model: deepseek-pro
effort: high
allowed-tools: [read_file, grep, bash]
---

You are a reviewer.`;
      await writeFileContent(join(agentDir, "SKILL.md"), content);

      const subagent = await ReasonixSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: join("reviewer", "SKILL.md"),
      });

      expect(subagent.getFrontmatter().name).toBe("reviewer");
      expect(subagent.getFrontmatter().runAs).toBe("subagent");
      expect(subagent.getFrontmatter().model).toBe("deepseek-pro");
      expect(subagent.getBody()).toBe("You are a reviewer.");
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should map name/description, inject runAs and invocation, and emit <name>/SKILL.md", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "reviewer.md",
        frontmatter: { name: "reviewer", description: "Reviews things.", targets: ["reasonix"] },
        body: "You are a reviewer.",
      });

      const subagent = ReasonixSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: SKILLS_DIR,
        rulesyncSubagent,
      }) as ReasonixSubagent;

      expect(subagent.getFrontmatter().name).toBe("reviewer");
      expect(subagent.getFrontmatter().description).toBe("Reviews things.");
      expect(subagent.getFrontmatter().invocation).toBe("manual");
      expect(subagent.getFrontmatter().runAs).toBe("subagent");
      expect(subagent.getRelativeDirPath()).toBe(SKILLS_DIR);
      expect(subagent.getRelativeFilePath()).toBe(join("reviewer", "SKILL.md"));
    });

    it("should pull Reasonix-specific fields from the reasonix tool-specific section", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "reviewer.md",
        frontmatter: {
          name: "reviewer",
          description: "Reviews things.",
          targets: ["reasonix"],
          reasonix: {
            model: "deepseek-pro",
            effort: "high",
            "allowed-tools": ["read_file", "grep"],
            color: "orange",
          },
        },
        body: "System prompt.",
      });

      const subagent = ReasonixSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: SKILLS_DIR,
        rulesyncSubagent,
      }) as ReasonixSubagent;

      expect(subagent.getFrontmatter().model).toBe("deepseek-pro");
      expect(subagent.getFrontmatter().effort).toBe("high");
      expect(subagent.getFrontmatter()["allowed-tools"]).toEqual(["read_file", "grep"]);
      expect(subagent.getFrontmatter().color).toBe("orange");
      // The markers are always forced on, regardless of the source section.
      expect(subagent.getFrontmatter().runAs).toBe("subagent");
      expect(subagent.getFrontmatter().invocation).toBe("manual");
    });

    it("should emit <name>/SKILL.md in global mode", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "reviewer.md",
        frontmatter: { name: "reviewer", description: "Reviews things.", targets: ["reasonix"] },
        body: "You are a reviewer.",
      });

      const subagent = ReasonixSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: SKILLS_DIR,
        rulesyncSubagent,
        global: true,
      }) as ReasonixSubagent;

      expect(subagent.getRelativeDirPath()).toBe(SKILLS_DIR);
      expect(subagent.getRelativeFilePath()).toBe(join("reviewer", "SKILL.md"));
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should convert back to rulesync subagent preserving name and body", () => {
      const subagent = new ReasonixSubagent({
        outputRoot: testDir,
        relativeDirPath: SKILLS_DIR,
        relativeFilePath: join("reviewer", "SKILL.md"),
        frontmatter: {
          name: "reviewer",
          description: "Reviews things.",
          invocation: "manual",
          runAs: "subagent",
          model: "deepseek-pro",
        },
        body: "You are a reviewer.",
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      const frontmatter = rulesyncSubagent.getFrontmatter();

      expect(frontmatter.name).toBe("reviewer");
      expect(frontmatter.description).toBe("Reviews things.");
      expect(rulesyncSubagent.getBody()).toBe("You are a reviewer.");
      // The directory name (not the SKILL.md filename) becomes the flat rulesync file.
      expect(rulesyncSubagent.getRelativeFilePath()).toBe("reviewer.md");
    });

    it("should store Reasonix-specific fields in the reasonix tool-specific section", () => {
      const subagent = new ReasonixSubagent({
        outputRoot: testDir,
        relativeDirPath: SKILLS_DIR,
        relativeFilePath: join("reviewer", "SKILL.md"),
        frontmatter: {
          name: "reviewer",
          description: "Reviews things.",
          invocation: "manual",
          runAs: "subagent",
          model: "deepseek-pro",
          effort: "high",
        },
        body: "System prompt.",
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      const reasonixSection = rulesyncSubagent.getFrontmatter().reasonix as Record<string, unknown>;

      expect(reasonixSection?.model).toBe("deepseek-pro");
      expect(reasonixSection?.effort).toBe("high");
      expect(reasonixSection?.runAs).toBe("subagent");
      expect(reasonixSection?.invocation).toBe("manual");
    });
  });

  describe("forDeletion", () => {
    it("should create a deletable placeholder for <name>/SKILL.md", () => {
      const subagent = ReasonixSubagent.forDeletion({
        outputRoot: testDir,
        relativeDirPath: SKILLS_DIR,
        relativeFilePath: join("orphan", "SKILL.md"),
      });

      expect(subagent.getRelativeDirPath()).toBe(SKILLS_DIR);
      expect(subagent.getRelativeFilePath()).toBe(join("orphan", "SKILL.md"));
      expect(subagent.getBody()).toBe("");
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should return true for reasonix target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "agent.md",
        frontmatter: { name: "agent", targets: ["reasonix"] },
        body: "",
      });

      expect(ReasonixSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return true for wildcard target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "agent.md",
        frontmatter: { name: "agent", targets: ["*"] },
        body: "",
      });

      expect(ReasonixSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return false for a different tool", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "agent.md",
        frontmatter: { name: "agent", targets: ["claudecode"] },
        body: "",
      });

      expect(ReasonixSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(false);
    });
  });
});

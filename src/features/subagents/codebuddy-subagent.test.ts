import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CodebuddySubagent } from "./codebuddy-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

const agentsDir = join(".codebuddy", "agents");

describe("CodebuddySubagent", () => {
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
    it("should return .codebuddy/agents for both scopes", () => {
      expect(CodebuddySubagent.getSettablePaths().relativeDirPath).toBe(agentsDir);
      expect(CodebuddySubagent.getSettablePaths({ global: true }).relativeDirPath).toBe(agentsDir);
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should write name, description and the codebuddy section", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "code-reviewer.md",
        frontmatter: {
          targets: ["*"],
          name: "code-reviewer",
          description: "Reviews code",
          codebuddy: { tools: "Read, Grep, Glob", model: "inherit", permissionMode: "plan" },
        },
        body: "You review code.",
        validate: true,
      });

      const subagent = CodebuddySubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
        global: true,
      }) as CodebuddySubagent;

      expect(subagent.getRelativeDirPath()).toBe(agentsDir);
      expect(subagent.getRelativeFilePath()).toBe("code-reviewer.md");
      expect(subagent.getFrontmatter()).toEqual({
        name: "code-reviewer",
        description: "Reviews code",
        tools: "Read, Grep, Glob",
        model: "inherit",
        permissionMode: "plan",
      });
      expect(subagent.getFileContent()).toContain("tools: Read, Grep, Glob");
      expect(subagent.getBody()).toBe("You review code.");
    });

    it("should keep the canonical name and description over same-named codebuddy keys", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "code-reviewer.md",
        frontmatter: {
          targets: ["*"],
          name: "code-reviewer",
          description: "Reviews code",
          codebuddy: { name: "other-agent", description: "Overridden", model: "inherit" },
        },
        body: "You review code.",
        validate: true,
      });

      const subagent = CodebuddySubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        rulesyncSubagent,
      }) as CodebuddySubagent;

      expect(subagent.getRelativeFilePath()).toBe("code-reviewer.md");
      expect(subagent.getFrontmatter()).toEqual({
        name: "code-reviewer",
        description: "Reviews code",
        model: "inherit",
      });
      expect(subagent.getFileContent()).not.toContain("other-agent");
      expect(subagent.getFileContent()).not.toContain("Overridden");
    });
  });

  describe("fromFile and toRulesyncSubagent", () => {
    it("should round-trip CodeBuddy-specific keys through the codebuddy section", async () => {
      await writeFileContent(
        join(testDir, agentsDir, "debugger.md"),
        "---\nname: debugger\ndescription: Debugs failures\ntools: Read, Edit, Bash\nmaxTurns: 5\n---\nFind the root cause.\n",
      );

      const subagent = await CodebuddySubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "debugger.md",
      });
      const rulesyncSubagent = subagent.toRulesyncSubagent();

      expect(rulesyncSubagent.getFrontmatter()).toEqual({
        targets: ["*"],
        name: "debugger",
        description: "Debugs failures",
        codebuddy: { tools: "Read, Edit, Bash", maxTurns: 5 },
      });
      expect(rulesyncSubagent.getBody()).toBe("Find the root cause.");
      expect(rulesyncSubagent.getRelativeDirPath()).toBe(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
    });

    it("should reject a file without a name", async () => {
      await writeFileContent(
        join(testDir, agentsDir, "nameless.md"),
        "---\ndescription: No name\n---\nBody\n",
      );

      await expect(
        CodebuddySubagent.fromFile({ outputRoot: testDir, relativeFilePath: "nameless.md" }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should match wildcard and codebuddy targets only", () => {
      const build = (targets: ("*" | "codebuddy" | "cursor")[]) =>
        new RulesyncSubagent({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
          relativeFilePath: "a.md",
          frontmatter: { targets, name: "a", description: "d" },
          body: "",
        });

      expect(CodebuddySubagent.isTargetedByRulesyncSubagent(build(["*"]))).toBe(true);
      expect(CodebuddySubagent.isTargetedByRulesyncSubagent(build(["codebuddy"]))).toBe(true);
      expect(CodebuddySubagent.isTargetedByRulesyncSubagent(build(["cursor"]))).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should build an unvalidated placeholder", () => {
      const subagent = CodebuddySubagent.forDeletion({
        outputRoot: testDir,
        relativeDirPath: agentsDir,
        relativeFilePath: "old.md",
      });

      expect(subagent.getRelativeFilePath()).toBe("old.md");
    });
  });
});

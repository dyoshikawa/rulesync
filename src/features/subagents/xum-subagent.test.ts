import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { XumSubagent } from "./xum-subagent.js";

describe("XumSubagent", () => {
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

  const makeRulesyncSubagent = (frontmatter: Record<string, unknown> = {}) =>
    new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "reviewer.md",
      frontmatter: {
        targets: ["*"],
        name: "Reviewer",
        description: "Short code review comments",
        ...frontmatter,
      },
      body: "Review the changes for correctness.",
      validate: true,
    });

  it("should use .xum/agents for both scopes", () => {
    expect(XumSubagent.getSettablePaths().relativeDirPath).toBe(join(".xum", "agents"));
    expect(XumSubagent.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".xum", "agents"),
    );
  });

  it("should default to a runnable subagent based on exec", () => {
    const subagent = XumSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      rulesyncSubagent: makeRulesyncSubagent(),
    }) as XumSubagent;

    expect(subagent.getRelativeDirPath()).toBe(join(".xum", "agents"));
    expect(subagent.getRelativeFilePath()).toBe("reviewer.md");
    const { frontmatter, body } = parseFrontmatter(subagent.getFileContent());
    expect(frontmatter).toEqual({
      name: "Reviewer",
      description: "Short code review comments",
      base: "exec",
      subagent: { runnable: true },
    });
    expect(body.trim()).toBe("Review the changes for correctness.");
  });

  it("should spread the xum block and keep its own base, tools and subagent fields", () => {
    const subagent = XumSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      rulesyncSubagent: makeRulesyncSubagent({
        xum: {
          base: "plan",
          ui: { hidden: true },
          ai: { model: "sonnet", thinkingLevel: "low" },
          subagent: { append_prompt: "Report findings only." },
          tools: { remove: ["file_edit_.*"] },
        },
      }),
    }) as XumSubagent;

    expect(subagent.getFrontmatter()).toEqual({
      name: "Reviewer",
      description: "Short code review comments",
      base: "plan",
      ui: { hidden: true },
      ai: { model: "sonnet", thinkingLevel: "low" },
      subagent: { runnable: true, append_prompt: "Report findings only." },
      tools: { remove: ["file_edit_.*"] },
    });
  });

  it("should not add a default base when the xum block declares its own tools", () => {
    const subagent = XumSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      rulesyncSubagent: makeRulesyncSubagent({
        xum: { tools: { add: ["file_read"] }, subagent: { runnable: false } },
      }),
    }) as XumSubagent;

    expect(subagent.getFrontmatter().base).toBeUndefined();
    expect(subagent.getFrontmatter().subagent).toEqual({ runnable: false });
  });

  it("should round-trip a Xum agent file into a rulesync subagent", async () => {
    await writeFileContent(
      join(testDir, ".xum", "agents", "docs.md"),
      "---\nname: Docs\ndescription: Documentation only\nbase: exec\ntools:\n  remove:\n    - task\n---\n\nOnly edit docs.\n",
    );

    const subagent = await XumSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: "docs.md",
    });
    const rulesync = subagent.toRulesyncSubagent();

    expect(rulesync.getRelativeFilePath()).toBe("docs.md");
    expect(rulesync.getFrontmatter()).toEqual({
      targets: ["*"],
      name: "Docs",
      description: "Documentation only",
      xum: { base: "exec", tools: { remove: ["task"] } },
    });
    expect(rulesync.getBody()).toBe("Only edit docs.");
  });

  it("should omit an empty description, which Xum would reject", () => {
    const subagent = XumSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      rulesyncSubagent: makeRulesyncSubagent({ description: "" }),
    }) as XumSubagent;

    expect(subagent.getFrontmatter()).not.toHaveProperty("description");
  });

  it("should only target xum or wildcard subagents", () => {
    expect(
      XumSubagent.isTargetedByRulesyncSubagent(makeRulesyncSubagent({ targets: ["xum"] })),
    ).toBe(true);
    expect(XumSubagent.isTargetedByRulesyncSubagent(makeRulesyncSubagent())).toBe(true);
    expect(
      XumSubagent.isTargetedByRulesyncSubagent(makeRulesyncSubagent({ targets: ["cursor"] })),
    ).toBe(false);
  });

  it("should reject a frontmatter without a name", () => {
    expect(
      () =>
        new XumSubagent({
          outputRoot: testDir,
          relativeDirPath: join(".xum", "agents"),
          relativeFilePath: "broken.md",
          frontmatter: { description: "no name" } as never,
          body: "",
          fileContent: "",
        }),
    ).toThrow(/Invalid frontmatter/);
  });
});

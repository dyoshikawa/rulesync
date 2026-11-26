import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { DeepcodeSubagent } from "./deepcode-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("DeepcodeSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  const makeRulesyncSubagent = (frontmatter: Record<string, unknown>) =>
    new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "reviewer.md",
      frontmatter: { targets: ["*"], name: "reviewer", ...frontmatter } as never,
      body: "Review the diff.",
      validate: true,
    });

  it("should use .agents/presets in project scope and .deepcode/agent-presets globally", () => {
    expect(DeepcodeSubagent.getSettablePaths().relativeDirPath).toBe(join(".agents", "presets"));
    expect(DeepcodeSubagent.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".deepcode", "agent-presets"),
    );
  });

  it("should write name, description and the deepcode section", () => {
    const subagent = DeepcodeSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      rulesyncSubagent: makeRulesyncSubagent({
        description: "Reads and comments; never edits.",
        deepcode: {
          "disallowed-tools": "write, edit, multi_edit",
          "allow-spawn": false,
          name: "ignored",
        },
      }),
    }) as DeepcodeSubagent;

    expect(subagent.getRelativeDirPath()).toBe(join(".agents", "presets"));
    expect(subagent.getRelativeFilePath()).toBe("reviewer.md");
    expect(subagent.getFrontmatter()).toEqual({
      name: "reviewer",
      description: "Reads and comments; never edits.",
      "disallowed-tools": "write, edit, multi_edit",
      "allow-spawn": false,
    });
    expect(subagent.getFileContent()).toContain("Review the diff.");
  });

  it("should omit description when the rulesync subagent has none", () => {
    const subagent = DeepcodeSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      rulesyncSubagent: makeRulesyncSubagent({}),
      global: true,
    }) as DeepcodeSubagent;

    expect(subagent.getRelativeDirPath()).toBe(join(".deepcode", "agent-presets"));
    expect(subagent.getFrontmatter()).toEqual({ name: "reviewer" });
  });

  it("should import native keys into the deepcode section and fall back to the file name", async () => {
    await writeFileContent(
      join(testDir, ".agents", "presets", "planner.md"),
      "---\ntools: read, grep\nprompt-mode: replace\norder: 2\n---\nPlan the change.\n",
    );

    const subagent = await DeepcodeSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: "planner.md",
    });
    const rulesync = subagent.toRulesyncSubagent();

    expect(rulesync.getFrontmatter()).toEqual({
      targets: ["*"],
      name: "planner",
      deepcode: { tools: "read, grep", "prompt-mode": "replace", order: 2 },
    });
    expect(rulesync.getBody()).toBe("Plan the change.");
  });

  it("should only target deepcode or wildcard subagents", () => {
    expect(
      DeepcodeSubagent.isTargetedByRulesyncSubagent(makeRulesyncSubagent({ targets: ["*"] })),
    ).toBe(true);
    expect(
      DeepcodeSubagent.isTargetedByRulesyncSubagent(
        makeRulesyncSubagent({ targets: ["deepcode"] }),
      ),
    ).toBe(true);
    expect(
      DeepcodeSubagent.isTargetedByRulesyncSubagent(makeRulesyncSubagent({ targets: ["cursor"] })),
    ).toBe(false);
  });
});

import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { THEIA_DEFAULT_LLM, TheiaSubagent } from "./theia-subagent.js";

describe("TheiaSubagent", () => {
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

  const makeRulesyncSubagent = (frontmatter: Record<string, unknown>) =>
    new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "planner.md",
      frontmatter: { targets: ["*"], name: "Planner", ...frontmatter },
      body: "Plan the work.",
    });

  it("should write project agents to .agents/agents and refuse global mode", () => {
    expect(TheiaSubagent.getSettablePaths()).toEqual({
      relativeDirPath: join(".agents", "agents"),
    });
    expect(() => TheiaSubagent.getSettablePaths({ global: true })).toThrow(
      "TheiaSubagent does not support global mode.",
    );
  });

  it("should emit <id>/agent.md with the default LLM Theia requires", () => {
    const subagent = TheiaSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: join(".agents", "agents"),
      rulesyncSubagent: makeRulesyncSubagent({ description: "Plans tasks" }),
    }) as TheiaSubagent;

    expect(subagent.getRelativeFilePath()).toBe(join("planner", "agent.md"));
    const { frontmatter, body } = parseFrontmatter(subagent.getFileContent());
    expect(frontmatter).toEqual({
      name: "Planner",
      description: "Plans tasks",
      defaultLLM: THEIA_DEFAULT_LLM,
    });
    expect(body.trim()).toBe("Plan the work.");
  });

  it("should write an empty description when the source has none", () => {
    const subagent = TheiaSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: join(".agents", "agents"),
      rulesyncSubagent: makeRulesyncSubagent({}),
    }) as TheiaSubagent;

    expect(subagent.getFrontmatter().description).toBe("");
  });

  it("should apply the theia section but never an id that could disagree with the folder", () => {
    const subagent = TheiaSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: join(".agents", "agents"),
      rulesyncSubagent: makeRulesyncSubagent({
        description: "Plans tasks",
        theia: { defaultLLM: "openai/gpt-5", showInChat: false, id: "other" },
      }),
    }) as TheiaSubagent;

    expect(subagent.getFrontmatter()).toEqual({
      name: "Planner",
      description: "Plans tasks",
      defaultLLM: "openai/gpt-5",
      showInChat: false,
    });
  });

  it("should import an agent.md, keeping only a non-default LLM", async () => {
    await writeFileContent(
      join(testDir, ".agents", "agents", "planner", "agent.md"),
      "---\nname: Planner\ndescription: Plans tasks\ndefaultLLM: default/universal\nshowInChat: true\n---\nPlan the work.\n",
    );

    const subagent = await TheiaSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: join("planner", "agent.md"),
    });
    const rulesyncSubagent = subagent.toRulesyncSubagent();

    expect(rulesyncSubagent.getRelativeFilePath()).toBe("planner.md");
    expect(rulesyncSubagent.getFrontmatter()).toEqual({
      targets: ["*"],
      name: "Planner",
      description: "Plans tasks",
      theia: { showInChat: true },
    });
    expect(rulesyncSubagent.getBody()).toBe("Plan the work.");
  });

  it("should reject an agent.md without defaultLLM, as Theia skips it", async () => {
    await writeFileContent(
      join(testDir, ".agents", "agents", "planner", "agent.md"),
      "---\nname: Planner\ndescription: Plans tasks\n---\nBody\n",
    );

    await expect(
      TheiaSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: join("planner", "agent.md"),
      }),
    ).rejects.toThrow("Invalid frontmatter");
  });
});

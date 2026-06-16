import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { KiroIdeSubagent } from "./kiro-ide-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

const buildRulesyncSubagent = (overrides?: {
  body?: string;
  name?: string;
  description?: string;
  kiroIde?: Record<string, unknown>;
}): RulesyncSubagent =>
  new RulesyncSubagent({
    relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    relativeFilePath: `${overrides?.name ?? "planner"}.md`,
    frontmatter: {
      targets: ["*"],
      name: overrides?.name ?? "planner",
      description: overrides?.description ?? "Plans tasks",
      ...(overrides?.kiroIde ? { "kiro-ide": overrides.kiroIde } : {}),
    },
    body: overrides?.body ?? "Break down tasks into steps.",
  });

describe("KiroIdeSubagent", () => {
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

  it("returns the .kiro/agents path", () => {
    expect(KiroIdeSubagent.getSettablePaths().relativeDirPath).toBe(join(".kiro", "agents"));
  });

  it("generates a Markdown subagent with frontmatter and body", () => {
    const subagent = KiroIdeSubagent.fromRulesyncSubagent({
      relativeDirPath: KiroIdeSubagent.getSettablePaths().relativeDirPath,
      rulesyncSubagent: buildRulesyncSubagent({
        kiroIde: { model: "sonnet", includeMcpJson: true },
      }),
    }) as KiroIdeSubagent;

    expect(subagent.getRelativeFilePath()).toBe("planner.md");
    expect(subagent.getFrontmatter()).toMatchObject({
      name: "planner",
      description: "Plans tasks",
      model: "sonnet",
      includeMcpJson: true,
    });
    expect(subagent.getBody()).toBe("Break down tasks into steps.");
    expect(subagent.getFileContent()).toContain("Break down tasks into steps.");
  });

  it("round-trips Kiro IDE fields through the kiro-ide section", () => {
    const subagent = KiroIdeSubagent.fromRulesyncSubagent({
      relativeDirPath: KiroIdeSubagent.getSettablePaths().relativeDirPath,
      rulesyncSubagent: buildRulesyncSubagent({ kiroIde: { model: "sonnet" } }),
    }) as KiroIdeSubagent;

    const rulesync = subagent.toRulesyncSubagent();
    const fm = rulesync.getFrontmatter();
    expect(fm.name).toBe("planner");
    expect(fm.description).toBe("Plans tasks");
    expect((fm["kiro-ide"] as Record<string, unknown>).model).toBe("sonnet");
  });

  it("loads a Markdown subagent from disk", async () => {
    const fileContent = stringifyFrontmatter("Do the thing.", {
      name: "helper",
      description: "Helps",
    });
    await writeFileContent(join(testDir, ".kiro", "agents", "helper.md"), fileContent);

    const subagent = await KiroIdeSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: "helper.md",
    });

    expect(subagent).toBeInstanceOf(KiroIdeSubagent);
    expect(subagent.getBody()).toBe("Do the thing.");
    expect(subagent.getFrontmatter().name).toBe("helper");
  });

  it("targets the kiro-ide tool", () => {
    expect(KiroIdeSubagent.isTargetedByRulesyncSubagent(buildRulesyncSubagent())).toBe(true);
    expect(
      KiroIdeSubagent.isTargetedByRulesyncSubagent(
        new RulesyncSubagent({
          relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
          relativeFilePath: "x.md",
          frontmatter: { targets: ["kiro-ide"], name: "x", description: "d" },
          body: "b",
        }),
      ),
    ).toBe(true);
    expect(
      KiroIdeSubagent.isTargetedByRulesyncSubagent(
        new RulesyncSubagent({
          relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
          relativeFilePath: "x.md",
          frontmatter: { targets: ["kiro-cli"], name: "x", description: "d" },
          body: "b",
        }),
      ),
    ).toBe(false);
  });
});

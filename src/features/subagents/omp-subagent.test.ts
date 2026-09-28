import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { OmpSubagent } from "./omp-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("OmpSubagent", () => {
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
      relativeFilePath: "reviewer.md",
      frontmatter: { targets: ["*"], name: "reviewer", ...frontmatter } as never,
      body: "You review code.",
      validate: true,
    });

  it("should resolve project and global settable paths under the omp dirs", () => {
    expect(OmpSubagent.getSettablePaths().relativeDirPath).toBe(join(".omp", "agents"));
    expect(OmpSubagent.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".omp", "agent", "agents"),
    );
  });

  it("should write the omp section into the frontmatter and round-trip it", () => {
    const subagent = OmpSubagent.fromRulesyncSubagent({
      relativeDirPath: join(".omp", "agents"),
      rulesyncSubagent: makeRulesyncSubagent({
        description: "Reviews code",
        omp: { tools: ["read", "grep"], model: "smol" },
      }),
    }) as OmpSubagent;

    expect(subagent.getRelativeDirPath()).toBe(join(".omp", "agents"));
    expect(subagent.getFrontmatter()).toEqual({
      name: "reviewer",
      description: "Reviews code",
      tools: ["read", "grep"],
      model: "smol",
    });
    expect(subagent.toRulesyncSubagent().getFrontmatter()).toEqual({
      targets: ["*"],
      name: "reviewer",
      description: "Reviews code",
      omp: { tools: ["read", "grep"], model: "smol" },
    });
  });

  it("should fall back to the name when no description is given", () => {
    const subagent = OmpSubagent.fromRulesyncSubagent({
      relativeDirPath: join(".omp", "agents"),
      rulesyncSubagent: makeRulesyncSubagent({}),
    }) as OmpSubagent;

    expect(subagent.getFrontmatter().description).toBe("reviewer");
  });

  it("should load an agent file from .omp/agents", async () => {
    await writeFileContent(
      join(testDir, ".omp", "agents", "reviewer.md"),
      "---\nname: reviewer\ndescription: Reviews code\ntools: read, grep\n---\nYou review code.\n",
    );

    const subagent = await OmpSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: "reviewer.md",
    });

    expect(subagent.getBody()).toBe("You review code.");
    expect(subagent.getFrontmatter().tools).toBe("read, grep");
  });

  it("should reject an agent file without a description", async () => {
    await writeFileContent(
      join(testDir, ".omp", "agents", "reviewer.md"),
      "---\nname: reviewer\n---\nYou review code.\n",
    );

    await expect(
      OmpSubagent.fromFile({ outputRoot: testDir, relativeFilePath: "reviewer.md" }),
    ).rejects.toThrow(/Invalid frontmatter/);
  });
});

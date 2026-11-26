import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { GajaecodeSubagent } from "./gajaecode-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("GajaecodeSubagent", () => {
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

  it("should resolve project and global settable paths under the .gjc dirs", () => {
    expect(GajaecodeSubagent.getSettablePaths().relativeDirPath).toBe(join(".gjc", "agents"));
    expect(GajaecodeSubagent.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".gjc", "agent", "agents"),
    );
  });

  it("should write the gajaecode section into the frontmatter and round-trip it", () => {
    const subagent = GajaecodeSubagent.fromRulesyncSubagent({
      relativeDirPath: join(".gjc", "agents"),
      rulesyncSubagent: makeRulesyncSubagent({
        description: "Reviews code",
        gajaecode: { tools: ["read", "grep"], model: "smol" },
      }),
    }) as GajaecodeSubagent;

    expect(subagent.getRelativeDirPath()).toBe(join(".gjc", "agents"));
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
      gajaecode: { tools: ["read", "grep"], model: "smol" },
    });
  });

  it("should fall back to the name when no description is given", () => {
    const subagent = GajaecodeSubagent.fromRulesyncSubagent({
      relativeDirPath: join(".gjc", "agents"),
      rulesyncSubagent: makeRulesyncSubagent({}),
    }) as GajaecodeSubagent;

    expect(subagent.getFrontmatter().description).toBe("reviewer");
  });

  it("should load an agent file from .gjc/agents", async () => {
    await writeFileContent(
      join(testDir, ".gjc", "agents", "reviewer.md"),
      "---\nname: reviewer\ndescription: Reviews code\ntools: read, grep\n---\nYou review code.\n",
    );

    const subagent = await GajaecodeSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: "reviewer.md",
    });

    expect(subagent.getBody()).toBe("You review code.");
    expect(subagent.getFrontmatter().tools).toBe("read, grep");
  });

  it("should reject an agent file without a description", async () => {
    await writeFileContent(
      join(testDir, ".gjc", "agents", "reviewer.md"),
      "---\nname: reviewer\n---\nYou review code.\n",
    );

    await expect(
      GajaecodeSubagent.fromFile({ outputRoot: testDir, relativeFilePath: "reviewer.md" }),
    ).rejects.toThrow(/Invalid frontmatter/);
  });
});

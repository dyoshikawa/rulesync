import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { LettacodeSubagent } from "./lettacode-subagent.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";

const agentsDir = join(".letta", "agents");

function buildRulesyncSubagent(
  frontmatter: Partial<RulesyncSubagentFrontmatter> & { name: string },
  fileName = "reviewer.md",
): RulesyncSubagent {
  return new RulesyncSubagent({
    relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    relativeFilePath: fileName,
    frontmatter: { targets: ["*"], ...frontmatter },
    body: "You review code.",
    validate: true,
  });
}

describe("LettacodeSubagent", () => {
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

  it("uses .letta/agents for both scopes", () => {
    expect(LettacodeSubagent.getSettablePaths()).toEqual({ relativeDirPath: agentsDir });
    expect(LettacodeSubagent.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: agentsDir,
    });
  });

  it("writes name, description and the lettacode section as frontmatter", () => {
    const subagent = LettacodeSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: agentsDir,
      rulesyncSubagent: buildRulesyncSubagent({
        name: "reviewer",
        description: "Reviews code",
        lettacode: { tools: "Glob, Grep, Read", model: "sonnet", memoryBlocks: "human, persona" },
      }),
    });

    expect(subagent.getFilePath()).toBe(join(testDir, agentsDir, "reviewer.md"));
    expect(subagent.getFileContent()).toBe(
      [
        "---",
        "name: reviewer",
        "description: Reviews code",
        "tools: Glob, Grep, Read",
        "model: sonnet",
        "memoryBlocks: human, persona",
        "---",
        "You review code.",
        "",
      ].join("\n"),
    );
  });

  it("writes a string YAML would quote as a block scalar, since Letta Code never unquotes", () => {
    const subagent = LettacodeSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: agentsDir,
      rulesyncSubagent: buildRulesyncSubagent({
        name: "reviewer",
        description: "Use when: reviewing # anything",
      }),
    });

    expect(subagent.getFileContent()).toContain(
      "description: |-\n  Use when: reviewing # anything\n---",
    );
  });

  it("warns about names and descriptions Letta Code would skip", () => {
    const logger = createMockLogger();
    LettacodeSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: agentsDir,
      rulesyncSubagent: buildRulesyncSubagent({ name: "Code_Reviewer" }),
      logger,
    });
    LettacodeSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: agentsDir,
      rulesyncSubagent: buildRulesyncSubagent({ name: "codex", description: "Reserved" }),
      logger,
    });

    const messages = vi.mocked(logger.warn).mock.calls.map(([message]) => String(message));
    expect(messages).toEqual([
      expect.stringContaining("must start with a lowercase letter"),
      expect.stringContaining("requires a description"),
      expect.stringContaining("reserved by Letta Code"),
    ]);
  });

  it("imports a subagent file, keeping extra keys under lettacode", async () => {
    await ensureDir(join(testDir, agentsDir));
    await writeFileContent(
      join(testDir, agentsDir, "reviewer.md"),
      "---\nname: reviewer\ndescription: Reviews code\ntools: Read\nmodel: sonnet\n---\n\nYou review code.\n",
    );

    const subagent = await LettacodeSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: "reviewer.md",
    });
    const rulesync = subagent.toRulesyncSubagent();

    expect(rulesync.getFrontmatter()).toEqual({
      targets: ["*"],
      name: "reviewer",
      description: "Reviews code",
      lettacode: { tools: "Read", model: "sonnet" },
    });
    expect(rulesync.getBody()).toBe("You review code.");
  });

  it("is targeted by '*' and by lettacode", () => {
    expect(
      LettacodeSubagent.isTargetedByRulesyncSubagent(buildRulesyncSubagent({ name: "a" })),
    ).toBe(true);
    expect(
      LettacodeSubagent.isTargetedByRulesyncSubagent(
        buildRulesyncSubagent({ name: "a", targets: ["claudecode"] }),
      ),
    ).toBe(false);
  });
});

import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { FirebenderAgentsRegistry, FirebenderSubagent } from "./firebender-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("FirebenderSubagent", () => {
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

  const makeRulesyncSubagent = ({
    relativeFilePath = "code-reviewer.md",
    frontmatter = {},
  }: {
    relativeFilePath?: string;
    frontmatter?: Record<string, unknown>;
  } = {}) =>
    new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath,
      frontmatter: {
        targets: ["*"],
        name: "Code Reviewer",
        description: "Reviews code",
        ...frontmatter,
      },
      body: "You are an expert code reviewer.",
    });

  const splitResult = (files: unknown[]) => ({
    agents: files.filter((file): file is FirebenderSubagent => file instanceof FirebenderSubagent),
    registry: files.find(
      (file): file is FirebenderAgentsRegistry => file instanceof FirebenderAgentsRegistry,
    ),
  });

  it("should use .firebender/agents and declare firebender.json as a shared write", () => {
    expect(FirebenderSubagent.getSettablePaths().relativeDirPath).toBe(
      join(".firebender", "agents"),
    );
    expect(FirebenderSubagent.getExtraSharedWritePaths()).toEqual([
      { relativeDirPath: ".", relativeFilePath: "firebender.json" },
    ]);
    expect(FirebenderSubagent.getExtraSharedWritePaths({ global: true })).toEqual([
      { relativeDirPath: ".firebender", relativeFilePath: "firebender.json" },
    ]);
  });

  it("should write a callable agent file with the firebender section merged in", () => {
    const subagent = FirebenderSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      rulesyncSubagent: makeRulesyncSubagent({
        frontmatter: { firebender: { tools: "read, mcp_github_search", model: "medium" } },
      }),
    });

    expect(subagent.getRelativeDirPath()).toBe(join(".firebender", "agents"));
    expect(subagent.getRelativeFilePath()).toBe("code-reviewer.md");
    expect(subagent.getFrontmatter()).toEqual({
      name: "Code Reviewer",
      description: "Reviews code",
      callable: true,
      tools: "read, mcp_github_search",
      model: "medium",
    });
    expect(subagent.getFileContent()).toContain("callable: true\n");
    expect(subagent.getFileContent()).toContain("You are an expert code reviewer.");
  });

  it("should let the firebender section turn callable off", () => {
    const subagent = FirebenderSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      rulesyncSubagent: makeRulesyncSubagent({ frontmatter: { firebender: { callable: false } } }),
    });

    expect(subagent.getFrontmatter().callable).toBe(false);
  });

  it("should register every generated agent in the project firebender.json", () => {
    const { agents, registry } = splitResult(
      FirebenderSubagent.fromRulesyncSubagents({
        outputRoot: testDir,
        rulesyncSubagents: [
          makeRulesyncSubagent(),
          makeRulesyncSubagent({ relativeFilePath: "test-writer.md" }),
        ],
      }),
    );

    expect(agents).toHaveLength(2);
    expect(registry?.getFilePath()).toBe(join(testDir, "firebender.json"));
    expect(registry?.getEntries()).toEqual([
      ".firebender/agents/code-reviewer.md",
      ".firebender/agents/test-writer.md",
    ]);
    expect(JSON.parse(registry?.getFileContent() ?? "")).toEqual({
      agents: [".firebender/agents/code-reviewer.md", ".firebender/agents/test-writer.md"],
    });
  });

  it("should register global agents relative to ~/.firebender", () => {
    const { registry } = splitResult(
      FirebenderSubagent.fromRulesyncSubagents({
        outputRoot: testDir,
        rulesyncSubagents: [makeRulesyncSubagent()],
        global: true,
      }),
    );

    expect(registry?.getFilePath()).toBe(join(testDir, ".firebender", "firebender.json"));
    expect(registry?.getEntries()).toEqual(["agents/code-reviewer.md"]);
  });

  it("should merge into an existing firebender.json, keeping unmanaged entries and keys", () => {
    const logger = createMockLogger();
    const { registry } = splitResult(
      FirebenderSubagent.fromRulesyncSubagents({
        outputRoot: testDir,
        rulesyncSubagents: [makeRulesyncSubagent()],
        logger,
      }),
    );

    registry?.setFileContent(
      JSON.stringify({
        ignore: ["dist/**"],
        agents: [
          "~/firebender-agents/test-writer.md",
          "./.firebender/agents/stale.md",
          ".firebender/agents/code-reviewer.md",
          "/absolute/path/to/agent.md",
        ],
        mcpServers: { weather: { command: "npx" } },
      }),
    );

    expect(JSON.parse(registry?.getFileContent() ?? "")).toEqual({
      ignore: ["dist/**"],
      agents: [
        "~/firebender-agents/test-writer.md",
        "/absolute/path/to/agent.md",
        ".firebender/agents/code-reviewer.md",
      ],
      mcpServers: { weather: { command: "npx" } },
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain("stale.md");
  });

  it("should retract the agents key when nothing is left to register", () => {
    const { registry } = splitResult(
      FirebenderSubagent.fromRulesyncSubagents({ outputRoot: testDir, rulesyncSubagents: [] }),
    );

    registry?.setFileContent(
      JSON.stringify({ agents: [".firebender/agents/old.md"], useCursorRules: false }),
    );

    expect(JSON.parse(registry?.getFileContent() ?? "")).toEqual({ useCursorRules: false });
    expect(registry?.isDeletable()).toBe(false);
  });

  it("should import an agent file and keep Firebender-only fields in the firebender section", async () => {
    await writeFileContent(
      join(testDir, ".firebender", "agents", "db.md"),
      "---\nname: Database Agent\ndescription: Queries the DB\ntools: read, mcp_postgres_query\nmodel: large\ncolor: '#FF5722'\ncallable: true\n---\n\nYou query databases.\n",
    );

    const subagent = await FirebenderSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: "db.md",
    });
    const rulesyncSubagent = subagent.toRulesyncSubagent();

    expect(rulesyncSubagent.getRelativeFilePath()).toBe("db.md");
    expect(rulesyncSubagent.getFrontmatter()).toMatchObject({
      name: "Database Agent",
      description: "Queries the DB",
      firebender: { tools: "read, mcp_postgres_query", model: "large", color: "#FF5722" },
    });
    expect(rulesyncSubagent.getFrontmatter().firebender).not.toHaveProperty("callable");
    expect(rulesyncSubagent.getBody()).toBe("You query databases.");
  });

  it("should be targeted by firebender and wildcard subagents only", () => {
    expect(
      FirebenderSubagent.isTargetedByRulesyncSubagent(
        makeRulesyncSubagent({ frontmatter: { targets: ["firebender"] } }),
      ),
    ).toBe(true);
    expect(FirebenderSubagent.isTargetedByRulesyncSubagent(makeRulesyncSubagent())).toBe(true);
    expect(
      FirebenderSubagent.isTargetedByRulesyncSubagent(
        makeRulesyncSubagent({ frontmatter: { targets: ["cursor"] } }),
      ),
    ).toBe(false);
  });
});

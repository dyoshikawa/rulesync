import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { AgentsmdSubagent } from "./agentsmd-subagent.js";
import { AntigravityCliSubagent } from "./antigravity-cli-subagent.js";
import { AntigravityIdeSubagent } from "./antigravity-ide-subagent.js";
import { AntigravityPluginSubagent } from "./antigravity-plugin-subagent.js";
import type { AntigravitySharedSubagent } from "./antigravity-shared-subagent.js";
import { GitlabduoSubagent } from "./gitlabduo-subagent.js";
import { MusecodeSubagent } from "./musecode-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

const PROJECT_DIR = join(".agents", "agents");

const buildRulesyncSubagent = ({
  body = "Review the change.",
  ...frontmatter
}: Record<string, unknown> & { body?: string } = {}): RulesyncSubagent =>
  new RulesyncSubagent({
    relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    relativeFilePath: "reviewer.md",
    frontmatter: {
      targets: ["*"],
      name: "reviewer",
      description: "Reviews changes",
      ...frontmatter,
    },
    body,
  });

const createLogger = () =>
  ({ warn: vi.fn() }) as unknown as Logger & { warn: ReturnType<typeof vi.fn> };

const warnings = (logger: ReturnType<typeof createLogger>): string[] =>
  logger.warn.mock.calls.map((call) => String(call[0]));

describe("GitlabduoSubagent", () => {
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

  it("uses the shared project .agents/agents/ directory", () => {
    expect(GitlabduoSubagent.getSettablePaths().relativeDirPath).toBe(PROJECT_DIR);
  });

  it("emits name, description, the gitlabduo tools and the body as the prompt", () => {
    const logger = createLogger();
    const subagent = GitlabduoSubagent.fromRulesyncSubagent({
      relativeDirPath: PROJECT_DIR,
      rulesyncSubagent: buildRulesyncSubagent({
        gitlabduo: { tools: ["read_file", "grep"] },
      }),
      logger,
    }) as AntigravitySharedSubagent;

    expect(subagent.getRelativeDirPath()).toBe(PROJECT_DIR);
    expect(subagent.getRelativeFilePath()).toBe("reviewer.md");
    expect(subagent.getFrontmatter()).toEqual({
      name: "reviewer",
      description: "Reviews changes",
      tools: ["read_file", "grep"],
    });
    expect(subagent.getBody()).toBe("Review the change.");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("renders the shared project file identically to every other writer of it", () => {
    const rulesyncSubagent = buildRulesyncSubagent({
      gitlabduo: { tools: ["read_file"], model: "duo-model" },
      musecode: { effort: "high", model: "muse-ember-1.0" },
      "antigravity-cli": { mainAgent: false },
    });

    const contents = [
      GitlabduoSubagent,
      MusecodeSubagent,
      AntigravityCliSubagent,
      AntigravityIdeSubagent,
      AgentsmdSubagent,
    ].map((SubagentClass) =>
      SubagentClass.fromRulesyncSubagent({
        relativeDirPath: PROJECT_DIR,
        rulesyncSubagent,
      }).getFileContent(),
    );

    expect(new Set(contents).size).toBe(1);
    // The gitlabduo block ranks lowest on a shared key.
    expect(contents[0]).toContain("model: muse-ember-1.0");
    expect(contents[0]).toContain("- read_file");
  });

  it("is not merged into the Antigravity global or plugin files", () => {
    const rulesyncSubagent = buildRulesyncSubagent({ gitlabduo: { tools: ["read_file"] } });
    const antigravityGlobal = AntigravityCliSubagent.fromRulesyncSubagent({
      relativeDirPath: join(".gemini", "config", "agents"),
      rulesyncSubagent,
      global: true,
    }) as AntigravitySharedSubagent;
    expect(antigravityGlobal.getFrontmatter().tools).toBeUndefined();
    const plugin = AntigravityPluginSubagent.fromRulesyncSubagent({
      relativeDirPath: "agents",
      rulesyncSubagent,
    }) as AntigravitySharedSubagent;
    expect(plugin.getFrontmatter().tools).toBeUndefined();
  });

  describe("shared project file warnings", () => {
    it("warns when no tools are set, since Duo then gives the subagent none", () => {
      const logger = createLogger();
      GitlabduoSubagent.fromRulesyncSubagent({
        relativeDirPath: PROJECT_DIR,
        rulesyncSubagent: buildRulesyncSubagent(),
        logger,
      });
      expect(warnings(logger)).toEqual([expect.stringContaining("no 'tools' list is set")]);
    });

    it("warns when tools come from another tool's block", () => {
      const logger = createLogger();
      GitlabduoSubagent.fromRulesyncSubagent({
        relativeDirPath: PROJECT_DIR,
        rulesyncSubagent: buildRulesyncSubagent({ musecode: { tools: ["read"] } }),
        logger,
      });
      expect(warnings(logger)).toEqual([
        expect.stringMatching(/'tools'.*comes from the musecode block/),
      ]);
    });

    it("warns about undocumented keys and about an overridden gitlabduo value", () => {
      const logger = createLogger();
      const rulesyncSubagent = buildRulesyncSubagent({
        gitlabduo: { tools: ["read_file"] },
        "antigravity-cli": { tools: ["view_file"], mainAgent: false },
      });
      const subagent = GitlabduoSubagent.fromRulesyncSubagent({
        relativeDirPath: PROJECT_DIR,
        rulesyncSubagent,
        logger,
      });

      const messages = warnings(logger);
      expect(messages).toHaveLength(3);
      expect(messages[0]).toContain("keys GitLab Duo does not document (mainAgent)");
      expect(messages[1]).toMatch(/'tools'.*comes from the antigravity-cli block/);
      expect(messages[2]).toMatch(
        /'tools' from the gitlabduo block is overridden by the antigravity-cli block/,
      );
      // The file is still the shared one.
      expect(subagent.getFileContent()).toBe(
        AntigravityCliSubagent.fromRulesyncSubagent({
          relativeDirPath: PROJECT_DIR,
          rulesyncSubagent,
        }).getFileContent(),
      );
    });

    it("stays quiet when a higher block repeats the gitlabduo value", () => {
      const logger = createLogger();
      GitlabduoSubagent.fromRulesyncSubagent({
        relativeDirPath: PROJECT_DIR,
        rulesyncSubagent: buildRulesyncSubagent({
          gitlabduo: { tools: ["read_file"] },
          musecode: { tools: ["read_file"] },
        }),
        logger,
      });
      // Only the "tools come from another block" notice: the values are equal.
      expect(warnings(logger)).toEqual([
        expect.stringMatching(/'tools'.*comes from the musecode block/),
      ]);
    });
  });

  describe("limit warnings", () => {
    it("warns about a name, description or prompt over Duo's limits", () => {
      const logger = createLogger();
      GitlabduoSubagent.fromRulesyncSubagent({
        relativeDirPath: PROJECT_DIR,
        rulesyncSubagent: buildRulesyncSubagent({
          name: "n".repeat(65),
          description: "d".repeat(1025),
          body: "p".repeat(10_001),
          gitlabduo: { tools: ["read_file"] },
        }),
        logger,
      });
      const messages = warnings(logger);
      expect(messages).toHaveLength(3);
      expect(messages[0]).toContain("the name is 65 characters, over GitLab Duo's limit of 64");
      expect(messages[1]).toContain(
        "the description is 1025 characters, over GitLab Duo's limit of 1024",
      );
      expect(messages[2]).toContain(
        "the prompt is 10001 characters, over GitLab Duo's limit of 10000",
      );
    });

    it("stays quiet at exactly the limits", () => {
      const logger = createLogger();
      GitlabduoSubagent.fromRulesyncSubagent({
        relativeDirPath: PROJECT_DIR,
        rulesyncSubagent: buildRulesyncSubagent({
          name: "n".repeat(64),
          description: "d".repeat(1024),
          body: "p".repeat(10_000),
          gitlabduo: { tools: ["read_file"] },
        }),
        logger,
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("warns when the rendered file is over 64 KB", () => {
      const logger = createLogger();
      GitlabduoSubagent.fromRulesyncSubagent({
        relativeDirPath: PROJECT_DIR,
        rulesyncSubagent: buildRulesyncSubagent({
          // Multi-byte characters: under the prompt's character limit, over 64 KB.
          body: "あ".repeat(9_000),
          gitlabduo: { tools: ["read_file"], notes: "x".repeat(40_000) },
        }),
        logger,
      });
      const messages = warnings(logger);
      expect(messages.some((message) => message.includes("over GitLab Duo's 64 KB limit"))).toBe(
        true,
      );
    });
  });

  it("imports a project agent file into the gitlabduo section", async () => {
    await writeFileContent(
      join(testDir, PROJECT_DIR, "reviewer.md"),
      "---\nname: reviewer\ndescription: Reviews changes\ntools:\n  - read_file\n---\nReview the change.\n",
    );

    const subagent = await GitlabduoSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: "reviewer.md",
    });
    const rulesyncSubagent = subagent.toRulesyncSubagent();

    expect(rulesyncSubagent.getFrontmatter().name).toBe("reviewer");
    expect(rulesyncSubagent.getFrontmatter().description).toBe("Reviews changes");
    expect(rulesyncSubagent.getFrontmatter().gitlabduo).toEqual({ tools: ["read_file"] });
    expect(rulesyncSubagent.getBody()).toBe("Review the change.");
  });

  it("answers to the wildcard and its own target only", () => {
    expect(GitlabduoSubagent.isTargetedByRulesyncSubagent(buildRulesyncSubagent())).toBe(true);
    expect(
      GitlabduoSubagent.isTargetedByRulesyncSubagent(
        buildRulesyncSubagent({ targets: ["gitlabduo"] }),
      ),
    ).toBe(true);
    expect(
      GitlabduoSubagent.isTargetedByRulesyncSubagent(
        buildRulesyncSubagent({ targets: ["antigravity-cli"] }),
      ),
    ).toBe(false);
  });
});

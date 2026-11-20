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
import { MusecodeSubagent } from "./musecode-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

const PROJECT_DIR = join(".agents", "agents");
const GLOBAL_DIR = join(".config", "muse", "agents");

const buildRulesyncSubagent = (frontmatter: Record<string, unknown> = {}): RulesyncSubagent =>
  new RulesyncSubagent({
    relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    relativeFilePath: "test-writer.md",
    frontmatter: {
      targets: ["*"],
      name: "test-writer",
      description: "Writes tests",
      ...frontmatter,
    },
    body: "Write focused tests.",
  });

const createLogger = () =>
  ({ warn: vi.fn() }) as unknown as Logger & { warn: ReturnType<typeof vi.fn> };

describe("MusecodeSubagent", () => {
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

  it("uses the shared project dir and the XDG-default user agents dir", () => {
    expect(MusecodeSubagent.getSettablePaths().relativeDirPath).toBe(PROJECT_DIR);
    expect(MusecodeSubagent.getSettablePaths({ global: true }).relativeDirPath).toBe(GLOBAL_DIR);
  });

  it("emits name, description, the musecode section and the body as the prompt", () => {
    const subagent = MusecodeSubagent.fromRulesyncSubagent({
      relativeDirPath: PROJECT_DIR,
      rulesyncSubagent: buildRulesyncSubagent({
        musecode: {
          model: "muse-ember-1.0",
          effort: "medium",
          tools: ["read"],
          disallowedTools: ["shell"],
        },
      }),
    }) as AntigravitySharedSubagent;

    expect(subagent.getRelativeDirPath()).toBe(PROJECT_DIR);
    expect(subagent.getRelativeFilePath()).toBe("test-writer.md");
    expect(subagent.getFrontmatter()).toEqual({
      name: "test-writer",
      description: "Writes tests",
      model: "muse-ember-1.0",
      effort: "medium",
      tools: ["read"],
      disallowedTools: ["shell"],
    });
    expect(subagent.getBody()).toBe("Write focused tests.");
  });

  it("renders the shared project file identically to every other writer of it", () => {
    const rulesyncSubagent = buildRulesyncSubagent({
      musecode: { effort: "high", model: "muse-ember-1.0" },
      "antigravity-ide": { mainAgent: false },
      "antigravity-cli": { model: "pro" },
    });

    const contents = [
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
    // The Antigravity blocks rank above the musecode block on a shared key.
    expect(contents[0]).toContain("model: pro");
    expect(contents[0]).toContain("effort: high");
    expect(contents[0]).toContain("mainAgent: false");
  });

  it("merges only the musecode section into the user agents dir", () => {
    const rulesyncSubagent = buildRulesyncSubagent({
      musecode: { effort: "low" },
      "antigravity-cli": { model: "pro", mainAgent: false },
    });

    const subagent = MusecodeSubagent.fromRulesyncSubagent({
      relativeDirPath: GLOBAL_DIR,
      rulesyncSubagent,
      global: true,
    }) as AntigravitySharedSubagent;

    expect(subagent.getRelativeDirPath()).toBe(GLOBAL_DIR);
    expect(subagent.getFrontmatter()).toEqual({
      name: "test-writer",
      description: "Writes tests",
      effort: "low",
    });

    // Neither do the Antigravity global and plugin files pick up the musecode block.
    const antigravityGlobal = AntigravityCliSubagent.fromRulesyncSubagent({
      relativeDirPath: join(".gemini", "config", "agents"),
      rulesyncSubagent,
      global: true,
    }) as AntigravitySharedSubagent;
    expect(antigravityGlobal.getFrontmatter().effort).toBeUndefined();
    const plugin = AntigravityPluginSubagent.fromRulesyncSubagent({
      relativeDirPath: "agents",
      rulesyncSubagent,
    }) as AntigravitySharedSubagent;
    expect(plugin.getFrontmatter().effort).toBeUndefined();
  });

  it("warns when the name is not lowercase words joined by single hyphens", () => {
    const logger = createLogger();
    MusecodeSubagent.fromRulesyncSubagent({
      relativeDirPath: PROJECT_DIR,
      rulesyncSubagent: buildRulesyncSubagent({ name: "Test_Writer" }),
      logger,
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain("Test_Writer");

    const quiet = createLogger();
    MusecodeSubagent.fromRulesyncSubagent({
      relativeDirPath: PROJECT_DIR,
      rulesyncSubagent: buildRulesyncSubagent(),
      logger: quiet,
    });
    expect(quiet.warn).not.toHaveBeenCalled();
  });

  describe("shared project file warnings", () => {
    it("warns about keys Muse Code does not document without changing the file", () => {
      const logger = createLogger();
      const rulesyncSubagent = buildRulesyncSubagent({
        musecode: { effort: "high" },
        "antigravity-cli": { mainAgent: false, commandExecutionPolicy: "off" },
      });
      const subagent = MusecodeSubagent.fromRulesyncSubagent({
        relativeDirPath: PROJECT_DIR,
        rulesyncSubagent,
        logger,
      });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]?.[0]).toContain("mainAgent, commandExecutionPolicy");
      expect(logger.warn.mock.calls[0]?.[0]).toContain("set in a musecode or antigravity-* block");
      expect(subagent.getFileContent()).toBe(
        AntigravityCliSubagent.fromRulesyncSubagent({
          relativeDirPath: PROJECT_DIR,
          rulesyncSubagent,
        }).getFileContent(),
      );
    });

    it("warns about an undocumented key set in the musecode block itself", () => {
      const logger = createLogger();
      MusecodeSubagent.fromRulesyncSubagent({
        relativeDirPath: PROJECT_DIR,
        rulesyncSubagent: buildRulesyncSubagent({ musecode: { temperature: 0.2 } }),
        logger,
      });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      const message = logger.warn.mock.calls[0]?.[0] as string;
      expect(message).toContain("temperature");
      expect(message).toContain("set in a musecode or antigravity-* block");
    });

    it("warns when an antigravity block overrides a musecode block value", () => {
      const logger = createLogger();
      MusecodeSubagent.fromRulesyncSubagent({
        relativeDirPath: PROJECT_DIR,
        rulesyncSubagent: buildRulesyncSubagent({
          musecode: { model: "muse-ember-1.0", effort: "low" },
          "antigravity-ide": { model: "flash" },
          "antigravity-cli": { model: "pro" },
        }),
        logger,
      });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      const message = logger.warn.mock.calls[0]?.[0] as string;
      expect(message).toContain("'model'");
      // The block that actually wins in the merge is named.
      expect(message).toContain("antigravity-cli");
    });

    it("stays quiet for equal values, documented keys and the global file", () => {
      const quiet = createLogger();
      MusecodeSubagent.fromRulesyncSubagent({
        relativeDirPath: PROJECT_DIR,
        rulesyncSubagent: buildRulesyncSubagent({
          musecode: { model: "shared-model", tools: ["read"] },
          "antigravity-cli": { model: "shared-model" },
        }),
        logger: quiet,
      });
      expect(quiet.warn).not.toHaveBeenCalled();

      const global = createLogger();
      MusecodeSubagent.fromRulesyncSubagent({
        relativeDirPath: GLOBAL_DIR,
        rulesyncSubagent: buildRulesyncSubagent({
          musecode: { model: "muse-ember-1.0" },
          "antigravity-cli": { model: "pro", mainAgent: false },
        }),
        logger: global,
        global: true,
      });
      expect(global.warn).not.toHaveBeenCalled();
    });
  });

  it("imports a user agent file into the musecode section", async () => {
    await writeFileContent(
      join(testDir, GLOBAL_DIR, "test-writer.md"),
      "---\nname: test-writer\ndescription: Writes tests\neffort: medium\ndisallowedTools:\n  - shell\n---\nWrite focused tests.\n",
    );

    const subagent = await MusecodeSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: "test-writer.md",
      global: true,
    });
    const rulesyncFrontmatter = subagent.toRulesyncSubagent().getFrontmatter();

    expect(rulesyncFrontmatter.name).toBe("test-writer");
    expect(rulesyncFrontmatter.description).toBe("Writes tests");
    expect(rulesyncFrontmatter.musecode).toEqual({
      effort: "medium",
      disallowedTools: ["shell"],
    });
    expect(subagent.toRulesyncSubagent().getBody()).toBe("Write focused tests.");
  });

  it("answers to the wildcard and its own target only", () => {
    expect(MusecodeSubagent.isTargetedByRulesyncSubagent(buildRulesyncSubagent())).toBe(true);
    expect(
      MusecodeSubagent.isTargetedByRulesyncSubagent(
        buildRulesyncSubagent({ targets: ["musecode"] }),
      ),
    ).toBe(true);
    expect(
      MusecodeSubagent.isTargetedByRulesyncSubagent(
        buildRulesyncSubagent({ targets: ["antigravity-cli"] }),
      ),
    ).toBe(false);
  });
});

import { join } from "node:path";

import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { PoolSubagent, sanitizePoolAgentFileStem } from "./pool-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

function makeRulesyncSubagent({
  testDir,
  relativeFilePath = "planner.md",
  frontmatter,
  body = "You are the planner.",
  validate = true,
}: {
  testDir: string;
  relativeFilePath?: string;
  frontmatter: Record<string, unknown>;
  body?: string;
  validate?: boolean;
}): RulesyncSubagent {
  return new RulesyncSubagent({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    relativeFilePath,
    frontmatter: frontmatter as never,
    body,
    validate,
  });
}

function parseSettings(content: string): Record<string, unknown> {
  return (load(content) ?? {}) as Record<string, unknown>;
}

describe("PoolSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("writes .poolside/settings.yaml at project scope", () => {
      expect(PoolSubagent.getSettablePaths()).toEqual({
        relativeDirPath: ".poolside",
        relativeFilePath: "settings.yaml",
      });
    });

    it("writes ~/.config/poolside/settings.yaml at global scope", () => {
      expect(PoolSubagent.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".config", "poolside"),
        relativeFilePath: "settings.yaml",
      });
    });
  });

  describe("fromRulesyncSubagents", () => {
    it("collapses every subagent into subagents.agents with the body as instructions", () => {
      const subagent = PoolSubagent.fromRulesyncSubagents({
        outputRoot: testDir,
        rulesyncSubagents: [
          makeRulesyncSubagent({
            testDir,
            frontmatter: { name: "planner", description: "Plans tasks" },
            body: "You are the planner.\n",
          }),
          makeRulesyncSubagent({
            testDir,
            relativeFilePath: "reviewer.md",
            frontmatter: { name: "reviewer", description: "Reviews changes" },
            body: "Inspect the diff.",
          }),
        ],
      });

      expect(subagent.getRelativeDirPath()).toBe(".poolside");
      expect(subagent.getRelativeFilePath()).toBe("settings.yaml");
      expect(subagent.isDeletable()).toBe(false);
      expect(subagent.shouldMergeExistingFileContent()).toBe(true);
      expect(parseSettings(subagent.getFileContent())).toEqual({
        subagents: {
          agents: {
            planner: {
              type: "in_process",
              description: "Plans tasks",
              instructions: "You are the planner.",
            },
            reviewer: {
              type: "in_process",
              description: "Reviews changes",
              instructions: "Inspect the diff.",
            },
          },
        },
      });
      // `type` leads each entry, the way Pool's docs spell one.
      expect(subagent.getFileContent()).toContain("    planner:\n      type: in_process\n");
    });

    it("applies the pool section for the type-specific keys and overrides", () => {
      const subagent = PoolSubagent.fromRulesyncSubagents({
        outputRoot: testDir,
        rulesyncSubagents: [
          makeRulesyncSubagent({
            testDir,
            frontmatter: {
              name: "runner",
              description: "Shared description",
              pool: {
                type: "command",
                description: "Pool description",
                instructions: "Pool instructions",
                command: "my-agent",
                args: ["--acp"],
                env: { LOG_LEVEL: "debug" },
                inherit_agent_config: true,
                extra_key: "kept",
              },
            },
          }),
        ],
      });

      expect(parseSettings(subagent.getFileContent())).toEqual({
        subagents: {
          agents: {
            runner: {
              type: "command",
              description: "Pool description",
              instructions: "Pool instructions",
              command: "my-agent",
              args: ["--acp"],
              env: { LOG_LEVEL: "debug" },
              inherit_agent_config: true,
              extra_key: "kept",
            },
          },
        },
      });
    });

    it("omits instructions for an empty body and warns about a missing description", () => {
      const logger = createMockLogger();
      const subagent = PoolSubagent.fromRulesyncSubagents({
        outputRoot: testDir,
        rulesyncSubagents: [
          makeRulesyncSubagent({ testDir, frontmatter: { name: "bare" }, body: "" }),
        ],
        logger,
      });

      expect(parseSettings(subagent.getFileContent())).toEqual({
        subagents: { agents: { bare: { type: "in_process" } } },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('"bare" has no description'),
      );
    });

    it("does not warn about a missing description on a disabled agent", () => {
      const logger = createMockLogger();
      PoolSubagent.fromRulesyncSubagents({
        outputRoot: testDir,
        rulesyncSubagents: [
          makeRulesyncSubagent({ testDir, frontmatter: { name: "off", pool: { disabled: true } } }),
        ],
        logger,
      });

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("skips the reserved general agent with a warning", () => {
      const logger = createMockLogger();
      const subagent = PoolSubagent.fromRulesyncSubagents({
        outputRoot: testDir,
        rulesyncSubagents: [
          makeRulesyncSubagent({
            testDir,
            relativeFilePath: "general.md",
            frontmatter: { name: "general", description: "Built-in" },
          }),
          makeRulesyncSubagent({
            testDir,
            frontmatter: { name: "planner", description: "Plans tasks" },
          }),
        ],
        logger,
      });

      expect(Object.keys(subagent.getAgents())).toEqual(["planner"]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('"general" was skipped: "general" is Pool\'s built-in agent'),
      );
    });

    it("keeps the last definition of a repeated name with a warning", () => {
      const logger = createMockLogger();
      const subagent = PoolSubagent.fromRulesyncSubagents({
        outputRoot: testDir,
        rulesyncSubagents: [
          makeRulesyncSubagent({
            testDir,
            relativeFilePath: "a.md",
            frontmatter: { name: "planner", description: "First" },
          }),
          makeRulesyncSubagent({
            testDir,
            relativeFilePath: "b.md",
            frontmatter: { name: "planner", description: "Second" },
          }),
        ],
        logger,
      });

      expect(subagent.getAgents().planner?.description).toBe("Second");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('"planner" is defined more than once'),
      );
    });

    it("rejects an invalid pool section", () => {
      // The rulesync frontmatter schema already rejects this on load; skip that
      // validation so the adapter's own guard is the one exercised.
      expect(() =>
        PoolSubagent.fromRulesyncSubagents({
          outputRoot: testDir,
          rulesyncSubagents: [
            makeRulesyncSubagent({
              testDir,
              frontmatter: { name: "planner", description: "x", pool: { type: "remote" } },
              validate: false,
            }),
          ],
        }),
      ).toThrow('Invalid "pool" section of subagent "planner"');
    });

    it("targets the global settings file when global is set", () => {
      const subagent = PoolSubagent.fromRulesyncSubagents({
        outputRoot: testDir,
        rulesyncSubagents: [
          makeRulesyncSubagent({ testDir, frontmatter: { name: "planner", description: "x" } }),
        ],
        global: true,
      });

      expect(subagent.getRelativeDirPath()).toBe(join(".config", "poolside"));
      expect(subagent.getRelativeFilePath()).toBe("settings.yaml");
      expect(parseSettings(subagent.getFileContent()).subagents).toBeDefined();
    });
  });

  describe("setFileContent (merge into an existing settings file)", () => {
    it("preserves other keys, subagents.default and the general agent while replacing the rest", () => {
      const subagent = PoolSubagent.fromRulesyncSubagents({
        outputRoot: testDir,
        rulesyncSubagents: [
          makeRulesyncSubagent({ testDir, frontmatter: { name: "planner", description: "Plans" } }),
        ],
      });

      subagent.setFileContent(
        [
          "pool:",
          "  model: gpt",
          "mcp_servers:",
          "  github:",
          "    command: gh-mcp",
          "subagents:",
          "  default: stale",
          "  agents:",
          "    general:",
          "      type: in_process",
          "      inherit_agent_config: false",
          "    stale:",
          "      type: in_process",
          "      description: Gone from rulesync",
          "",
        ].join("\n"),
      );

      expect(parseSettings(subagent.getFileContent())).toEqual({
        pool: { model: "gpt" },
        mcp_servers: { github: { command: "gh-mcp" } },
        subagents: {
          default: "stale",
          agents: {
            general: { type: "in_process", inherit_agent_config: false },
            planner: {
              type: "in_process",
              description: "Plans",
              instructions: "You are the planner.",
            },
          },
        },
      });
    });

    it("retracts the agents map when nothing is generated and keeps the block's siblings", () => {
      const subagent = PoolSubagent.fromRulesyncSubagents({
        outputRoot: testDir,
        rulesyncSubagents: [],
      });

      subagent.setFileContent(
        "subagents:\n  default: general\n  agents:\n    stale:\n      type: in_process\n",
      );
      expect(parseSettings(subagent.getFileContent())).toEqual({
        subagents: { default: "general" },
      });

      subagent.setFileContent(
        "subagents:\n  agents:\n    stale:\n      type: in_process\npool:\n  model: gpt\n",
      );
      expect(parseSettings(subagent.getFileContent())).toEqual({ pool: { model: "gpt" } });
    });

    it("yields an empty document for an empty payload on a missing file", () => {
      const subagent = PoolSubagent.fromRulesyncSubagents({
        outputRoot: testDir,
        rulesyncSubagents: [],
      });

      expect(parseSettings(subagent.getFileContent())).toEqual({});
    });

    it("fails closed on a settings file whose root is not a mapping", () => {
      const subagent = PoolSubagent.fromRulesyncSubagents({
        outputRoot: testDir,
        rulesyncSubagents: [
          makeRulesyncSubagent({ testDir, frontmatter: { name: "planner", description: "x" } }),
        ],
      });

      expect(() => subagent.setFileContent("- not\n- a mapping\n")).toThrow();
    });
  });

  describe("fromFile / toRulesyncSubagents", () => {
    it("fans the custom agents out to rulesync subagents, skipping general", async () => {
      await writeFileContent(
        join(testDir, ".poolside", "settings.yaml"),
        [
          "subagents:",
          "  default: reviewer",
          "  agents:",
          "    general:",
          "      type: in_process",
          "      instructions: Built-in tweaks",
          "    reviewer:",
          "      type: in_process",
          "      description: Reviews changes for correctness.",
          "      instructions: Inspect diff and tests.",
          "    runner:",
          "      type: command",
          "      description: External ACP agent",
          "      command: my-agent",
          "      args: [--acp]",
          "      disabled: true",
          "    broken: not-a-mapping",
          "",
        ].join("\n"),
      );

      const subagent = await PoolSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "settings.yaml",
      });
      const rulesyncSubagents = subagent.toRulesyncSubagents();

      expect(rulesyncSubagents.map((s) => s.getRelativeFilePath())).toEqual([
        "reviewer.md",
        "runner.md",
      ]);
      expect(rulesyncSubagents[0]?.getFrontmatter()).toEqual({
        targets: ["pool"],
        name: "reviewer",
        description: "Reviews changes for correctness.",
      });
      expect(rulesyncSubagents[0]?.getBody()).toBe("Inspect diff and tests.");
      expect(rulesyncSubagents[1]?.getFrontmatter()).toEqual({
        targets: ["pool"],
        name: "runner",
        description: "External ACP agent",
        pool: { type: "command", command: "my-agent", args: ["--acp"], disabled: true },
      });
      expect(rulesyncSubagents[1]?.getBody()).toBe("");
      expect(subagent.toRulesyncSubagent().getFrontmatter().name).toBe("reviewer");
    });

    it("sanitizes the agent name before using it as a file stem", async () => {
      await writeFileContent(
        join(testDir, ".poolside", "settings.yaml"),
        "subagents:\n  agents:\n    '../escape me':\n      type: in_process\n      description: x\n",
      );

      const subagent = await PoolSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "settings.yaml",
      });
      const [imported] = subagent.toRulesyncSubagents();

      expect(imported?.getRelativeFilePath()).toBe("escape-me.md");
      expect(imported?.getFrontmatter().name).toBe("../escape me");
    });

    it("skips prototype-pollution agent names", async () => {
      await writeFileContent(
        join(testDir, ".poolside", "settings.yaml"),
        "subagents:\n  agents:\n    __proto__:\n      type: in_process\n    constructor:\n      type: in_process\n",
      );

      const subagent = await PoolSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "settings.yaml",
      });

      expect(subagent.getAgents()).toEqual({});
      expect(() => subagent.toRulesyncSubagent()).toThrow("No custom subagents found");
    });

    it("warns through the given logger about an entry it skips", async () => {
      await writeFileContent(
        join(testDir, ".poolside", "settings.yaml"),
        ["subagents:", "  agents:", "    broken: not-a-mapping", ""].join("\n"),
      );
      const logger = createMockLogger();

      const subagent = await PoolSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "settings.yaml",
        logger,
      });

      expect(subagent.toRulesyncSubagents()).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Skipped Pool subagent "broken"'),
      );
    });

    it("reads a settings file without a subagents block as empty", async () => {
      await writeFileContent(join(testDir, ".poolside", "settings.yaml"), "pool:\n  model: gpt\n");

      const subagent = await PoolSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "settings.yaml",
      });

      expect(subagent.toRulesyncSubagents()).toEqual([]);
    });

    it("round-trips a generated file", async () => {
      const generated = PoolSubagent.fromRulesyncSubagents({
        outputRoot: testDir,
        rulesyncSubagents: [
          makeRulesyncSubagent({
            testDir,
            frontmatter: {
              name: "planner",
              description: "Plans tasks",
              pool: { inherit_agent_config: true },
            },
            body: "Plan carefully.",
          }),
        ],
      });
      await writeFileContent(
        join(testDir, ".poolside", "settings.yaml"),
        generated.getFileContent(),
      );

      const imported = await PoolSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "settings.yaml",
      });
      const [rulesyncSubagent] = imported.toRulesyncSubagents();

      expect(rulesyncSubagent?.getFrontmatter()).toEqual({
        targets: ["pool"],
        name: "planner",
        description: "Plans tasks",
        pool: { inherit_agent_config: true },
      });
      expect(rulesyncSubagent?.getBody()).toBe("Plan carefully.");
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("targets pool by wildcard or by name", () => {
      expect(
        PoolSubagent.isTargetedByRulesyncSubagent(
          makeRulesyncSubagent({ testDir, frontmatter: { name: "a", targets: ["*"] } }),
        ),
      ).toBe(true);
      expect(
        PoolSubagent.isTargetedByRulesyncSubagent(
          makeRulesyncSubagent({ testDir, frontmatter: { name: "a", targets: ["pool"] } }),
        ),
      ).toBe(true);
      expect(
        PoolSubagent.isTargetedByRulesyncSubagent(
          makeRulesyncSubagent({ testDir, frontmatter: { name: "a", targets: ["roo"] } }),
        ),
      ).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("returns an undeletable placeholder", () => {
      const subagent = PoolSubagent.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".poolside",
        relativeFilePath: "settings.yaml",
      });

      expect(subagent.isDeletable()).toBe(false);
      expect(subagent.getAgents()).toEqual({});
      expect(subagent.validate()).toEqual({ success: true, error: null });
    });
  });

  describe("sanitizePoolAgentFileStem", () => {
    it("keeps safe names and narrows the rest", () => {
      expect(sanitizePoolAgentFileStem("code_reviewer-2")).toBe("code_reviewer-2");
      expect(sanitizePoolAgentFileStem("../x/../y")).toBe("x-y");
      expect(sanitizePoolAgentFileStem("...")).toBe("agent");
    });
  });
});

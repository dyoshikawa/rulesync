import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { ClaudecodePluginSubagent } from "./claudecode-plugin-subagent.js";
import { ClaudecodeSubagent } from "./claudecode-subagent.js";
import { RulesyncSubagent, type RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import { SubagentsProcessor } from "./subagents-processor.js";

const logger = createMockLogger();

const buildRulesyncSubagent = ({
  name = "reviewer",
  claudecode,
}: {
  name?: string;
  claudecode?: Record<string, unknown>;
}): RulesyncSubagent => {
  const frontmatter: RulesyncSubagentFrontmatter = {
    targets: ["*"],
    name,
    description: "A test agent",
    ...(claudecode && { claudecode }),
  };
  return new RulesyncSubagent({
    outputRoot: ".",
    relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    relativeFilePath: `${name}.md`,
    frontmatter,
    body: "Do the thing.",
    validate: false,
  });
};

const generate = ({
  outputRoot,
  rulesyncSubagent,
}: {
  outputRoot: string;
  rulesyncSubagent: RulesyncSubagent;
}) =>
  ClaudecodePluginSubagent.fromRulesyncSubagent({
    outputRoot,
    relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    rulesyncSubagent,
    logger,
  });

describe("ClaudecodePluginSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should write agents into the plugin agents directory", () => {
      expect(ClaudecodePluginSubagent.getSettablePaths()).toEqual({ relativeDirPath: "agents" });
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should drop hooks, mcpServers, and permissionMode with a warning", () => {
      const subagent = generate({
        outputRoot: testDir,
        rulesyncSubagent: buildRulesyncSubagent({
          claudecode: {
            model: "haiku",
            permissionMode: "acceptEdits",
            hooks: { SessionStart: [] },
            mcpServers: {},
          },
        }),
      });

      const { frontmatter } = parseFrontmatter(subagent.getFileContent(), "agents/reviewer.md");
      expect(frontmatter).not.toHaveProperty("permissionMode");
      expect(frontmatter).not.toHaveProperty("hooks");
      expect(frontmatter).not.toHaveProperty("mcpServers");
      // Supported fields are untouched.
      expect(frontmatter).toMatchObject({ name: "reviewer", model: "haiku" });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("hooks, mcpServers, permissionMode"),
      );
    });

    it("should keep isolation when it is worktree", () => {
      const subagent = generate({
        outputRoot: testDir,
        rulesyncSubagent: buildRulesyncSubagent({ claudecode: { isolation: "worktree" } }),
      });

      const { frontmatter } = parseFrontmatter(subagent.getFileContent(), "agents/reviewer.md");
      expect(frontmatter).toMatchObject({ isolation: "worktree" });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should drop any other isolation value with a warning", () => {
      const subagent = generate({
        outputRoot: testDir,
        rulesyncSubagent: buildRulesyncSubagent({ claudecode: { isolation: "sandbox" } }),
      });

      const { frontmatter } = parseFrontmatter(subagent.getFileContent(), "agents/reviewer.md");
      expect(frontmatter).not.toHaveProperty("isolation");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('isolation "sandbox"'));
    });

    it("should warn about a name containing the plugin namespace separator", () => {
      const subagent = generate({
        outputRoot: testDir,
        rulesyncSubagent: buildRulesyncSubagent({ name: "my-plugin:reviewer" }),
      });

      expect(subagent.getFileContent()).toContain("my-plugin:reviewer");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("reserved for plugin namespacing"),
      );
    });

    it("should warn about only the forbidden field that is actually present", () => {
      generate({
        outputRoot: testDir,
        rulesyncSubagent: buildRulesyncSubagent({ claudecode: { permissionMode: "plan" } }),
      });

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Dropping permissionMode"));
      expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("mcpServers"));
    });
  });

  describe("SubagentsProcessor wiring", () => {
    it("should surface the drop warning when generating through the processor", async () => {
      const processorLogger = createMockLogger();
      const processor = new SubagentsProcessor({
        logger: processorLogger,
        outputRoot: testDir,
        toolTarget: "claudecode-plugin",
      });

      await processor.convertRulesyncFilesToToolFiles([
        buildRulesyncSubagent({ claudecode: { permissionMode: "acceptEdits" } }),
      ]);

      expect(processorLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Dropping permissionMode"),
      );
    });
  });

  describe("non-plugin claudecode output", () => {
    it("should still emit the fields that are forbidden only for plugin agents", () => {
      const subagent = ClaudecodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        rulesyncSubagent: buildRulesyncSubagent({
          claudecode: { permissionMode: "acceptEdits", isolation: "sandbox" },
        }),
        logger,
      });

      const { frontmatter } = parseFrontmatter(
        subagent.getFileContent(),
        ".claude/agents/reviewer.md",
      );
      expect(frontmatter).toMatchObject({ permissionMode: "acceptEdits", isolation: "sandbox" });
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});

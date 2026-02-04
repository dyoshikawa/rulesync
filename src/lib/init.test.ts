import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../constants/general.js";
import {
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { RulesyncCommand } from "../features/commands/rulesync-command.js";
import { RulesyncHooks } from "../features/hooks/rulesync-hooks.js";
import { RulesyncIgnore } from "../features/ignore/rulesync-ignore.js";
import { RulesyncMcp } from "../features/mcp/rulesync-mcp.js";
import { RulesyncRule } from "../features/rules/rulesync-rule.js";
import { RulesyncSkill } from "../features/skills/rulesync-skill.js";
import { RulesyncSubagent } from "../features/subagents/rulesync-subagent.js";
import { ensureDir, fileExists, writeFileContent } from "../utils/file.js";
import { init } from "./init.js";

vi.mock("../utils/file.js");
vi.mock("../features/commands/rulesync-command.js");
vi.mock("../features/hooks/rulesync-hooks.js");
vi.mock("../features/ignore/rulesync-ignore.js");
vi.mock("../features/mcp/rulesync-mcp.js");
vi.mock("../features/rules/rulesync-rule.js");
vi.mock("../features/skills/rulesync-skill.js");
vi.mock("../features/subagents/rulesync-subagent.js");

describe("init", () => {
  beforeEach(() => {
    vi.mocked(ensureDir).mockResolvedValue(undefined);
    vi.mocked(fileExists).mockResolvedValue(false);
    vi.mocked(writeFileContent).mockResolvedValue(undefined);

    vi.mocked(RulesyncRule.getSettablePaths).mockReturnValue({
      recommended: { relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH },
    } as never);
    vi.mocked(RulesyncMcp.getSettablePaths).mockReturnValue({
      recommended: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
      },
      legacy: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
      },
    } as never);
    vi.mocked(RulesyncCommand.getSettablePaths).mockReturnValue({
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
    } as never);
    vi.mocked(RulesyncSubagent.getSettablePaths).mockReturnValue({
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    } as never);
    vi.mocked(RulesyncSkill.getSettablePaths).mockReturnValue({
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
    } as never);
    vi.mocked(RulesyncIgnore.getSettablePaths).mockReturnValue({
      recommended: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_FILE_NAME,
      },
      legacy: {
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
      },
    } as never);
    vi.mocked(RulesyncHooks.getSettablePaths).mockReturnValue({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "hooks.json",
    } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("return value", () => {
    it("should return InitResult with configFile and sampleFiles", async () => {
      const result = await init();

      expect(result).toHaveProperty("configFile");
      expect(result).toHaveProperty("sampleFiles");
      expect(result.configFile).toHaveProperty("created");
      expect(result.configFile).toHaveProperty("path");
      expect(Array.isArray(result.sampleFiles)).toBe(true);
    });

    it("should return created: true for new files", async () => {
      vi.mocked(fileExists).mockResolvedValue(false);

      const result = await init();

      expect(result.configFile.created).toBe(true);
      expect(result.sampleFiles.every((f) => f.created)).toBe(true);
    });

    it("should return created: false for existing files", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);

      const result = await init();

      expect(result.configFile.created).toBe(false);
      expect(result.sampleFiles.every((f) => f.created === false)).toBe(true);
    });

    it("should return correct paths for all files", async () => {
      const result = await init();

      expect(result.configFile.path).toBe(RULESYNC_CONFIG_RELATIVE_FILE_PATH);

      const expectedPaths = [
        join(RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
        join(RULESYNC_RELATIVE_DIR_PATH, "mcp.json"),
        join(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review-pr.md"),
        join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
        join(RULESYNC_SKILLS_RELATIVE_DIR_PATH, "project-context", SKILL_FILE_NAME),
        join(RULESYNC_RELATIVE_DIR_PATH, RULESYNC_AIIGNORE_FILE_NAME),
        join(RULESYNC_RELATIVE_DIR_PATH, "hooks.json"),
      ];

      const actualPaths = result.sampleFiles.map((f) => f.path);
      for (const path of expectedPaths) {
        expect(actualPaths).toContain(path);
      }
    });
  });

  describe("directory creation", () => {
    it("should ensure all required directories exist", async () => {
      await init();

      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_RELATIVE_DIR_PATH);
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      expect(ensureDir).toHaveBeenCalledWith(
        join(RULESYNC_SKILLS_RELATIVE_DIR_PATH, "project-context"),
      );
    });
  });

  describe("config file creation", () => {
    it("should create config file with correct content", async () => {
      vi.mocked(fileExists).mockResolvedValue(false);

      await init();

      expect(writeFileContent).toHaveBeenCalledWith(
        RULESYNC_CONFIG_RELATIVE_FILE_PATH,
        expect.stringContaining('"targets"'),
      );
      expect(writeFileContent).toHaveBeenCalledWith(
        RULESYNC_CONFIG_RELATIVE_FILE_PATH,
        expect.stringContaining('"features"'),
      );
    });

    it("should not create config file if it already exists", async () => {
      vi.mocked(fileExists).mockImplementation(async (path) => {
        return path === RULESYNC_CONFIG_RELATIVE_FILE_PATH;
      });

      const result = await init();

      expect(result.configFile.created).toBe(false);
      const configWriteCalls = vi
        .mocked(writeFileContent)
        .mock.calls.filter((call) => call[0] === RULESYNC_CONFIG_RELATIVE_FILE_PATH);
      expect(configWriteCalls.length).toBe(0);
    });
  });

  describe("sample file creation", () => {
    it("should create rule sample file with correct frontmatter", async () => {
      await init();

      const ruleFilePath = join(RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME);
      const writeCall = vi.mocked(writeFileContent).mock.calls.find((c) => c[0] === ruleFilePath);

      expect(writeCall).toBeDefined();
      const content = writeCall?.[1] ?? "";
      expect(content).toContain("root: true");
      expect(content).toContain('targets: ["*"]');
      expect(content).toContain("# Project Overview");
    });

    it("should create MCP sample file", async () => {
      await init();

      const mcpFilePath = join(RULESYNC_RELATIVE_DIR_PATH, "mcp.json");
      const writeCall = vi.mocked(writeFileContent).mock.calls.find((c) => c[0] === mcpFilePath);

      expect(writeCall).toBeDefined();
      const content = writeCall?.[1] ?? "";
      expect(content).toContain('"mcpServers"');
    });

    it("should create command sample file", async () => {
      await init();

      const commandFilePath = join(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review-pr.md");
      const writeCall = vi
        .mocked(writeFileContent)
        .mock.calls.find((c) => c[0] === commandFilePath);

      expect(writeCall).toBeDefined();
      const content = writeCall?.[1] ?? "";
      expect(content).toContain("description: 'Review a pull request'");
    });

    it("should create subagent sample file", async () => {
      await init();

      const subagentFilePath = join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md");
      const writeCall = vi
        .mocked(writeFileContent)
        .mock.calls.find((c) => c[0] === subagentFilePath);

      expect(writeCall).toBeDefined();
      const content = writeCall?.[1] ?? "";
      expect(content).toContain("name: planner");
    });

    it("should create skill sample file", async () => {
      await init();

      const skillFilePath = join(
        RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        "project-context",
        SKILL_FILE_NAME,
      );
      const writeCall = vi.mocked(writeFileContent).mock.calls.find((c) => c[0] === skillFilePath);

      expect(writeCall).toBeDefined();
      const content = writeCall?.[1] ?? "";
      expect(content).toContain("name: project-context");
    });

    it("should create ignore sample file", async () => {
      await init();

      const ignoreFilePath = join(RULESYNC_RELATIVE_DIR_PATH, RULESYNC_AIIGNORE_FILE_NAME);
      const writeCall = vi.mocked(writeFileContent).mock.calls.find((c) => c[0] === ignoreFilePath);

      expect(writeCall).toBeDefined();
      const content = writeCall?.[1] ?? "";
      expect(content).toContain("credentials/");
    });

    it("should create hooks sample file", async () => {
      await init();

      const hooksFilePath = join(RULESYNC_RELATIVE_DIR_PATH, "hooks.json");
      const writeCall = vi.mocked(writeFileContent).mock.calls.find((c) => c[0] === hooksFilePath);

      expect(writeCall).toBeDefined();
      const content = writeCall?.[1] ?? "";
      expect(content).toContain('"hooks"');
      expect(content).toContain('"postToolUse"');
    });

    it("should not create files that already exist", async () => {
      const ruleFilePath = join(RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME);
      vi.mocked(fileExists).mockImplementation(async (path) => {
        return path === ruleFilePath;
      });

      const result = await init();

      const ruleResult = result.sampleFiles.find((f) => f.path === ruleFilePath);
      expect(ruleResult?.created).toBe(false);

      const writeCall = vi.mocked(writeFileContent).mock.calls.find((c) => c[0] === ruleFilePath);
      expect(writeCall).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("should propagate ensureDir errors", async () => {
      vi.mocked(ensureDir).mockRejectedValueOnce(new Error("Permission denied"));

      await expect(init()).rejects.toThrow("Permission denied");
    });

    it("should propagate fileExists errors", async () => {
      vi.mocked(fileExists).mockRejectedValue(new Error("File system error"));

      await expect(init()).rejects.toThrow("File system error");
    });

    it("should propagate writeFileContent errors", async () => {
      vi.mocked(writeFileContent).mockRejectedValue(new Error("Write error"));

      await expect(init()).rejects.toThrow("Write error");
    });
  });
});

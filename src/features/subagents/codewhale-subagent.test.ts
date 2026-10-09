import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CodewhaleSubagent } from "./codewhale-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

const buildRulesyncSubagent = ({
  relativeFilePath = "planner.md",
  frontmatter = {},
  body = "Plan the work.",
}: {
  relativeFilePath?: string;
  frontmatter?: Record<string, unknown>;
  body?: string;
} = {}): RulesyncSubagent =>
  new RulesyncSubagent({
    outputRoot: ".",
    relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    relativeFilePath,
    frontmatter: {
      targets: ["*"],
      name: "Planner",
      description: "Plans tasks",
      ...frontmatter,
    } as any,
    body,
    validate: false,
  });

describe("CodewhaleSubagent", () => {
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

  describe("getSettablePaths", () => {
    it("should return .codewhale/agents for both scopes", () => {
      expect(CodewhaleSubagent.getSettablePaths().relativeDirPath).toBe(
        join(".codewhale", "agents"),
      );
      expect(CodewhaleSubagent.getSettablePaths({ global: true }).relativeDirPath).toBe(
        join(".codewhale", "agents"),
      );
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should write a TOML profile with id, display_name, description and instructions", () => {
      const subagent = CodewhaleSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".codewhale", "agents"),
        rulesyncSubagent: buildRulesyncSubagent({
          frontmatter: { codewhale: { model: "deepseek-chat", reasoning_effort: "high" } },
          body: "Plan the work.\nThen report.",
        }),
      });

      expect(subagent.getRelativeFilePath()).toBe("planner.toml");
      expect(smolToml.parse(subagent.getFileContent())).toEqual({
        id: "planner",
        display_name: "Planner",
        description: "Plans tasks",
        model: "deepseek-chat",
        reasoning_effort: "high",
        instructions: { text: "Plan the work.\nThen report." },
      });
    });

    it("should sanitize the profile id to Codewhale's token characters", () => {
      const subagent = CodewhaleSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".codewhale", "agents"),
        rulesyncSubagent: buildRulesyncSubagent({ relativeFilePath: "code reviewer+.md" }),
      });

      expect(smolToml.parse(subagent.getFileContent()).id).toBe("code_reviewer_");
    });

    it("should drop codewhale section keys Codewhale would reject, with a warning", () => {
      const logger = createMockLogger();
      const subagent = CodewhaleSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".codewhale", "agents"),
        rulesyncSubagent: buildRulesyncSubagent({
          frontmatter: { codewhale: { model: "m", tools: { allow: ["*"] }, unknown: 1 } },
        }),
        logger,
      });

      const parsed = smolToml.parse(subagent.getFileContent());
      expect(parsed.model).toBe("m");
      expect(parsed).not.toHaveProperty("tools");
      expect(parsed).not.toHaveProperty("unknown");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("tools.allow, unknown"));
    });

    it("should write the narrowing-only [tools] and [permissions] entries", () => {
      const logger = createMockLogger();
      const subagent = CodewhaleSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".codewhale", "agents"),
        rulesyncSubagent: buildRulesyncSubagent({
          frontmatter: {
            codewhale: {
              base_role: "explore",
              tools: { posture: " read_only " },
              permissions: { allow_shell: false, trust: false, approval_required: true },
            },
          },
        }),
        logger,
      });

      expect(smolToml.parse(subagent.getFileContent())).toEqual({
        id: "planner",
        display_name: "Planner",
        description: "Plans tasks",
        base_role: "explore",
        tools: { posture: "read_only" },
        permissions: { allow_shell: false, trust: false, approval_required: true },
        instructions: { text: "Plan the work." },
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should drop [tools] and [permissions] values that would widen access", () => {
      const logger = createMockLogger();
      const subagent = CodewhaleSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".codewhale", "agents"),
        rulesyncSubagent: buildRulesyncSubagent({
          frontmatter: {
            codewhale: {
              tools: { posture: "full" },
              permissions: {
                allow_shell: true,
                trust: true,
                approval_required: false,
                network: false,
              },
            },
          },
        }),
        logger,
      });

      const parsed = smolToml.parse(subagent.getFileContent());
      expect(parsed).not.toHaveProperty("tools");
      expect(parsed).not.toHaveProperty("permissions");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          ": tools.posture, permissions.allow_shell, permissions.trust, permissions.approval_required, permissions.network.",
        ),
      );
    });

    it("should keep the narrowing entries of a table and drop a non-table value", () => {
      const logger = createMockLogger();
      const subagent = CodewhaleSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".codewhale", "agents"),
        rulesyncSubagent: buildRulesyncSubagent({
          frontmatter: {
            codewhale: { tools: "read-only", permissions: { allow_shell: false, trust: true } },
          },
        }),
        logger,
      });

      const parsed = smolToml.parse(subagent.getFileContent());
      expect(parsed).not.toHaveProperty("tools");
      expect(parsed.permissions).toEqual({ allow_shell: false });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(": tools, permissions.trust."),
      );
    });

    it("should normalize Codewhale's alias spellings to the canonical keys", () => {
      const logger = createMockLogger();
      const subagent = CodewhaleSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".codewhale", "agents"),
        rulesyncSubagent: buildRulesyncSubagent({
          frontmatter: {
            codewhale: { model_hint: "m", reasoning_effort: "high", thinking: "low" },
          },
        }),
        logger,
      });

      const parsed = smolToml.parse(subagent.getFileContent());
      expect(parsed.model).toBe("m");
      expect(parsed.reasoning_effort).toBe("high");
      expect(parsed).not.toHaveProperty("model_hint");
      expect(parsed).not.toHaveProperty("thinking");
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(": thinking."));
    });

    it("should report the user's spelling for a dropped alias and a duplicate alias", () => {
      const logger = createMockLogger();
      const subagent = CodewhaleSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".codewhale", "agents"),
        rulesyncSubagent: buildRulesyncSubagent({
          frontmatter: { codewhale: { model_hint: "a", model_id: "b", reasoning: 3 } },
        }),
        logger,
      });

      const parsed = smolToml.parse(subagent.getFileContent());
      expect(parsed.model).toBe("a");
      expect(parsed).not.toHaveProperty("reasoning_effort");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(": model_id, reasoning."));
    });

    it("should drop non-string section values, with a warning", () => {
      const logger = createMockLogger();
      const subagent = CodewhaleSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".codewhale", "agents"),
        rulesyncSubagent: buildRulesyncSubagent({
          frontmatter: { codewhale: { model: 4.1, provider: "deepseek" } },
        }),
        logger,
      });

      const parsed = smolToml.parse(subagent.getFileContent());
      expect(parsed).not.toHaveProperty("model");
      expect(parsed.provider).toBe("deepseek");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("model"));
    });

    it("should fall back to an escaped string for control characters and a trailing quote", () => {
      for (const body of ["a\n\u001b[1mb", "a\nit's"]) {
        const subagent = CodewhaleSubagent.fromRulesyncSubagent({
          outputRoot: testDir,
          relativeDirPath: join(".codewhale", "agents"),
          rulesyncSubagent: buildRulesyncSubagent({ body }),
        });
        expect(smolToml.parse(subagent.getFileContent())).toMatchObject({
          instructions: { text: body },
        });
      }
    });

    it("should fall back to an escaped string when the body contains a triple quote", () => {
      const subagent = CodewhaleSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".codewhale", "agents"),
        rulesyncSubagent: buildRulesyncSubagent({ body: "a\n'''\nb" }),
      });

      expect(smolToml.parse(subagent.getFileContent())).toMatchObject({
        instructions: { text: "a\n'''\nb" },
      });
    });
  });

  describe("fromFile and toRulesyncSubagent", () => {
    it("should import a profile, preferring display_name and [instructions] text", async () => {
      await writeFileContent(
        join(testDir, ".codewhale", "agents", "planner.toml"),
        [
          'id = "planner"',
          'display_name = "Planner"',
          'description = "Plans tasks"',
          'reasoning_effort = "high"',
          'persona = "legacy"',
          "",
          "[instructions]",
          'text = "Plan the work."',
        ].join("\n"),
      );

      const subagent = await CodewhaleSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "planner.toml",
      });
      const rulesyncSubagent = subagent.toRulesyncSubagent();

      expect(rulesyncSubagent.getRelativeFilePath()).toBe("planner.md");
      expect(rulesyncSubagent.getFrontmatter()).toMatchObject({
        name: "Planner",
        description: "Plans tasks",
        codewhale: { reasoning_effort: "high" },
      });
      expect(rulesyncSubagent.getBody()).toBe("Plan the work.");
    });

    it("should fall back to persona and the id when newer keys are absent", async () => {
      await writeFileContent(
        join(testDir, ".codewhale", "agents", "old.toml"),
        'id = "old"\npersona = "Legacy persona"\n',
      );

      const subagent = await CodewhaleSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "old.toml",
      });
      const rulesyncSubagent = subagent.toRulesyncSubagent();

      expect(rulesyncSubagent.getFrontmatter().name).toBe("old");
      expect(rulesyncSubagent.getBody()).toBe("Legacy persona");
    });

    it("should import Codewhale's alias spellings under the canonical keys", async () => {
      await writeFileContent(
        join(testDir, ".codewhale", "agents", "scout.toml"),
        'id = "scout"\nmodel_id = "deepseek-v4"\nthinking = "high"\n',
      );

      const subagent = await CodewhaleSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "scout.toml",
      });

      expect(subagent.toRulesyncSubagent().getFrontmatter().codewhale).toEqual({
        model: "deepseek-v4",
        reasoning_effort: "high",
      });
    });

    it("should import the narrowing-only [tools] and [permissions] entries", async () => {
      await writeFileContent(
        join(testDir, ".codewhale", "agents", "reasoner.toml"),
        [
          'base_role = "explore"',
          "",
          "[tools]",
          'posture = "read-only"',
          "",
          "[permissions]",
          "allow_shell = false",
          "trust = false",
          "approval_required = false",
        ].join("\n"),
      );

      const subagent = await CodewhaleSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "reasoner.toml",
      });

      expect(subagent.toRulesyncSubagent().getFrontmatter().codewhale).toEqual({
        base_role: "explore",
        tools: { posture: "read-only" },
        permissions: { allow_shell: false, trust: false },
      });
    });

    it("should reject invalid TOML", async () => {
      await writeFileContent(join(testDir, ".codewhale", "agents", "bad.toml"), "id = ");

      await expect(
        CodewhaleSubagent.fromFile({ outputRoot: testDir, relativeFilePath: "bad.toml" }),
      ).rejects.toThrow(/Invalid TOML/);
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should honor the codewhale target and the wildcard", () => {
      expect(
        CodewhaleSubagent.isTargetedByRulesyncSubagent(
          buildRulesyncSubagent({ frontmatter: { targets: ["codewhale"] } }),
        ),
      ).toBe(true);
      expect(
        CodewhaleSubagent.isTargetedByRulesyncSubagent(
          buildRulesyncSubagent({ frontmatter: { targets: ["cursor"] } }),
        ),
      ).toBe(false);
    });
  });
});

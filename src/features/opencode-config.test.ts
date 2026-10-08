import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MIMOCODE_LAYOUT } from "../constants/mimocode-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import {
  asOpencodeEntries,
  getOpencodeAgentEntries,
  getOpencodeCommandEntries,
  getOpencodeConfigDir,
  getOpencodeSkillPaths,
  readOpencodeConfig,
  resolveOpencodeFileTemplate,
} from "./opencode-config.js";

describe("opencode-config", () => {
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

  describe("readOpencodeConfig", () => {
    it("parses opencode.json", async () => {
      await writeFileContent(join(testDir, "opencode.json"), JSON.stringify({ mcp: { a: 1 } }));
      expect(await readOpencodeConfig({ outputRoot: testDir })).toEqual({ mcp: { a: 1 } });
    });

    it("prefers opencode.jsonc and tolerates comments", async () => {
      await writeFileContent(join(testDir, "opencode.jsonc"), '{\n  // a comment\n  "x": 1\n}');
      await writeFileContent(join(testDir, "opencode.json"), JSON.stringify({ x: 2 }));
      expect(await readOpencodeConfig({ outputRoot: testDir })).toEqual({ x: 1 });
    });

    it("returns an empty object when no config exists", async () => {
      expect(await readOpencodeConfig({ outputRoot: testDir })).toEqual({});
    });

    it("returns an empty object when the config is not an object", async () => {
      await writeFileContent(join(testDir, "opencode.json"), "[1, 2, 3]");
      expect(await readOpencodeConfig({ outputRoot: testDir })).toEqual({});
    });
  });

  describe("asOpencodeEntries", () => {
    it("returns the record for plain objects", () => {
      expect(asOpencodeEntries({ a: { template: "x" } })).toEqual({ a: { template: "x" } });
    });

    it("returns null for non-objects, arrays, and null", () => {
      expect(asOpencodeEntries(null)).toBeNull();
      expect(asOpencodeEntries([1, 2])).toBeNull();
      expect(asOpencodeEntries("str")).toBeNull();
      expect(asOpencodeEntries(undefined)).toBeNull();
    });
  });

  describe("getOpencodeAgentEntries", () => {
    it("lowers V2 agents entries into the V1 agent shape", () => {
      expect(
        getOpencodeAgentEntries({
          config: {
            agents: {
              reviewer: {
                description: "Reviews code",
                mode: "subagent",
                system: "You review.",
                disabled: true,
                hidden: true,
                color: "#ff0000",
                steps: 5,
                model: "anthropic/claude-sonnet#high",
                request: { headers: { "x-a": "1" }, body: { reasoning: true } },
                permissions: [{ action: "edit", resource: "*", effect: "deny" }],
              },
              planner: { model: { providerID: "openai", model: "gpt-5", variant: "low" } },
            },
          },
        }),
      ).toEqual({
        reviewer: {
          description: "Reviews code",
          mode: "subagent",
          prompt: "You review.",
          disable: true,
          hidden: true,
          color: "#ff0000",
          steps: 5,
          model: "anthropic/claude-sonnet",
          variant: "high",
          options: { reasoning: true },
        },
        planner: { model: "openai/gpt-5", variant: "low" },
      });
    });

    it("keeps the V1 agent entry when both spellings define the same name", () => {
      expect(
        getOpencodeAgentEntries({
          config: {
            agent: { reviewer: { prompt: "V1" } },
            agents: { reviewer: { system: "V2" }, helper: { system: "Help" } },
          },
        }),
      ).toEqual({ reviewer: { prompt: "V1" }, helper: { prompt: "Help" } });
    });

    it("ignores V2 agents when the V1 agent key is not an object", () => {
      expect(
        getOpencodeAgentEntries({ config: { agent: "oops", agents: { a: { system: "x" } } } }),
      ).toBeNull();
    });

    it("ignores V2 agents for a layout that does not read V2 spellings", () => {
      expect(
        getOpencodeAgentEntries({
          config: { agents: { a: { system: "x" } } },
          layout: MIMOCODE_LAYOUT,
        }),
      ).toBeNull();
    });
  });

  describe("getOpencodeCommandEntries", () => {
    it("merges V2 commands entries, lowering the model and skipping entries without a template", () => {
      expect(
        getOpencodeCommandEntries({
          config: {
            command: { ship: { template: "V1 ship" } },
            commands: {
              ship: { template: "V2 ship" },
              review: { template: "Review", model: "openai/gpt-5#high", subagent: true },
              broken: { description: "no template" },
            },
          },
        }),
      ).toEqual({
        ship: { template: "V1 ship" },
        review: { template: "Review", model: "openai/gpt-5", variant: "high", subagent: true },
      });
    });

    it("lowers an object model selection and ignores V2 commands when command is not an object", () => {
      expect(
        getOpencodeCommandEntries({
          config: {
            commands: { a: { template: "x", model: { providerID: "openai", model: "gpt-5" } } },
          },
        }),
      ).toEqual({ a: { template: "x", model: "openai/gpt-5" } });
      expect(
        getOpencodeCommandEntries({
          config: { commands: { a: { template: "x", model: "o/m#" } } },
        }),
      ).toEqual({ a: { template: "x", model: "o/m" } });
      expect(
        getOpencodeCommandEntries({ config: { command: [], commands: { a: { template: "x" } } } }),
      ).toBeNull();
    });

    it("keeps a V2 entry named __proto__ as an own entry", () => {
      const entries = getOpencodeCommandEntries({
        config: JSON.parse('{"commands":{"__proto__":{"template":"x"}}}'),
      });
      expect(Object.getPrototypeOf(entries)).toBe(Object.prototype);
      expect(Object.keys(entries ?? {})).toEqual(["__proto__"]);
    });

    it("ignores V2 commands for a layout that does not read V2 spellings", () => {
      expect(
        getOpencodeCommandEntries({
          config: { commands: { a: { template: "x" } } },
          layout: MIMOCODE_LAYOUT,
        }),
      ).toBeNull();
    });
  });

  describe("getOpencodeSkillPaths", () => {
    it("reads skills.paths", () => {
      expect(getOpencodeSkillPaths({ config: { skills: { paths: ["a", 1] } } })).toEqual(["a", 1]);
      expect(getOpencodeSkillPaths({ config: {} })).toEqual([]);
    });

    it("reads the non-URL entries of a flat V2 skills array", () => {
      expect(
        getOpencodeSkillPaths({
          config: {
            skills: ["team/skills", "https://example.com/.well-known/skills/", "HTTP://x"],
          },
        }),
      ).toEqual(["team/skills"]);
    });

    it("ignores a flat skills array with a non-string entry or for a layout without V2 spellings", () => {
      expect(getOpencodeSkillPaths({ config: { skills: ["a", 1] } })).toEqual([]);
      expect(getOpencodeSkillPaths({ config: { skills: ["a"] }, layout: MIMOCODE_LAYOUT })).toEqual(
        [],
      );
    });
  });

  describe("getOpencodeConfigDir", () => {
    it("uses the project root in project mode and ~/.config/opencode in global mode", () => {
      expect(getOpencodeConfigDir({ outputRoot: testDir })).toBe(testDir);
      expect(getOpencodeConfigDir({ outputRoot: testDir, global: true })).toBe(
        join(testDir, ".config", "opencode"),
      );
    });
  });

  describe("resolveOpencodeFileTemplate", () => {
    it("resolves a whole-value {file:./path} reference relative to configDir", async () => {
      await writeFileContent(join(testDir, "prompts", "p.txt"), "file body");
      expect(
        await resolveOpencodeFileTemplate({
          value: "{file:./prompts/p.txt}",
          configDir: testDir,
        }),
      ).toBe("file body");
    });

    it("returns the value unchanged when it is not a file reference", async () => {
      expect(await resolveOpencodeFileTemplate({ value: "plain prompt", configDir: testDir })).toBe(
        "plain prompt",
      );
    });

    it("preserves the literal value when the referenced file is unreadable", async () => {
      expect(
        await resolveOpencodeFileTemplate({ value: "{file:./nope.txt}", configDir: testDir }),
      ).toBe("{file:./nope.txt}");
    });
  });
});

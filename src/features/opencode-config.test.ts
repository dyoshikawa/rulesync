import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MIMOCODE_LAYOUT } from "../constants/mimocode-paths.js";
import { OPENCODEV1_LAYOUT } from "../constants/opencode-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import {
  asOpencodeEntries,
  getOpencodeAgentEntries,
  getOpencodeCommandEntries,
  getOpencodeConfigDir,
  getOpencodeMcpServerEntry,
  getOpencodeSkillPaths,
  getOpencodeV2GlobalMcpTimeout,
  lowerOpencodeV2Mcp,
  mergeOpencodeConfigValues,
  mergeOpencodeEntryLayers,
  raiseOpencodeServerToV2,
  readOpencodeConfig,
  readOpencodeConfigLayers,
  readOpencodeDotDirConfigLayers,
  resolveOpencodeFileTemplate,
  warnOpencodeDotDirOverrides,
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

  describe("readOpencodeDotDirConfigLayers", () => {
    it("reads .opencode/opencode.json, then .opencode/opencode.jsonc", async () => {
      await writeFileContent(join(testDir, ".opencode", "opencode.jsonc"), '{ "x": 2 // c\n}');
      await writeFileContent(join(testDir, ".opencode", "opencode.json"), JSON.stringify({ x: 1 }));
      expect(await readOpencodeDotDirConfigLayers({ outputRoot: testDir })).toEqual([
        {
          relativeFilePath: join(".opencode", "opencode.json"),
          configDir: join(testDir, ".opencode"),
          config: { x: 1 },
        },
        {
          relativeFilePath: join(".opencode", "opencode.jsonc"),
          configDir: join(testDir, ".opencode"),
          config: { x: 2 },
        },
      ]);
    });

    it("returns no layers in global mode or for a layout without the location", async () => {
      await writeFileContent(join(testDir, ".opencode", "opencode.json"), JSON.stringify({ x: 1 }));
      expect(await readOpencodeDotDirConfigLayers({ outputRoot: testDir, global: true })).toEqual(
        [],
      );
      expect(
        await readOpencodeDotDirConfigLayers({ outputRoot: testDir, layout: MIMOCODE_LAYOUT }),
      ).toEqual([]);
    });
  });

  describe("readOpencodeConfigLayers", () => {
    it("returns the root config first, then the .opencode files", async () => {
      await writeFileContent(join(testDir, "opencode.json"), JSON.stringify({ x: 0 }));
      await writeFileContent(join(testDir, ".opencode", "opencode.json"), JSON.stringify({ x: 1 }));
      const layers = await readOpencodeConfigLayers({ outputRoot: testDir });
      expect(layers.map(({ config, configDir }) => ({ config, configDir }))).toEqual([
        { config: { x: 0 }, configDir: testDir },
        { config: { x: 1 }, configDir: join(testDir, ".opencode") },
      ]);
    });
  });

  describe("mergeOpencodeConfigValues", () => {
    it("merges objects deeply and lets other values replace", () => {
      expect(
        mergeOpencodeConfigValues(
          { mcp: { a: { type: "local", command: ["a"] } }, list: [1], keep: true },
          { mcp: { a: { enabled: false }, b: { type: "remote" } }, list: [2] },
        ),
      ).toEqual({
        mcp: { a: { type: "local", command: ["a"], enabled: false }, b: { type: "remote" } },
        list: [2],
        keep: true,
      });
      expect(
        mergeOpencodeConfigValues({ permission: { bash: "ask" } }, { permission: "allow" }),
      ).toEqual({ permission: "allow" });
    });

    it("keeps a __proto__ key as an own entry", () => {
      const merged = mergeOpencodeConfigValues({}, JSON.parse('{"__proto__": {"polluted": 1}}'));
      expect(Object.hasOwn(merged as object, "__proto__")).toBe(true);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
  });

  describe("mergeOpencodeEntryLayers", () => {
    it("merges entries across layers, later layers winning", () => {
      expect(
        mergeOpencodeEntryLayers([
          { a: { template: "root", agent: "build" } },
          null,
          { a: { template: "dot" }, b: { template: "b" } },
        ]),
      ).toEqual({ a: { template: "dot", agent: "build" }, b: { template: "b" } });
    });

    it("returns null when no layer has entries", () => {
      expect(mergeOpencodeEntryLayers([null, null])).toBeNull();
    });
  });

  describe("warnOpencodeDotDirOverrides", () => {
    const overlay = (config: Record<string, unknown>) => ({
      relativeFilePath: join(".opencode", "opencode.json"),
      configDir: join(testDir, ".opencode"),
      config,
    });

    it("warns about generated entries the .opencode file also sets", () => {
      const logger = { warn: vi.fn() };
      warnOpencodeDotDirOverrides({
        generated: { mcp: { a: {}, b: {} }, permission: "allow", tools: undefined },
        overlays: [overlay({ mcp: { b: {}, c: {} }, permission: { bash: "ask" }, tools: {} })],
        rootFileName: "opencode.json",
        logger: logger as never,
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]?.[0]).toBe(
        'OpenCode merges ".opencode/opencode.json" over the generated "opencode.json", so its values for these generated entries take precedence: "mcp" > "b", "permission".',
      );
    });

    it("does not warn when nothing overlaps", () => {
      const logger = { warn: vi.fn() };
      warnOpencodeDotDirOverrides({
        generated: { mcp: { a: {} } },
        overlays: [overlay({ mcp: { c: {} }, instructions: ["x.md"] })],
        rootFileName: "opencode.json",
        logger: logger as never,
      });
      expect(logger.warn).not.toHaveBeenCalled();
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
    it("lowers V2 agents entries into the V1 agent shape for OpenCode V1", () => {
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
          layout: OPENCODEV1_LAYOUT,
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

    it("keeps the V2 permissions of agents entries for OpenCode V2", () => {
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
          permissions: [{ action: "edit", resource: "*", effect: "deny" }],
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

  describe("raiseOpencodeServerToV2", () => {
    it("should be inverted by lowerOpencodeV2Mcp", () => {
      const v1 = {
        type: "remote",
        url: "https://example.com/mcp",
        enabled: false,
        timeout: 5000,
        oauth: { clientId: "id", clientSecret: "s", callbackPort: 8080, redirectUri: "r" },
        protocol: "auto",
        codemode: false,
      };

      const raised = raiseOpencodeServerToV2(v1, undefined);

      expect(raised).toEqual({
        type: "remote",
        url: "https://example.com/mcp",
        disabled: true,
        timeout: { catalog: 5000, execution: 5000 },
        oauth: { client_id: "id", client_secret: "s", callback_port: 8080, redirect_uri: "r" },
        protocol: "auto",
        codemode: false,
      });
      expect(lowerOpencodeV2Mcp({ servers: { x: raised } })).toEqual({ x: v1 });
    });

    it("should not write disabled for an enabled server", () => {
      expect(
        raiseOpencodeServerToV2({ type: "local", command: ["a"], enabled: true }, undefined),
      ).toEqual({ type: "local", command: ["a"] });
    });

    it("should pass oauth false and an object timeout through", () => {
      const timeout = { startup: 1000 };

      expect(
        raiseOpencodeServerToV2(
          { type: "remote", url: "https://example.com", oauth: false, timeout },
          undefined,
        ),
      ).toEqual({ type: "remote", url: "https://example.com", oauth: false, timeout });
    });

    it("should keep the existing timeout and oauth objects when they lower to the canonical values", () => {
      const existing = {
        timeout: { startup: 1000, catalog: 9000 },
        oauth: { client_id: "a", auth_server_metadata_url: "https://auth.example.com" },
      };

      expect(
        raiseOpencodeServerToV2(
          { type: "remote", url: "https://example.com", oauth: { clientId: "a" } },
          existing,
        ),
      ).toEqual({ type: "remote", url: "https://example.com", ...existing });
    });

    it("should keep the existing startup timeout when the canonical timeout changes", () => {
      expect(
        raiseOpencodeServerToV2(
          { type: "local", command: ["a"], timeout: 3000 },
          { timeout: { startup: 1000, catalog: 9000 } },
        ),
      ).toEqual({
        type: "local",
        command: ["a"],
        timeout: { startup: 1000, catalog: 3000, execution: 3000 },
      });
    });
  });

  describe("getOpencodeMcpServerEntry", () => {
    it("should prefer the mcp.servers entry over a flat entry of the same name", () => {
      const mcp = {
        a: { type: "local", command: ["flat"] },
        b: { type: "local", command: ["b"] },
        servers: { a: { type: "local", command: ["v2"] } },
      };

      expect(getOpencodeMcpServerEntry(mcp, "a")).toEqual({ type: "local", command: ["v2"] });
      expect(getOpencodeMcpServerEntry(mcp, "b")).toEqual({ type: "local", command: ["b"] });
      expect(getOpencodeMcpServerEntry(mcp, "missing")).toBeUndefined();
      expect(getOpencodeMcpServerEntry(undefined, "a")).toBeUndefined();
    });

    it("should read only own entries, so a server named __proto__ or constructor is safe", () => {
      const mcp = JSON.parse(
        '{"servers": {"__proto__": {"type": "local", "command": ["p"]}}}',
      ) as unknown;

      expect(getOpencodeMcpServerEntry(mcp, "__proto__")).toEqual({
        type: "local",
        command: ["p"],
      });
      expect(getOpencodeMcpServerEntry(mcp, "constructor")).toBeUndefined();
      expect(getOpencodeMcpServerEntry({}, "toString")).toBeUndefined();
    });
  });

  describe("getOpencodeV2GlobalMcpTimeout", () => {
    it("should return a non-empty global timeout object only", () => {
      expect(getOpencodeV2GlobalMcpTimeout({ timeout: { startup: 45000 } })).toEqual({
        startup: 45000,
      });
      expect(getOpencodeV2GlobalMcpTimeout({ timeout: {} })).toBeUndefined();
      expect(
        getOpencodeV2GlobalMcpTimeout({ timeout: { type: "local", command: ["t"] } }),
      ).toBeUndefined();
      expect(getOpencodeV2GlobalMcpTimeout(undefined)).toBeUndefined();
    });
  });
});

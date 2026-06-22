import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AmpMcp } from "./amp-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("AmpMcp", () => {
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
    it("should return project settings path defaulting to settings.json", () => {
      const paths = AmpMcp.getSettablePaths();

      expect(paths.relativeDirPath).toBe(".amp");
      expect(paths.relativeFilePath).toBe("settings.json");
    });

    it("should return global settings path defaulting to settings.json", () => {
      const paths = AmpMcp.getSettablePaths({ global: true });

      expect(paths.relativeDirPath).toBe(join(".config", "amp"));
      expect(paths.relativeFilePath).toBe("settings.json");
    });
  });

  describe("isDeletable", () => {
    it("should always return false because settings.json/.jsonc may contain other Amp settings", () => {
      const ampMcp = new AmpMcp({
        relativeDirPath: ".amp",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ "amp.mcpServers": {} }),
      });

      expect(ampMcp.isDeletable()).toBe(false);
    });
  });

  describe("fromFile", () => {
    it("should read amp.mcpServers and preserve other settings", async () => {
      const jsonData = {
        "amp.dangerouslyAllowAll": true,
        "amp.mcpServers": {
          context7: {
            type: "http",
            url: "https://mcp.context7.com/mcp",
          },
        },
      };
      await ensureDir(join(testDir, ".amp"));
      await writeFileContent(join(testDir, ".amp", "settings.json"), JSON.stringify(jsonData));

      const ampMcp = await AmpMcp.fromFile({ outputRoot: testDir });

      expect(ampMcp.getJson()).toEqual(jsonData);
      expect(ampMcp.getFilePath()).toBe(join(testDir, ".amp", "settings.json"));
    });

    it("should initialize amp.mcpServers when settings file does not exist", async () => {
      const ampMcp = await AmpMcp.fromFile({ outputRoot: testDir });

      expect(ampMcp.getJson()).toEqual({ "amp.mcpServers": {} });
    });

    it("should initialize amp.mcpServers in existing settings file", async () => {
      const jsonData = {
        "amp.dangerouslyAllowAll": true,
      };
      await ensureDir(join(testDir, ".amp"));
      await writeFileContent(join(testDir, ".amp", "settings.json"), JSON.stringify(jsonData));

      const ampMcp = await AmpMcp.fromFile({ outputRoot: testDir });

      expect(ampMcp.getJson()).toEqual({
        "amp.dangerouslyAllowAll": true,
        "amp.mcpServers": {},
      });
    });

    it("should read global settings from .config/amp/settings.json", async () => {
      const jsonData = {
        "amp.mcpServers": {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", testDir],
          },
        },
      };
      await ensureDir(join(testDir, ".config", "amp"));
      await writeFileContent(
        join(testDir, ".config", "amp", "settings.json"),
        JSON.stringify(jsonData),
      );

      const ampMcp = await AmpMcp.fromFile({ outputRoot: testDir, global: true });

      expect(ampMcp.getJson()).toEqual(jsonData);
      expect(ampMcp.getFilePath()).toBe(join(testDir, ".config", "amp", "settings.json"));
    });

    it("should reject malformed existing settings instead of overwriting them", async () => {
      await ensureDir(join(testDir, ".amp"));
      await writeFileContent(join(testDir, ".amp", "settings.jsonc"), "{ not json");

      await expect(AmpMcp.fromFile({ outputRoot: testDir })).rejects.toThrow(
        "Failed to parse Amp settings",
      );
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should write MCP servers under amp.mcpServers", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            context7: {
              type: "http",
              url: "https://mcp.context7.com/mcp",
            },
          },
        }),
      });

      const ampMcp = await AmpMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });

      expect(ampMcp.getJson()).toEqual({
        "amp.mcpServers": {
          context7: {
            type: "http",
            url: "https://mcp.context7.com/mcp",
          },
        },
      });
      expect(ampMcp.getFilePath()).toBe(join(testDir, ".amp", "settings.json"));
    });

    it("should preserve existing non-MCP Amp settings", async () => {
      await ensureDir(join(testDir, ".amp"));
      await writeFileContent(
        join(testDir, ".amp", "settings.json"),
        JSON.stringify({
          "amp.dangerouslyAllowAll": true,
          "amp.notifications.enabled": false,
          "amp.mcpServers": {
            old: { command: "node", args: ["old.js"] },
          },
        }),
      );
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            current: { command: "node", args: ["current.js"] },
          },
        }),
      });

      const ampMcp = await AmpMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });

      expect(ampMcp.getJson()).toEqual({
        "amp.dangerouslyAllowAll": true,
        "amp.notifications.enabled": false,
        "amp.mcpServers": {
          current: { command: "node", args: ["current.js"] },
        },
      });
    });

    it("should strip rulesync-only and codex-only fields from Amp output", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            pal: {
              type: "stdio",
              command: "uvx",
              args: ["pal-mcp-server"],
              targets: ["amp"],
              envVars: ["OPENAI_API_KEY"],
            },
          },
        }),
      });

      const ampMcp = await AmpMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });

      const json = ampMcp.getJson() as Record<string, unknown>;
      expect(json["amp.mcpServers"]).toBeDefined();
      const pal = (json["amp.mcpServers"] as Record<string, unknown>).pal as Record<
        string,
        unknown
      >;
      expect(pal.command).toBe("uvx");
      expect(pal.targets).toBeUndefined();
      expect(pal.envVars).toBeUndefined();
    });

    it("should write global settings to .config/amp/settings.json", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      const ampMcp = await AmpMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(ampMcp.getFilePath()).toBe(join(testDir, ".config", "amp", "settings.json"));
    });

    it("should reject malformed existing settings instead of replacing them", async () => {
      await ensureDir(join(testDir, ".amp"));
      await writeFileContent(join(testDir, ".amp", "settings.jsonc"), "{ not json");
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      await expect(AmpMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp })).rejects.toThrow(
        "Failed to parse Amp settings",
      );
    });
  });

  describe("toRulesyncMcp", () => {
    it("should extract amp.mcpServers into Rulesync mcpServers", () => {
      const ampMcp = new AmpMcp({
        relativeDirPath: ".amp",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          "amp.dangerouslyAllowAll": true,
          "amp.mcpServers": {
            context7: {
              type: "http",
              url: "https://mcp.context7.com/mcp",
            },
          },
        }),
      });

      const rulesyncMcp = ampMcp.toRulesyncMcp();

      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: {
          context7: {
            type: "http",
            url: "https://mcp.context7.com/mcp",
          },
        },
      });
    });
  });

  describe("getJson", () => {
    it("should not expose internal mutable settings state", () => {
      const original = {
        "amp.mcpServers": {
          context7: {
            type: "http",
            url: "https://mcp.context7.com/mcp",
          },
        },
      };
      const ampMcp = new AmpMcp({
        relativeDirPath: ".amp",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify(original),
      });

      const json = ampMcp.getJson();
      json["amp.mcpServers"] = { mutated: { command: "echo" } };

      expect(ampMcp.getJson()).toEqual(original);
    });
  });

  describe("validate", () => {
    it("should return success for valid config", () => {
      const ampMcp = new AmpMcp({
        relativeDirPath: ".amp",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          "amp.mcpServers": {
            context7: {
              type: "stdio",
              command: "npx",
              args: ["-y", "@context7/mcp-server"],
            },
          },
        }),
      });

      const result = ampMcp.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should reject constructor as server name", () => {
      const ampMcp = new AmpMcp({
        relativeDirPath: ".amp",
        relativeFilePath: "settings.json",
        fileContent: `{
          "amp.mcpServers": {
            "constructor": { "type": "stdio", "command": "evil" }
          }
        }`,
      });

      const result = ampMcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("constructor");
    });

    it("should reject non-object amp.mcpServers", () => {
      const ampMcp = new AmpMcp({
        relativeDirPath: ".amp",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          "amp.mcpServers": "not an object",
        }),
        validate: false,
      });

      const result = ampMcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("amp.mcpServers");
    });

    it("should reject non-object server configs", () => {
      const ampMcp = new AmpMcp({
        relativeDirPath: ".amp",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          "amp.mcpServers": {
            context7: "not an object",
          },
        }),
        validate: false,
      });

      const result = ampMcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("context7");
    });

    it("should accept unknown transport types (loose schema)", () => {
      // Amp can add new transport types upstream; rulesync keeps the schema
      // loose so new fields don't require a release.
      const ampMcp = new AmpMcp({
        relativeDirPath: ".amp",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          "amp.mcpServers": {
            myserver: {
              type: "future-transport",
              command: "npx",
            },
          },
        }),
      });

      const result = ampMcp.validate();
      expect(result.success).toBe(true);
    });
  });

  describe("JSONC support", () => {
    it("should read settings.jsonc first when it exists", async () => {
      const jsonData = {
        "amp.mcpServers": {
          context7: {
            type: "http",
            url: "https://mcp.context7.com/mcp",
          },
        },
      };
      await ensureDir(join(testDir, ".amp"));
      await writeFileContent(
        join(testDir, ".amp", "settings.jsonc"),
        `// Amp settings
{
  "amp.mcpServers": {
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp"
    }
  }
}`,
      );

      const ampMcp = await AmpMcp.fromFile({ outputRoot: testDir });

      expect(ampMcp.getJson()).toEqual(jsonData);
      expect(ampMcp.getFilePath()).toBe(join(testDir, ".amp", "settings.jsonc"));
    });

    it("should parse settings.jsonc with trailing commas", async () => {
      const jsoncContent = `{
  // Amp settings with trailing commas
  "amp.mcpServers": {
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp",
    },
  },
}`;
      await ensureDir(join(testDir, ".amp"));
      await writeFileContent(join(testDir, ".amp", "settings.jsonc"), jsoncContent);

      const ampMcp = await AmpMcp.fromFile({ outputRoot: testDir });

      expect(ampMcp.getJson()).toEqual({
        "amp.mcpServers": {
          context7: {
            type: "http",
            url: "https://mcp.context7.com/mcp",
          },
        },
      });
    });

    it("should fall back to settings.json if settings.jsonc does not exist", async () => {
      const jsonData = {
        "amp.mcpServers": {
          context7: {
            type: "http",
            url: "https://mcp.context7.com/mcp",
          },
        },
      };
      await ensureDir(join(testDir, ".amp"));
      await writeFileContent(join(testDir, ".amp", "settings.json"), JSON.stringify(jsonData));

      const ampMcp = await AmpMcp.fromFile({ outputRoot: testDir });

      expect(ampMcp.getJson()).toEqual(jsonData);
      expect(ampMcp.getFilePath()).toBe(join(testDir, ".amp", "settings.json"));
    });

    it("should create settings.json when neither file exists", async () => {
      const ampMcp = await AmpMcp.fromFile({ outputRoot: testDir });

      expect(ampMcp.getJson()).toEqual({ "amp.mcpServers": {} });
      expect(ampMcp.getFilePath()).toBe(join(testDir, ".amp", "settings.json"));
    });
  });
});

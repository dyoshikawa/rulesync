import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import { ZedPermissions } from "./zed-permissions.js";

function createRulesyncPermissions(permission: Record<string, Record<string, string>>) {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify({ permission }),
    validate: true,
  });
}

describe("ZedPermissions", () => {
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
    it("should return the project settings path by default", () => {
      const paths = ZedPermissions.getSettablePaths();
      expect(paths.relativeDirPath).toBe(".zed");
      expect(paths.relativeFilePath).toBe("settings.json");
    });

    it("should return the global settings path when global is true", () => {
      const paths = ZedPermissions.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".config", "zed"));
      expect(paths.relativeFilePath).toBe("settings.json");
    });
  });

  describe("isDeletable", () => {
    it("should not be deletable (shared settings file)", () => {
      const permissions = ZedPermissions.forDeletion({
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
      });
      expect(permissions.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("should map canonical categories onto agent.tool_permissions", async () => {
      const rulesyncPermissions = createRulesyncPermissions({
        bash: { "*": "ask", "git *": "allow", "rm *": "deny" },
        read: { ".env": "deny" },
      });

      const permissions = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(permissions.getFileContent());
      const tools = json.agent.tool_permissions.tools;

      // `bash` → `terminal`, `*` → per-tool default, `ask` → `confirm`.
      expect(tools.terminal.default).toBe("confirm");
      expect(tools.terminal.always_allow).toEqual([{ pattern: "git *", case_sensitive: false }]);
      expect(tools.terminal.always_deny).toEqual([{ pattern: "rm *", case_sensitive: false }]);
      // `read` → `read_file`.
      expect(tools.read_file.always_deny).toEqual([{ pattern: ".env", case_sensitive: false }]);
      expect(tools.read_file.default).toBeUndefined();
    });

    it("should preserve unrelated settings and unmanaged tools", async () => {
      await writeFileContent(
        join(testDir, ".zed", "settings.json"),
        JSON.stringify({
          context_servers: { my_server: { command: "x" } },
          agent: {
            tool_permissions: {
              default: "confirm",
              tools: {
                custom_tool: { default: "allow" },
              },
            },
          },
        }),
      );

      const rulesyncPermissions = createRulesyncPermissions({
        bash: { "*": "deny" },
      });

      const permissions = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(permissions.getFileContent());
      // Unrelated settings preserved.
      expect(json.context_servers.my_server.command).toBe("x");
      // Top-level default and unmanaged tool preserved.
      expect(json.agent.tool_permissions.default).toBe("confirm");
      expect(json.agent.tool_permissions.tools.custom_tool.default).toBe("allow");
      // Managed tool written.
      expect(json.agent.tool_permissions.tools.terminal.default).toBe("deny");
    });

    it("should keep an existing tool entry when its category yields no usable rules", async () => {
      await writeFileContent(
        join(testDir, ".zed", "settings.json"),
        JSON.stringify({
          agent: {
            tool_permissions: {
              tools: {
                terminal: { default: "allow" },
              },
            },
          },
        }),
      );

      // `bash` maps to `terminal` but carries no rules, so it produces no entry
      // and must not drop the user's existing `terminal` config.
      const rulesyncPermissions = createRulesyncPermissions({
        bash: {},
      });

      const permissions = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.agent.tool_permissions.tools.terminal.default).toBe("allow");
    });

    it("should throw on a malformed existing settings.json instead of overwriting it", async () => {
      await writeFileContent(join(testDir, ".zed", "settings.json"), "{ not valid json");

      const rulesyncPermissions = createRulesyncPermissions({ bash: { "*": "deny" } });

      await expect(
        ZedPermissions.fromRulesyncPermissions({ outputRoot: testDir, rulesyncPermissions }),
      ).rejects.toThrow(/Failed to parse existing Zed settings/);
    });
  });

  describe("toRulesyncPermissions", () => {
    it("should throw on malformed settings content", async () => {
      await writeFileContent(join(testDir, ".zed", "settings.json"), "{ not valid json");

      const permissions = await ZedPermissions.fromFile({ outputRoot: testDir });

      expect(() => permissions.toRulesyncPermissions()).toThrow(
        /Failed to parse Zed permissions content/,
      );
    });

    it("should round-trip agent.tool_permissions back to canonical permissions", async () => {
      await writeFileContent(
        join(testDir, ".zed", "settings.json"),
        JSON.stringify({
          agent: {
            tool_permissions: {
              tools: {
                terminal: {
                  default: "confirm",
                  always_allow: [{ pattern: "git *", case_sensitive: false }],
                  always_deny: [{ pattern: "rm *", case_sensitive: false }],
                },
                read_file: {
                  always_confirm: [{ pattern: "secret", case_sensitive: false }],
                },
              },
            },
          },
        }),
      );

      const permissions = await ZedPermissions.fromFile({ outputRoot: testDir });
      const rulesync = permissions.toRulesyncPermissions();
      const json = JSON.parse(rulesync.getFileContent());

      expect(json.permission.bash).toEqual({ "*": "ask", "git *": "allow", "rm *": "deny" });
      expect(json.permission.read).toEqual({ secret: "ask" });
    });

    it("should return an empty permission object when no tool permissions exist", async () => {
      await writeFileContent(
        join(testDir, ".zed", "settings.json"),
        JSON.stringify({ theme: "One Dark" }),
      );

      const permissions = await ZedPermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(permissions.toRulesyncPermissions().getFileContent());

      expect(json.permission).toEqual({});
    });
  });

  describe("round-trip", () => {
    it("should preserve permissions across generate → import", async () => {
      const rulesyncPermissions = createRulesyncPermissions({
        bash: { "*": "ask", "git *": "allow" },
        webfetch: { "domain:github.com": "allow" },
      });

      const generated = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });
      await writeFileContent(join(testDir, ".zed", "settings.json"), generated.getFileContent());

      const imported = await ZedPermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(imported.toRulesyncPermissions().getFileContent());

      expect(json.permission.bash).toEqual({ "*": "ask", "git *": "allow" });
      expect(json.permission.webfetch).toEqual({ "domain:github.com": "allow" });
    });

    it("should round-trip websearch via Zed's search_web tool name", async () => {
      const rulesyncPermissions = createRulesyncPermissions({
        websearch: { "*": "allow" },
      });

      const generated = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      // `websearch` must map to Zed's built-in `search_web` tool, not `web_search`.
      const generatedJson = JSON.parse(generated.getFileContent());
      expect(generatedJson.agent.tool_permissions.tools.search_web.default).toBe("allow");
      expect(generatedJson.agent.tool_permissions.tools.web_search).toBeUndefined();

      await writeFileContent(join(testDir, ".zed", "settings.json"), generated.getFileContent());
      const imported = await ZedPermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(imported.toRulesyncPermissions().getFileContent());

      expect(json.permission.websearch).toEqual({ "*": "allow" });
    });

    it("should pass through non-canonical mcp tool keys across generate → import", async () => {
      const rulesyncPermissions = createRulesyncPermissions({
        "mcp:context7:get-docs": { "*": "allow", secret: "deny" },
      });

      const generated = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      // The unknown tool key is written verbatim under agent.tool_permissions.tools.
      const generatedJson = JSON.parse(generated.getFileContent());
      expect(generatedJson.agent.tool_permissions.tools["mcp:context7:get-docs"].default).toBe(
        "allow",
      );

      await writeFileContent(join(testDir, ".zed", "settings.json"), generated.getFileContent());
      const imported = await ZedPermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(imported.toRulesyncPermissions().getFileContent());

      expect(json.permission["mcp:context7:get-docs"]).toEqual({ "*": "allow", secret: "deny" });
    });
  });
});

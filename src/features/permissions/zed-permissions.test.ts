import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import { ZedPermissions } from "./zed-permissions.js";

const expectedZedGlobalDir =
  process.platform === "win32" ? join("AppData", "Roaming", "Zed") : join(".config", "zed");

function createRulesyncPermissions(permission: Record<string, Record<string, string>>) {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify({ permission }),
    validate: true,
  });
}

function createRulesyncPermissionsWithConfig(config: Record<string, unknown>) {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify(config),
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
      expect(paths.relativeDirPath).toBe(expectedZedGlobalDir);
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
      // `read` is one of Zed's excluded read-only tools, so no entry is written.
      expect(tools.read_file).toBeUndefined();
    });

    it("writes nothing for the categories Zed does not gate", async () => {
      const warn = vi.fn();

      const permissions = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          bash: { "*": "ask" },
          read: { ".env": "deny" },
          grep: { "*": "deny" },
          glob: { "*": "deny" },
          // A category naming the Zed tool directly is excluded the same way.
          list_directory: { "*": "deny" },
        }),
        logger: { warn } as never,
      });

      const tools = JSON.parse(permissions.getFileContent()).agent.tool_permissions.tools;

      expect(Object.keys(tools)).toEqual(["terminal"]);
      expect(warn).toHaveBeenCalledTimes(1);
      const [warning] = warn.mock.calls[0] as [string];
      expect(warning).toContain("private_files");
      expect(warning).toContain('"read", "grep", "glob", "list_directory"');
    });

    it("leaves an existing entry for an excluded tool in place", async () => {
      const warn = vi.fn();
      await writeFileContent(
        join(testDir, ".zed", "settings.json"),
        JSON.stringify({
          agent: {
            tool_permissions: {
              tools: {
                // Inert either way, and rulesync cannot tell its own earlier
                // output from an entry the user wrote, so it is not deleted.
                read_file: { default: "deny" },
                custom_tool: { default: "allow" },
              },
            },
          },
        }),
      );

      const permissions = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          bash: { "*": "ask" },
          read: { ".env": "deny" },
        }),
        logger: { warn } as never,
      });

      const tools = JSON.parse(permissions.getFileContent()).agent.tool_permissions.tools;
      expect(tools.read_file).toEqual({ default: "deny" });
      expect(tools.custom_tool).toEqual({ default: "allow" });
    });

    it("does not warn when an excluded category only allows", async () => {
      const warn = vi.fn();

      await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          bash: { "*": "ask" },
          // Zed leaves these tools ungoverned, which is what `allow` asked for.
          read: { "*": "allow" },
        }),
        logger: { warn } as never,
      });

      expect(warn).not.toHaveBeenCalled();
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

    it("should map the canonical * category's catch-all onto the global default", async () => {
      const rulesyncPermissions = createRulesyncPermissions({
        "*": { "*": "allow" },
        bash: { "rm *": "deny" },
      });

      const permissions = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.agent.tool_permissions.default).toBe("allow");
      // `*` is not a Zed tool name, so no inert tools entry may be written.
      expect(json.agent.tool_permissions.tools["*"]).toBeUndefined();
      expect(json.agent.tool_permissions.tools.terminal.always_deny).toEqual([
        { pattern: "rm *", case_sensitive: false },
      ]);
    });

    it("should drop a pattern-scoped * category rule with a warning instead of writing inert config", async () => {
      const warn = vi.fn();
      const rulesyncPermissions = createRulesyncPermissions({
        "*": { "*": "deny", "src/**": "allow" },
      });

      const permissions = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger: { warn } as unknown as Logger,
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.agent.tool_permissions.default).toBe("deny");
      expect(json.agent.tool_permissions.tools["*"]).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('pattern "src/**"'));
    });

    it("should replace the stale tools['*'] entry older versions wrote for the * category", async () => {
      await writeFileContent(
        join(testDir, ".zed", "settings.json"),
        JSON.stringify({
          agent: {
            tool_permissions: {
              tools: { "*": { default: "allow" }, custom_tool: { default: "allow" } },
            },
          },
        }),
      );

      const rulesyncPermissions = createRulesyncPermissions({
        "*": { "*": "ask" },
      });

      const permissions = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.agent.tool_permissions.default).toBe("confirm");
      expect(json.agent.tool_permissions.tools["*"]).toBeUndefined();
      // A hand-written entry for an unmanaged tool still survives.
      expect(json.agent.tool_permissions.tools.custom_tool.default).toBe("allow");
    });

    it("should preserve a user-set global default when the canonical config has no * category", async () => {
      await writeFileContent(
        join(testDir, ".zed", "settings.json"),
        JSON.stringify({
          agent: { tool_permissions: { default: "deny" } },
        }),
      );

      const rulesyncPermissions = createRulesyncPermissions({
        bash: { "*": "ask" },
      });

      const permissions = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.agent.tool_permissions.default).toBe("deny");
    });

    it("should map canonical write onto Zed's write_file tool", async () => {
      const rulesyncPermissions = createRulesyncPermissions({
        write: { "*": "deny" },
      });

      const permissions = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.agent.tool_permissions.tools.write_file.default).toBe("deny");
      expect(json.agent.tool_permissions.tools.write).toBeUndefined();
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

    it("should let the enforced default win over a stale tools['*'] entry on import", async () => {
      await writeFileContent(
        join(testDir, ".zed", "settings.json"),
        JSON.stringify({
          agent: {
            tool_permissions: {
              default: "deny",
              tools: { "*": { default: "allow" } },
            },
          },
        }),
      );

      const permissions = await ZedPermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(permissions.toRulesyncPermissions().getFileContent());

      // Zed enforces the top-level default and ignores tools["*"]; the value
      // Zed acts on must not lose to the one it ignores.
      expect(json.permission["*"]).toEqual({ "*": "deny" });
    });

    it("should recover a stale tools['*'] default when no enforced default exists", async () => {
      await writeFileContent(
        join(testDir, ".zed", "settings.json"),
        JSON.stringify({
          agent: {
            tool_permissions: {
              tools: { "*": { default: "confirm" } },
            },
          },
        }),
      );

      const permissions = await ZedPermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(permissions.toRulesyncPermissions().getFileContent());

      expect(json.permission["*"]).toEqual({ "*": "ask" });
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

    it("should round-trip the * category through agent.tool_permissions.default", async () => {
      const rulesyncPermissions = createRulesyncPermissions({
        "*": { "*": "deny" },
      });

      const generated = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });
      await writeFileContent(join(testDir, ".zed", "settings.json"), generated.getFileContent());

      const imported = await ZedPermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(imported.toRulesyncPermissions().getFileContent());

      expect(json.permission["*"]).toEqual({ "*": "deny" });
    });

    it("should round-trip write via Zed's write_file tool name", async () => {
      const rulesyncPermissions = createRulesyncPermissions({
        write: { "*": "ask", "docs/**": "allow" },
      });

      const generated = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });
      await writeFileContent(join(testDir, ".zed", "settings.json"), generated.getFileContent());

      const imported = await ZedPermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(imported.toRulesyncPermissions().getFileContent());

      expect(json.permission.write).toEqual({ "*": "ask", "docs/**": "allow" });
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

    it("should translate a canonical mcp category into Zed's mcp:server:tool key", async () => {
      const rulesyncPermissions = createRulesyncPermissions({
        mcp__context7__get_docs: { "*": "allow" },
      });

      const generated = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const generatedJson = JSON.parse(generated.getFileContent());
      const tools = generatedJson.agent.tool_permissions.tools;
      expect(tools["mcp:context7:get_docs"]).toEqual({ default: "allow" });
      // The canonical spelling is a key Zed never looks up, so it must not appear.
      expect(tools.mcp__context7__get_docs).toBeUndefined();

      await writeFileContent(join(testDir, ".zed", "settings.json"), generated.getFileContent());
      const imported = await ZedPermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(imported.toRulesyncPermissions().getFileContent());

      expect(json.permission.mcp__context7__get_docs).toEqual({ "*": "allow" });
    });

    it("should split only the first separator so an underscored tool name survives", async () => {
      const rulesyncPermissions = createRulesyncPermissions({
        mcp__github__create__issue: { "*": "allow" },
      });

      const generated = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      // Zed builds its id as `mcp:<server>:<tool>` without escaping either name,
      // so `create__issue` is a legitimate tool name and must not be rewritten
      // into a third key.
      expect(
        JSON.parse(generated.getFileContent()).agent.tool_permissions.tools[
          "mcp:github:create__issue"
        ],
      ).toEqual({ default: "allow" });

      await writeFileContent(join(testDir, ".zed", "settings.json"), generated.getFileContent());
      const imported = await ZedPermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(imported.toRulesyncPermissions().getFileContent());

      expect(json.permission.mcp__github__create__issue).toEqual({ "*": "allow" });
    });

    it("should replace the canonical-spelled key an earlier version wrote", async () => {
      await writeFileContent(
        join(testDir, ".zed", "settings.json"),
        JSON.stringify({
          agent: {
            tool_permissions: {
              tools: {
                // What rulesync wrote before the translation existed.
                mcp__context7__get_docs: {
                  default: "deny",
                  always_allow: [{ pattern: "safe", case_sensitive: false }],
                },
              },
            },
          },
        }),
      );

      const generated = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          mcp__context7__get_docs: { "*": "allow" },
        }),
      });

      const tools = JSON.parse(generated.getFileContent()).agent.tool_permissions.tools;
      expect(tools["mcp:context7:get_docs"]).toEqual({ default: "allow" });
      // The dead key is swept, so it cannot resurrect its stale rules on import.
      expect(tools.mcp__context7__get_docs).toBeUndefined();
    });

    it("should drop pattern-scoped rules inside an mcp category with a warning", async () => {
      const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
      const rulesyncPermissions = createRulesyncPermissions({
        mcp__context7__get_docs: { "*": "allow", secret: "deny" },
      });

      const generated = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger: logger as unknown as Logger,
      });

      const tool = JSON.parse(generated.getFileContent()).agent.tool_permissions.tools[
        "mcp:context7:get_docs"
      ];
      // Zed matches patterns against a tool's text input and an MCP tool has
      // none, so only the catch-all survives as the tool's default.
      expect(tool).toEqual({ default: "allow" });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"secret"'));
    });

    it("should drop an mcp category that omits or wildcards either half", async () => {
      const warn = vi.fn();

      const generated = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          // Zed matches the full mcp:<server>:<tool> triple by exact key, with
          // no glob or prefix matching, so none of these reaches anything.
          mcp__context7: { "*": "deny" },
          "mcp__context7__*": { "*": "deny" },
          "mcp__*__get_docs": { "*": "deny" },
          bash: { "*": "ask" },
        }),
        logger: { warn } as unknown as Logger,
      });

      const tools = JSON.parse(generated.getFileContent()).agent.tool_permissions.tools;
      expect(Object.keys(tools)).toEqual(["terminal"]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'dropping the "mcp__context7", "mcp__context7__*", "mcp__*__get_docs" categories',
        ),
      );
    });

    it("should sweep a canonical-spelled key even after its category is removed", async () => {
      await writeFileContent(
        join(testDir, ".zed", "settings.json"),
        JSON.stringify({
          agent: {
            tool_permissions: {
              tools: {
                mcp__context7__get_docs: { default: "deny" },
                custom_tool: { default: "allow" },
              },
            },
          },
        }),
      );

      // The MCP category is gone from the canonical config entirely.
      const generated = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ bash: { "*": "allow" } }),
      });

      const tools = JSON.parse(generated.getFileContent()).agent.tool_permissions.tools;
      // The dead key is rulesync's own output either way, so it goes...
      expect(tools.mcp__context7__get_docs).toBeUndefined();
      // ...while a genuine Zed tool name the user may own is left alone.
      expect(tools.custom_tool).toEqual({ default: "allow" });
    });

    it("should normalize a Zed-spelled mcp key to the canonical category on import", async () => {
      const rulesyncPermissions = createRulesyncPermissions({
        "mcp:context7:get_docs": { "*": "allow" },
      });

      const generated = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      // Already a Zed tool name, so it is written unchanged...
      expect(
        JSON.parse(generated.getFileContent()).agent.tool_permissions.tools[
          "mcp:context7:get_docs"
        ],
      ).toEqual({ default: "allow" });

      await writeFileContent(join(testDir, ".zed", "settings.json"), generated.getFileContent());
      const imported = await ZedPermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(imported.toRulesyncPermissions().getFileContent());

      // ...but import returns the canonical spelling other targets understand.
      expect(json.permission.mcp__context7__get_docs).toEqual({ "*": "allow" });
    });
  });

  describe("zed override (sandbox_permissions / profiles)", () => {
    const sandboxPermissions = {
      network_hosts: ["*.github.com", "registry.npmjs.org"],
      write_paths: ["/tmp/build"],
      allow_fs_write_all: false,
    };
    const profiles = {
      review: {
        name: "Review",
        tools: { terminal: false, edit_file: true },
        enable_all_context_servers: false,
      },
    };

    it("should write both blocks verbatim into agent alongside tool_permissions", async () => {
      const rulesyncPermissions = createRulesyncPermissionsWithConfig({
        permission: { bash: { "*": "ask" } },
        zed: { sandbox_permissions: sandboxPermissions, profiles },
      });

      const generated = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });
      const agent = JSON.parse(generated.getFileContent()).agent;

      expect(agent.sandbox_permissions).toEqual(sandboxPermissions);
      expect(agent.profiles).toEqual(profiles);
      expect(agent.tool_permissions.tools.terminal).toEqual({ default: "confirm" });
    });

    it("should round-trip both blocks through generate → import in project scope", async () => {
      const rulesyncPermissions = createRulesyncPermissionsWithConfig({
        permission: { bash: { "*": "deny" } },
        zed: { sandbox_permissions: sandboxPermissions, profiles },
      });

      const generated = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });
      await writeFileContent(join(testDir, ".zed", "settings.json"), generated.getFileContent());

      const imported = await ZedPermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(imported.toRulesyncPermissions().getFileContent());

      expect(json.permission.bash).toEqual({ "*": "deny" });
      expect(json.zed).toEqual({ sandbox_permissions: sandboxPermissions, profiles });
    });

    it("should round-trip both blocks through generate → import in global scope", async () => {
      const rulesyncPermissions = createRulesyncPermissionsWithConfig({
        permission: { bash: { "*": "deny" } },
        zed: { sandbox_permissions: sandboxPermissions, profiles },
      });

      const generated = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        global: true,
      });
      await writeFileContent(
        join(testDir, expectedZedGlobalDir, "settings.json"),
        generated.getFileContent(),
      );

      const imported = await ZedPermissions.fromFile({ outputRoot: testDir, global: true });
      const json = JSON.parse(imported.toRulesyncPermissions().getFileContent());

      expect(json.zed).toEqual({ sandbox_permissions: sandboxPermissions, profiles });
    });

    it("should omit the zed override on import when the settings carry neither block", async () => {
      await writeFileContent(
        join(testDir, ".zed", "settings.json"),
        JSON.stringify({
          agent: { tool_permissions: { tools: { terminal: { default: "deny" } } } },
        }),
      );

      const imported = await ZedPermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(imported.toRulesyncPermissions().getFileContent());

      expect(json.zed).toBeUndefined();
    });

    it("should replace an existing block wholesale but preserve one the override omits", async () => {
      await writeFileContent(
        join(testDir, ".zed", "settings.json"),
        JSON.stringify({
          agent: {
            sandbox_permissions: { network_hosts: ["old.example.com"], allow_all_hosts: true },
            profiles: { legacy: { name: "Legacy" } },
          },
        }),
      );

      const rulesyncPermissions = createRulesyncPermissionsWithConfig({
        permission: { bash: { "*": "ask" } },
        zed: { sandbox_permissions: { network_hosts: ["new.example.com"] } },
      });

      const generated = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });
      const agent = JSON.parse(generated.getFileContent()).agent;

      // Authored: replaced as one unit, so the stale allow_all_hosts is gone.
      expect(agent.sandbox_permissions).toEqual({ network_hosts: ["new.example.com"] });
      // Not authored: left exactly as the user wrote it.
      expect(agent.profiles).toEqual({ legacy: { name: "Legacy" } });
    });

    it("should ignore a tool_permissions key in the override with a warning", async () => {
      const logger = { warn: vi.fn() } as unknown as Logger;
      const rulesyncPermissions = createRulesyncPermissionsWithConfig({
        permission: { bash: { "rm *": "deny" } },
        zed: {
          tool_permissions: { default: "allow", tools: { terminal: { default: "allow" } } },
        },
      });

      const generated = await ZedPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });
      const toolPermissions = JSON.parse(generated.getFileContent()).agent.tool_permissions;

      // The canonical deny stands; the override could not relax it.
      expect(toolPermissions.default).toBeUndefined();
      expect(toolPermissions.tools.terminal).toEqual({
        always_deny: [{ pattern: "rm *", case_sensitive: false }],
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("tool_permissions"));
    });
  });
});

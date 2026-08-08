import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { GrokcliPermissions } from "./grokcli-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

const makeRulesyncPermissions = (permission: Record<string, Record<string, string>>) =>
  new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify({ permission }),
  });

const readMode = (content: string): unknown => {
  const parsed = smolToml.parse(content);
  const ui = parsed.ui as Record<string, unknown> | undefined;
  return ui?.permission_mode;
};

const readPermission = (content: string): Record<string, unknown> => {
  const parsed = smolToml.parse(content);
  return (parsed.permission as Record<string, unknown> | undefined) ?? {};
};

describe("GrokcliPermissions", () => {
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
    it("writes to .grok/config.toml", () => {
      expect(GrokcliPermissions.getSettablePaths()).toEqual({
        relativeDirPath: ".grok",
        relativeFilePath: "config.toml",
      });
    });
  });

  describe("fromRulesyncPermissions (generate)", () => {
    it("collapses any deny/ask rule to permission_mode = ask", async () => {
      const permissions = await GrokcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          bash: { "*": "allow", "rm *": "deny" },
        }),
        global: true,
      });

      expect(readMode(permissions.getFileContent())).toBe("ask");
    });

    it("maps an all-allow config to permission_mode = always-approve", async () => {
      const permissions = await GrokcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          bash: { "*": "allow" },
          edit: { "*": "allow" },
        }),
        global: true,
      });

      expect(readMode(permissions.getFileContent())).toBe("always-approve");
    });

    it("defaults an empty config to permission_mode = ask", async () => {
      const permissions = await GrokcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({}),
        global: true,
      });

      expect(readMode(permissions.getFileContent())).toBe("ask");
    });

    it("preserves other config.toml keys (non-destructive merge)", async () => {
      await writeFileContent(
        join(testDir, ".grok", "config.toml"),
        ["[mcp_servers.example]", 'command = "echo"', "", "[ui]", 'theme = "dark"'].join("\n"),
      );

      const permissions = await GrokcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({ bash: { "*": "allow" } }),
        global: true,
      });

      const parsed = smolToml.parse(permissions.getFileContent());
      expect((parsed.ui as Record<string, unknown>).theme).toBe("dark");
      expect((parsed.ui as Record<string, unknown>).permission_mode).toBe("always-approve");
      expect(parsed.mcp_servers).toBeDefined();
    });

    it("emits fine-grained [permission] allow/deny/ask arrays as Claude-style entries", async () => {
      const permissions = await GrokcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          bash: { "*": "allow", "git *": "allow", "rm *": "deny" },
          read: { "src/**": "ask" },
          webfetch: { "*": "deny" },
        }),
        global: true,
      });

      const permission = readPermission(permissions.getFileContent());
      expect(permission.allow).toEqual(["Bash", "Bash(git *)"]);
      expect(permission.deny).toEqual(["Bash(rm *)", "WebFetch"]);
      expect(permission.ask).toEqual(["Read(src/**)"]);
    });

    it("collapses write onto Edit and maps mcp categories to MCPTool(...)", async () => {
      const permissions = await GrokcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          write: { "*": "allow" },
          mcp__github__list_issues: { "*": "allow" },
        }),
        global: true,
      });

      const permission = readPermission(permissions.getFileContent());
      expect(permission.allow).toEqual(["Edit", "MCPTool(github__list_issues)"]);
    });

    it("skips categories Grok cannot express", async () => {
      const permissions = await GrokcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          notebookedit: { "*": "deny" },
          glob: { "src/**": "allow" },
        }),
        global: true,
      });

      const permission = readPermission(permissions.getFileContent());
      expect(permission.allow).toEqual([]);
      expect(permission.deny).toEqual([]);
      expect(permission.ask).toEqual([]);
    });

    it("maps the websearch category onto Grok's WebSearch tool", async () => {
      const permissions = await GrokcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          websearch: { "*": "allow" },
        }),
        global: true,
      });

      const permission = readPermission(permissions.getFileContent());
      expect(permission.allow).toEqual(["WebSearch"]);
    });

    it("emits a concrete websearch pattern as WebSearch(pattern)", async () => {
      const permissions = await GrokcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          websearch: { "docs.x.ai/**": "deny" },
        }),
        global: true,
      });

      const permission = readPermission(permissions.getFileContent());
      expect(permission.deny).toEqual(["WebSearch(docs.x.ai/**)"]);
    });

    it("resolves edit/write collapse collisions to the stricter action (no contradiction)", async () => {
      const permissions = await GrokcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          edit: { "*": "allow" },
          write: { "*": "deny" },
        }),
        global: true,
      });

      const permission = readPermission(permissions.getFileContent());
      // `Edit` must appear only in deny (the stricter action), never in both.
      expect(permission.deny).toEqual(["Edit"]);
      expect(permission.allow).toEqual([]);
    });

    it("preserves user-authored entries for tools rulesync cannot model", async () => {
      await writeFileContent(
        join(testDir, ".grok", "config.toml"),
        ["[permission]", 'allow = ["any", "Bash(stale)"]', ""].join("\n"),
      );

      const permissions = await GrokcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({ bash: { "git *": "allow" } }),
        global: true,
      });

      const permission = readPermission(permissions.getFileContent());
      // The unmanaged `any` entry survives; the managed `Bash(stale)` one
      // (rulesync owns Bash) is replaced by the generated rule.
      expect(permission.allow).toEqual(["Bash(git *)", "any"]);
    });

    it("preserves existing [permission] keys such as verbose rules", async () => {
      await writeFileContent(
        join(testDir, ".grok", "config.toml"),
        ["[[permission.rules]]", 'action = "deny"', 'tool = "bash"', 'pattern = "curl *"', ""].join(
          "\n",
        ),
      );

      const permissions = await GrokcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({ bash: { "git *": "allow" } }),
        global: true,
      });

      const permission = readPermission(permissions.getFileContent());
      expect(permission.allow).toEqual(["Bash(git *)"]);
      expect(permission.rules).toBeDefined();
    });

    it("generates the fine-grained [permission] arrays in project scope", async () => {
      const permissions = await GrokcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          bash: { "git *": "allow", "rm *": "deny" },
        }),
        global: false,
      });

      expect(permissions.getRelativeDirPath()).toBe(".grok");
      expect(permissions.getRelativeFilePath()).toBe("config.toml");
      const permission = readPermission(permissions.getFileContent());
      expect(permission.allow).toEqual(["Bash(git *)"]);
      expect(permission.deny).toEqual(["Bash(rm *)"]);
      // The coarse `[ui] permission_mode` UI toggle is a user-level setting, so
      // it is not written in project scope.
      expect(readMode(permissions.getFileContent())).toBeUndefined();
    });
  });

  describe("toRulesyncPermissions (import)", () => {
    it("parses fine-grained [permission] arrays into canonical categories", async () => {
      await writeFileContent(
        join(testDir, ".grok", "config.toml"),
        [
          "[permission]",
          'allow = ["Bash(git *)", "Read"]',
          'deny = ["Bash(rm *)", "WebFetch"]',
          'ask = ["MCPTool(github__list_issues)"]',
          "",
        ].join("\n"),
      );
      const tool = await GrokcliPermissions.fromFile({ outputRoot: testDir, global: true });
      const json = JSON.parse(tool.toRulesyncPermissions().getFileContent());
      expect(json.permission.bash["git *"]).toBe("allow");
      expect(json.permission.read["*"]).toBe("allow");
      expect(json.permission.bash["rm *"]).toBe("deny");
      expect(json.permission.webfetch["*"]).toBe("deny");
      expect(json.permission.mcp__github__list_issues["*"]).toBe("ask");
    });

    it("parses WebSearch entries back into the canonical websearch category", async () => {
      await writeFileContent(
        join(testDir, ".grok", "config.toml"),
        ["[permission]", 'allow = ["WebSearch"]', 'deny = ["WebSearch(docs.x.ai/**)"]', ""].join(
          "\n",
        ),
      );
      const tool = await GrokcliPermissions.fromFile({ outputRoot: testDir, global: true });
      const json = JSON.parse(tool.toRulesyncPermissions().getFileContent());
      expect(json.permission.websearch["*"]).toBe("allow");
      expect(json.permission.websearch["docs.x.ai/**"]).toBe("deny");
    });

    it("round-trips the websearch category through export and re-import", async () => {
      const exported = await GrokcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          websearch: { "*": "allow", "example.com/**": "deny" },
        }),
        global: true,
      });
      const reimported = new GrokcliPermissions({
        outputRoot: testDir,
        relativeDirPath: ".grok",
        relativeFilePath: "config.toml",
        fileContent: exported.getFileContent(),
      });
      const json = JSON.parse(reimported.toRulesyncPermissions().getFileContent());
      expect(json.permission.websearch["*"]).toBe("allow");
      expect(json.permission.websearch["example.com/**"]).toBe("deny");
    });

    it("parses the verbose [[permission.rules]] form when no arrays are present", async () => {
      await writeFileContent(
        join(testDir, ".grok", "config.toml"),
        [
          "[ui]",
          'permission_mode = "always-approve"',
          "",
          "[[permission.rules]]",
          'action = "allow"',
          'tool = "bash"',
          'pattern = "git *"',
          "",
          "[[permission.rules]]",
          'action = "deny"',
          'tool = "Bash"',
          'pattern = "rm *"',
          "",
          "[[permission.rules]]",
          'action = "ask"',
          'tool = "read"',
          "",
          "[[permission.rules]]",
          'action = "allow"',
          'tool = "MCPTool"',
          'pattern = "github__list_issues"',
          "",
          // `mcp` is the spelling the settings reference documents for the
          // verbose form; `MCPTool` above is the compact-form name.
          "[[permission.rules]]",
          'action = "deny"',
          'tool = "mcp"',
          'pattern = "shell__exec"',
          "",
          "[[permission.rules]]",
          'action = "ask"',
          'tool = "mcp"',
          "",
        ].join("\n"),
      );
      const tool = await GrokcliPermissions.fromFile({ outputRoot: testDir, global: true });
      const json = JSON.parse(tool.toRulesyncPermissions().getFileContent());
      // The verbose form counts as fine-grained rules, so the coarse
      // `permission_mode` fallback is not taken despite `always-approve`.
      expect(json.permission.bash["git *"]).toBe("allow");
      expect(json.permission.bash["rm *"]).toBe("deny");
      // A rule without a `pattern` applies to the whole tool.
      expect(json.permission.read["*"]).toBe("ask");
      expect(json.permission.mcp__github__list_issues["*"]).toBe("allow");
      expect(json.permission.mcp__shell__exec["*"]).toBe("deny");
      expect(json.permission.mcp["*"]).toBe("ask");
      expect(json.permission.bash["*"]).toBeUndefined();
    });

    it("merges the verbose rules with the compact arrays, strictest winning", async () => {
      await writeFileContent(
        join(testDir, ".grok", "config.toml"),
        [
          "[permission]",
          'allow = ["Bash(git *)", "Read"]',
          "",
          "[[permission.rules]]",
          'action = "deny"',
          'tool = "bash"',
          'pattern = "git *"',
          "",
          "[[permission.rules]]",
          'action = "allow"',
          'tool = "grep"',
          "",
        ].join("\n"),
      );
      const tool = await GrokcliPermissions.fromFile({ outputRoot: testDir, global: true });
      const json = JSON.parse(tool.toRulesyncPermissions().getFileContent());
      expect(json.permission.bash["git *"]).toBe("deny");
      expect(json.permission.read["*"]).toBe("allow");
      expect(json.permission.grep["*"]).toBe("allow");
    });

    it("skips malformed or unsupported verbose rules without falling back", async () => {
      await writeFileContent(
        join(testDir, ".grok", "config.toml"),
        [
          "[ui]",
          'permission_mode = "always-approve"',
          "",
          "[[permission.rules]]",
          'action = "sometimes"',
          'tool = "bash"',
          "",
          "[[permission.rules]]",
          'action = "deny"',
          'tool = "any"',
          "",
          "[[permission.rules]]",
          'action = "allow"',
          'tool = "edit"',
          'pattern = "src/**"',
          "",
        ].join("\n"),
      );
      const tool = await GrokcliPermissions.fromFile({ outputRoot: testDir, global: true });
      const json = JSON.parse(tool.toRulesyncPermissions().getFileContent());
      expect(json.permission.edit["src/**"]).toBe("allow");
      expect(json.permission.bash).toBeUndefined();
      expect(json.permission.any).toBeUndefined();
    });

    it("keeps the coarse fallback out of reach when rules are present but all unsupported", async () => {
      await writeFileContent(
        join(testDir, ".grok", "config.toml"),
        [
          "[ui]",
          'permission_mode = "always-approve"',
          "",
          "[[permission.rules]]",
          'action = "deny"',
          'tool = "any"',
          "",
        ].join("\n"),
      );
      const tool = await GrokcliPermissions.fromFile({ outputRoot: testDir, global: true });
      const json = JSON.parse(tool.toRulesyncPermissions().getFileContent());
      expect(json.permission).toEqual({});
    });

    it("applies deny > ask > allow precedence on collision", async () => {
      await writeFileContent(
        join(testDir, ".grok", "config.toml"),
        ["[permission]", 'allow = ["Bash(x)"]', 'deny = ["Bash(x)"]', ""].join("\n"),
      );
      const tool = await GrokcliPermissions.fromFile({ outputRoot: testDir, global: true });
      const json = JSON.parse(tool.toRulesyncPermissions().getFileContent());
      expect(json.permission.bash.x).toBe("deny");
    });

    it("round-trips fine-grained rules through export and re-import", async () => {
      const exported = await GrokcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          bash: { "git *": "allow", "rm *": "deny" },
          read: { "src/**": "ask" },
        }),
        global: true,
      });
      const reimported = new GrokcliPermissions({
        outputRoot: testDir,
        relativeDirPath: ".grok",
        relativeFilePath: "config.toml",
        fileContent: exported.getFileContent(),
      });
      const json = JSON.parse(reimported.toRulesyncPermissions().getFileContent());
      expect(json.permission.bash["git *"]).toBe("allow");
      expect(json.permission.bash["rm *"]).toBe("deny");
      expect(json.permission.read["src/**"]).toBe("ask");
    });

    it("maps always-approve back to bash allow", async () => {
      await writeFileContent(
        join(testDir, ".grok", "config.toml"),
        ["[ui]", 'permission_mode = "always-approve"'].join("\n"),
      );
      const tool = await GrokcliPermissions.fromFile({ outputRoot: testDir, global: true });
      const json = JSON.parse(tool.toRulesyncPermissions().getFileContent());
      expect(json.permission.bash["*"]).toBe("allow");
    });

    it("falls back to permission_mode when the [permission] arrays are all empty", async () => {
      await writeFileContent(
        join(testDir, ".grok", "config.toml"),
        [
          "[ui]",
          'permission_mode = "always-approve"',
          "",
          "[permission]",
          "allow = []",
          "deny = []",
          "ask = []",
          "",
        ].join("\n"),
      );
      const tool = await GrokcliPermissions.fromFile({ outputRoot: testDir, global: true });
      const json = JSON.parse(tool.toRulesyncPermissions().getFileContent());
      expect(json.permission.bash["*"]).toBe("allow");
    });

    it("maps ask (and missing mode) back to bash ask", async () => {
      await writeFileContent(
        join(testDir, ".grok", "config.toml"),
        ["[ui]", 'permission_mode = "ask"'].join("\n"),
      );
      const tool = await GrokcliPermissions.fromFile({ outputRoot: testDir, global: true });
      const json = JSON.parse(tool.toRulesyncPermissions().getFileContent());
      expect(json.permission.bash["*"]).toBe("ask");
    });
  });

  describe("fromFile", () => {
    it("reads the project-scoped .grok/config.toml when global is false", async () => {
      await writeFileContent(
        join(testDir, ".grok", "config.toml"),
        ["[permission]", 'allow = ["Bash(git *)"]', ""].join("\n"),
      );
      const tool = await GrokcliPermissions.fromFile({ outputRoot: testDir, global: false });
      const json = JSON.parse(tool.toRulesyncPermissions().getFileContent());
      expect(json.permission.bash["git *"]).toBe("allow");
    });
  });
});

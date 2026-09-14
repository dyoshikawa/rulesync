import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CommandcodePermissions } from "./commandcode-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

const SETTINGS_DIR = ".commandcode";
const SETTINGS_FILE = "settings.json";

function createRulesyncPermissions(permission: Record<string, Record<string, string>>) {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify({ permission }),
    validate: true,
  });
}

async function writeSettings({
  testDir,
  settings,
}: {
  testDir: string;
  settings: Record<string, unknown>;
}): Promise<void> {
  const dir = join(testDir, SETTINGS_DIR);
  await ensureDir(dir);
  await writeFileContent(join(dir, SETTINGS_FILE), JSON.stringify(settings, null, 2));
}

describe("CommandcodePermissions", () => {
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
    it("returns .commandcode/settings.json for project scope", () => {
      const paths = CommandcodePermissions.getSettablePaths();
      expect(paths.relativeDirPath).toBe(SETTINGS_DIR);
      expect(paths.relativeFilePath).toBe(SETTINGS_FILE);
    });

    it("returns the same relative path for global scope", () => {
      const paths = CommandcodePermissions.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(SETTINGS_DIR);
      expect(paths.relativeFilePath).toBe(SETTINGS_FILE);
    });
  });

  describe("isDeletable", () => {
    it("is not deletable (shared settings file)", () => {
      const permissions = CommandcodePermissions.forDeletion({
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: SETTINGS_FILE,
      });
      expect(permissions.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("writes friendly tool names with patterns into allow/ask/deny", async () => {
      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          bash: { "git *": "allow", "rm -rf *": "deny", "npm publish *": "ask" },
          read: { "*": "allow" },
          edit: { "src/**": "allow" },
          write: { ".env*": "deny" },
          webfetch: { "https://docs.example.com/*": "allow" },
          websearch: { "*": "ask" },
        }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.permissions).toEqual({
        allow: ["Edit(src/**)", "Read", "Shell(git *)", "WebFetch(https://docs.example.com/*)"],
        ask: ["Shell(npm publish *)", "WebSearch"],
        deny: ["Shell(rm -rf *)", "Write(.env*)"],
      });
    });

    it("omits empty lists instead of writing []", async () => {
      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ bash: { "git *": "allow" } }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.permissions).toEqual({ allow: ["Shell(git *)"] });
      expect(json.permissions).not.toHaveProperty("ask");
      expect(json.permissions).not.toHaveProperty("deny");
    });

    it("writes canonical mcp__server__tool names and the mcp__* wildcard", async () => {
      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          mcp__github__get_issue: { "*": "allow" },
          mcp__filesystem: { "*": "deny" },
          mcp: { "*": "ask", playwright: "deny" },
        }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.permissions).toEqual({
        allow: ["mcp__github__get_issue"],
        ask: ["mcp__*"],
        deny: ["mcp__filesystem", "mcp__playwright"],
      });
    });

    it("keeps the pattern of a scoped mcp rule as its specifier instead of widening", async () => {
      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          mcp__github__get_issue: { "owner:foo": "allow", "owner:bar": "deny" },
        }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.permissions).toEqual({
        allow: ["mcp__github__get_issue(owner:foo)"],
        deny: ["mcp__github__get_issue(owner:bar)"],
      });
    });

    it("writes the bare * rule for the all-tools category in deny and ask only", async () => {
      const logger = createMockLogger();
      const deny = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions: createRulesyncPermissions({ "*": { "*": "deny" } }),
      });
      expect(JSON.parse(deny.getFileContent()).permissions).toEqual({ deny: ["*"] });
      expect(logger.warn).not.toHaveBeenCalled();

      const allow = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions: createRulesyncPermissions({ "*": { "*": "allow" } }),
      });
      expect(JSON.parse(allow.getFileContent()).permissions).toEqual({});
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("ignores '*' in \"allow\""));
    });

    it("drops mcp__* from allow with a warning", async () => {
      const logger = createMockLogger();
      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions: createRulesyncPermissions({ mcp: { "*": "allow" } }),
      });
      expect(JSON.parse(permissions.getFileContent()).permissions).toEqual({});
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("mcp__*"));
    });

    it("maps narrower all-tools patterns onto Shell via honorAllToolsOnBash", async () => {
      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          "*": { "rm -rf *": "deny" },
          bash: { "git *": "allow" },
        }),
      });
      expect(JSON.parse(permissions.getFileContent()).permissions).toEqual({
        allow: ["Shell(git *)"],
        deny: ["Shell(rm -rf *)"],
      });
    });

    it("warns when a narrower all-tools deny has no bash category to land on", async () => {
      const logger = createMockLogger();
      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions: createRulesyncPermissions({ "*": { "rm -rf *": "deny" } }),
      });
      expect(JSON.parse(permissions.getFileContent()).permissions).toEqual({});
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("'rm -rf *'"));
    });

    it("writes grep, glob, notebookedit and agent as their own rule names", async () => {
      const logger = createMockLogger();
      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions: createRulesyncPermissions({
          grep: { "*": "allow" },
          glob: { "src/**": "deny" },
          notebookedit: { "*": "deny" },
          agent: { "*": "ask" },
          bash: { "git *": "allow" },
        }),
      });
      expect(JSON.parse(permissions.getFileContent()).permissions).toEqual({
        allow: ["Grep", "Shell(git *)"],
        ask: ["Agent"],
        deny: ["Glob(src/**)", "NotebookEdit"],
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("skips categories Command Code cannot express and warns on deny", async () => {
      const logger = createMockLogger();
      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions: createRulesyncPermissions({
          custom_tool: { "*": "allow" },
          other_tool: { "*": "deny" },
          bash: { "git *": "allow" },
        }),
      });
      expect(JSON.parse(permissions.getFileContent()).permissions).toEqual({
        allow: ["Shell(git *)"],
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("'other_tool'"));
    });

    it("resolves colliding rules to the strictest action", async () => {
      const logger = createMockLogger();
      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions: createRulesyncPermissions({
          mcp: { "*": "allow" },
          mcp__github__get_issue: { "*": "allow" },
          "*": { "*": "ask" },
          bash: { "*": "deny" },
        }),
      });
      const json = JSON.parse(permissions.getFileContent());
      expect(json.permissions).toEqual({
        allow: ["mcp__github__get_issue"],
        ask: ["*"],
        deny: ["Shell"],
      });
    });

    it("preserves sibling permission settings and rules for unmodeled tools", async () => {
      const logger = createMockLogger();
      await writeSettings({
        testDir,
        settings: {
          model: "gpt-5",
          hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] },
          permissions: {
            defaultMode: "acceptEdits",
            additionalDirectories: ["../shared"],
            disableBypass: true,
            allow: ["Shell(stale *)", "edit_file", "mcp__github__*"],
            ask: ["read_directory(/tmp)"],
            deny: ["Shell(rm -rf /)", "edit_*"],
          },
        },
      });

      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions: createRulesyncPermissions({
          bash: { "git *": "allow" },
          write: { ".env*": "deny" },
        }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.model).toBe("gpt-5");
      expect(json.hooks).toEqual({
        Stop: [{ hooks: [{ type: "command", command: "echo done" }] }],
      });
      expect(json.permissions).toEqual({
        defaultMode: "acceptEdits",
        additionalDirectories: ["../shared"],
        disableBypass: true,
        allow: ["Shell(git *)", "edit_file", "mcp__github__*"],
        ask: ["read_directory(/tmp)"],
        deny: ["Write(.env*)", "edit_*"],
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("preserves entries of modeled tools the canonical config does not mention", async () => {
      // Command Code writes interactive approvals into the same lists, so a
      // user-written `deny` for a tool rulesync is not managing must survive.
      await writeSettings({
        testDir,
        settings: {
          permissions: {
            allow: ["Read", "Shell(stale *)", "mcp__github__get_issue(owner:foo)"],
            deny: ["Read(./.env)", "Bash(rm -rf /)", "*"],
          },
        },
      });

      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          bash: { "git *": "allow" },
        }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.permissions).toEqual({
        allow: ["Read", "Shell(git *)", "mcp__github__get_issue(owner:foo)"],
        deny: ["*", "Read(./.env)"],
      });
    });

    it("removes a stale list when the regenerated one is empty", async () => {
      await writeSettings({
        testDir,
        settings: { permissions: { deny: ["Shell(stale *)"], defaultMode: "plan" } },
      });

      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ bash: { "git *": "allow" } }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.permissions).toEqual({ defaultMode: "plan", allow: ["Shell(git *)"] });
    });

    it("applies the commandcode-scoped override before writing", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "git *": "allow" } },
          commandcode: { permission: { bash: { "git push *": "ask" } } },
        }),
        validate: true,
      }).forTarget({ toolTarget: "commandcode" });

      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      // forTarget replaces the whole `bash` category with the override block.
      const json = JSON.parse(permissions.getFileContent());
      expect(json.permissions).toEqual({ ask: ["Shell(git push *)"] });
    });

    it("uses the same relative path in global mode", async () => {
      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        global: true,
        rulesyncPermissions: createRulesyncPermissions({ bash: { "git *": "allow" } }),
      });
      expect(permissions.getRelativeDirPath()).toBe(SETTINGS_DIR);
      expect(permissions.getRelativeFilePath()).toBe(SETTINGS_FILE);
      expect(JSON.parse(permissions.getFileContent()).permissions).toEqual({
        allow: ["Shell(git *)"],
      });
    });

    it("throws when the existing settings file is not a JSON object", async () => {
      const dir = join(testDir, SETTINGS_DIR);
      await ensureDir(dir);
      await writeFileContent(join(dir, SETTINGS_FILE), "[]");

      await expect(
        CommandcodePermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions: createRulesyncPermissions({ bash: { "git *": "allow" } }),
        }),
      ).rejects.toThrow(/Failed to parse Command Code settings/);
    });

    it("throws when the existing settings file is invalid JSON", async () => {
      const dir = join(testDir, SETTINGS_DIR);
      await ensureDir(dir);
      await writeFileContent(join(dir, SETTINGS_FILE), "{ not json");

      await expect(
        CommandcodePermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions: createRulesyncPermissions({ bash: { "git *": "allow" } }),
        }),
      ).rejects.toThrow(/Failed to parse Command Code settings/);
    });
  });

  describe("fromFile / toRulesyncPermissions", () => {
    it("imports the three lists back into canonical categories", async () => {
      await writeSettings({
        testDir,
        settings: {
          permissions: {
            defaultMode: "acceptEdits",
            allow: ["Shell(git *)", "Read", "Edit(src/**)", "WebFetch(https://docs.example.com/*)"],
            ask: ["WebSearch()", "Shell(npm publish *)"],
            deny: ["Write(.env*)", "Shell(rm -rf *)"],
          },
        },
      });

      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.permission).toEqual({
        bash: { "git *": "allow", "npm publish *": "ask", "rm -rf *": "deny" },
        read: { "*": "allow" },
        edit: { "src/**": "allow" },
        write: { ".env*": "deny" },
        webfetch: { "https://docs.example.com/*": "allow" },
        websearch: { "*": "ask" },
      });
    });

    it("folds tool-name case and the legacy Bash alias", async () => {
      await writeSettings({
        testDir,
        settings: {
          permissions: {
            allow: ["bash(git *)", "SHELL(ls *)", "read(*)"],
            deny: ["Bash(rm -rf *)"],
          },
        },
      });

      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.permission).toEqual({
        bash: { "git *": "allow", "ls *": "allow", "rm -rf *": "deny" },
        read: { "*": "allow" },
      });
    });

    it("imports mcp rules and the wildcards", async () => {
      await writeSettings({
        testDir,
        settings: {
          permissions: {
            allow: ["mcp__github__get_issue"],
            ask: ["mcp__*"],
            deny: ["mcp__filesystem", "*"],
          },
        },
      });

      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.permission).toEqual({
        mcp__github__get_issue: { "*": "allow" },
        mcp: { "*": "ask" },
        mcp__filesystem: { "*": "deny" },
        "*": { "*": "deny" },
      });
    });

    it("imports the specifier of a scoped mcp rule as its pattern", async () => {
      await writeSettings({
        testDir,
        settings: {
          permissions: {
            allow: ["mcp__github__get_issue(owner:foo)"],
            deny: ["mcp__github__get_issue(owner:bar)", "mcp__*(x)", "*(git *)"],
          },
        },
      });

      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.permission).toEqual({
        mcp__github__get_issue: { "owner:foo": "allow", "owner:bar": "deny" },
      });
    });

    it("skips server-less wildcards in allow, symmetric with generate", async () => {
      await writeSettings({
        testDir,
        settings: {
          permissions: {
            allow: ["*", "mcp__*", "Read"],
            ask: ["mcp__*"],
          },
        },
      });

      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.permission).toEqual({
        read: { "*": "allow" },
        mcp: { "*": "ask" },
      });
    });

    it("drops entries whose pattern is a prototype-pollution key", async () => {
      await writeSettings({
        testDir,
        settings: {
          permissions: {
            deny: ["Shell(__proto__)", "Shell(constructor)", "Shell(git *)"],
          },
        },
      });

      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.permission).toEqual({ bash: { "git *": "deny" } });
      expect(Object.prototype).not.toHaveProperty("git *");
    });

    it("keeps the strictest action for a rule listed more than once", async () => {
      await writeSettings({
        testDir,
        settings: {
          permissions: { allow: ["Shell(git *)"], ask: ["Shell(git *)"], deny: ["Shell(git *)"] },
        },
      });

      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.permission).toEqual({ bash: { "git *": "deny" } });
    });

    it("skips rules for tool names rulesync does not model", async () => {
      await writeSettings({
        testDir,
        settings: {
          permissions: {
            allow: ["edit_file", "mcp"],
            deny: ["edit_*", "read_directory(/tmp)"],
          },
        },
      });

      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.permission).toEqual({});
    });

    it("ignores non-array lists and non-object permissions", async () => {
      await writeSettings({
        testDir,
        settings: { permissions: { allow: "Shell(git *)", deny: [1, "Shell(rm *)"] } },
      });
      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      expect(permissions.toRulesyncPermissions().getJson().permission).toEqual({});

      await writeSettings({ testDir, settings: { permissions: "nope" } });
      const scalar = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      expect(scalar.toRulesyncPermissions().getJson().permission).toEqual({});
    });

    it("returns an empty permission map when the file is missing", async () => {
      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      expect(permissions.getFileContent()).toBe("{}");
      expect(permissions.toRulesyncPermissions().getJson().permission).toEqual({});
    });

    it("reads the global settings file from the output root", async () => {
      await writeSettings({
        testDir,
        settings: { permissions: { allow: ["Shell(git *)"] } },
      });
      const permissions = await CommandcodePermissions.fromFile({
        outputRoot: testDir,
        global: true,
      });
      expect(permissions.toRulesyncPermissions().getJson().permission).toEqual({
        bash: { "git *": "allow" },
      });
    });

    it("throws when the settings file is not parseable", async () => {
      const dir = join(testDir, SETTINGS_DIR);
      await ensureDir(dir);
      await writeFileContent(join(dir, SETTINGS_FILE), "{ not json");

      const permissions = await CommandcodePermissions.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(() => permissions.toRulesyncPermissions()).toThrow(
        /Failed to parse Command Code settings/,
      );
    });

    it("round-trips generated rules", async () => {
      const source = createRulesyncPermissions({
        bash: { "git *": "allow", "rm -rf *": "deny" },
        read: { "*": "allow" },
        mcp__github__get_issue: { "*": "ask", "owner:foo": "allow" },
        webfetch: { "https://docs.example.com/*": "allow" },
      });
      const generated = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: source,
      });
      await writeSettings({ testDir, settings: JSON.parse(generated.getFileContent()) });

      const imported = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      expect(imported.toRulesyncPermissions().getJson().permission).toEqual(
        source.getJson().permission,
      );
    });
  });

  describe("validate", () => {
    it("always succeeds", () => {
      const permissions = new CommandcodePermissions({
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: SETTINGS_FILE,
        fileContent: "{}",
      });
      expect(permissions.validate()).toEqual({ success: true, error: null });
    });
  });

  describe("forDeletion", () => {
    it("creates an instance with empty content that is not deletable", () => {
      const permissions = CommandcodePermissions.forDeletion({
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: SETTINGS_FILE,
      });
      expect(permissions.getFileContent()).toBe("{}");
      expect(permissions.isDeletable()).toBe(false);
    });
  });
});

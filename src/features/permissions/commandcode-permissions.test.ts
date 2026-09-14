import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { fallbackLogger } from "../../utils/logger.js";
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

    it("writes a scoped mcp deny or ask as the whole tool with a warning", async () => {
      // Command Code drops the specifier of an `mcp__` rule in every list, so
      // the file says what it enforces: the whole tool, strictest action wins.
      const logger = createMockLogger();
      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions: createRulesyncPermissions({
          mcp__github__get_issue: { "owner:foo": "ask", "owner:bar": "deny" },
          mcp__github__list_issues: { "owner:foo": "ask" },
          mcp: { "playwright__click(x)": "deny" },
        }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.permissions).toEqual({
        ask: ["mcp__github__list_issues"],
        deny: ["mcp__github__get_issue", "mcp__playwright__click"],
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "'mcp__github__get_issue(owner:foo)' was written as 'mcp__github__get_issue'",
        ),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "'mcp__playwright__click(x)' was written as 'mcp__playwright__click'",
        ),
      );
    });

    it("warns when a reclaimed deny or ask entry has no replacement of its own strength", async () => {
      const logger = createMockLogger();
      await writeSettings({
        testDir,
        settings: {
          permissions: {
            allow: ["mcp__*"],
            ask: ["Shell(rm -rf *)", "Read"],
            deny: ["mcp__*", "Shell(git *)", "READ"],
          },
        },
      });

      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions: createRulesyncPermissions({
          mcp: { github: "deny" },
          bash: { "git *": "allow", "rm -rf *": "deny" },
          read: { "*": "allow" },
        }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.permissions).toEqual({
        allow: ["Read", "Shell(git *)"],
        deny: ["Shell(rm -rf *)", "mcp__github"],
      });
      // The `ask` on `Shell(rm -rf *)` got a stricter rule back and the allow
      // entries never warn; every other reclaimed entry was loosened.
      const warned = logger.warn.mock.calls.map(([message]) => message);
      expect(warned).toHaveLength(4);
      expect(warned).toEqual(
        expect.arrayContaining([
          expect.stringContaining("'mcp__*' in \"deny\""),
          expect.stringContaining("'Shell(git *)' in \"deny\""),
          expect.stringContaining("'READ' in \"deny\""),
          expect.stringContaining("'Read' in \"ask\""),
        ]),
      );
    });

    it("does not write a padded bash wildcard as an allow, which Command Code reads narrower", async () => {
      const logger = createMockLogger();
      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions: createRulesyncPermissions({
          bash: { " * ": "allow", "git *": "allow" },
        }),
      });

      expect(JSON.parse(permissions.getFileContent()).permissions).toEqual({
        allow: ["Shell(git *)"],
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "reads 'Shell( * )' in \"allow\" as a pattern narrower than the bare 'Shell'",
        ),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("use the '*' pattern for the whole tool"),
      );
    });

    it("drops a scoped mcp allow with a warning instead of allowing the whole tool", async () => {
      const logger = createMockLogger();
      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions: createRulesyncPermissions({
          mcp__github__get_issue: { "owner:foo": "allow", "*": "ask" },
          mcp__github__list_issues: { "*": "allow" },
        }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.permissions).toEqual({
        allow: ["mcp__github__list_issues"],
        ask: ["mcp__github__get_issue"],
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("'mcp__github__get_issue' tool"),
      );
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
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("does not honor '*' in \"allow\""),
      );
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

    it("writes grep and glob as their own rule names", async () => {
      const logger = createMockLogger();
      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions: createRulesyncPermissions({
          grep: { "*": "allow" },
          glob: { "src/**": "deny" },
          bash: { "git *": "allow" },
        }),
      });
      expect(JSON.parse(permissions.getFileContent()).permissions).toEqual({
        allow: ["Grep", "Shell(git *)"],
        deny: ["Glob(src/**)"],
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("skips notebookedit and agent, which Command Code cannot enforce as written", async () => {
      // `NotebookEdit` is the same edit_file/write_file set as `Edit` (a
      // notebookedit rule would govern every file edit), and Command Code
      // answers allow for the agent tool before it consults any rule.
      const logger = createMockLogger();
      await writeSettings({
        testDir,
        settings: { permissions: { allow: ["Agent"], deny: ["NotebookEdit(*.ipynb)"] } },
      });
      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions: createRulesyncPermissions({
          notebookedit: { "*": "deny", "notebooks/**": "allow" },
          agent: { "*": "deny" },
          bash: { "git *": "allow" },
        }),
      });
      expect(JSON.parse(permissions.getFileContent()).permissions).toEqual({
        allow: ["Agent", "Shell(git *)"],
        deny: ["NotebookEdit(*.ipynb)"],
      });
      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("'notebookedit' category with pattern '*'"),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("'agent' category with pattern '*'"),
      );
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
      // The stale `Shell(stale *)` allow goes quietly; the reclaimed
      // `Shell(rm -rf /)` deny is reported because nothing replaced it.
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("'Shell(rm -rf /)' in \"deny\""),
      );
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

    it("reclaims mcp__<server> entries written from the bare mcp category on regenerate", async () => {
      // Run 1 wrote `mcp: { github: "deny" }` as `mcp__github`; flipping it to
      // allow must remove the stale deny (which would otherwise win). Command
      // Code matches MCP names case-sensitively, so `mcp__Github__Get_Issue`
      // is a different tool from `mcp__github__get_issue` and stays the
      // user's, while `mcp__github__*` and `mcp__github__` are the whole
      // server and belong to the `mcp__github` category.
      await writeSettings({
        testDir,
        settings: {
          permissions: {
            allow: ["mcp__Github__Get_Issue", "mcp__filesystem", "mcp__github__"],
            deny: ["mcp__github", "mcp__*()", "mcp__github__*"],
          },
        },
      });

      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          mcp: { github: "allow", "*": "ask" },
          mcp__github__get_issue: { "*": "deny" },
        }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.permissions).toEqual({
        allow: ["mcp__Github__Get_Issue", "mcp__filesystem", "mcp__github"],
        ask: ["mcp__*"],
        deny: ["mcp__github__get_issue"],
      });
    });

    it("does not report a reclaimed deny that the category-wide deny still covers", async () => {
      const logger = createMockLogger();
      await writeSettings({
        testDir,
        settings: { permissions: { deny: ["Shell(git *)", "Shell(rm -rf *)"] } },
      });

      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions: createRulesyncPermissions({ bash: { "*": "deny" } }),
      });

      expect(JSON.parse(permissions.getFileContent()).permissions).toEqual({ deny: ["Shell"] });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("keeps the string entries of a list that also holds a non-string one", async () => {
      // Command Code skips a non-string entry on its own, so the deny beside
      // it stays in force and must survive the regenerate.
      const logger = createMockLogger();
      await writeSettings({
        testDir,
        settings: {
          permissions: { deny: ["Shell(rm -rf *)", null, 7], allow: ["Read"], ask: "Shell" },
        },
      });

      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions: createRulesyncPermissions({ read: { "./src/**": "allow" } }),
      });

      expect(JSON.parse(permissions.getFileContent()).permissions).toEqual({
        allow: ["Read(./src/**)"],
        deny: ["Shell(rm -rf *)"],
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'permission list "deny" holds 2 entries that are not a string, which Command Code skips; those entries were dropped',
        ),
      );
    });

    it("reclaims the entries of a named category even when it has no rules", async () => {
      await writeSettings({
        testDir,
        settings: {
          permissions: { allow: ["Shell(git *)", "Read"], deny: ["Shell(rm -rf *)"] },
        },
      });

      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ bash: {} }),
      });

      expect(JSON.parse(permissions.getFileContent()).permissions).toEqual({ allow: ["Read"] });
    });

    it("refuses a scoped mcp allow smuggled through the bare mcp category", async () => {
      const logger = createMockLogger();
      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions: createRulesyncPermissions({
          mcp: { "github__get_issue(owner:foo)": "allow", github: "allow" },
        }),
      });
      expect(JSON.parse(permissions.getFileContent()).permissions).toEqual({
        allow: ["mcp__github"],
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("'mcp__github__get_issue' tool"),
      );
    });

    it("does not crash on a canonical category named after an Object.prototype member", async () => {
      const permissions = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          toString: { "*": "allow" },
          bash: { "git *": "allow" },
        }),
      });
      expect(JSON.parse(permissions.getFileContent()).permissions).toEqual({
        allow: ["Shell(git *)"],
      });
    });

    it("does not warn for a narrower all-tools deny that landed on Shell", async () => {
      const logger = createMockLogger();
      await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions: createRulesyncPermissions({
          "*": { "rm -rf *": "deny" },
          bash: { "git *": "allow" },
        }),
      });
      expect(logger.warn).not.toHaveBeenCalled();
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

    it("imports a scoped mcp deny or ask as the whole tool, which is what Command Code enforces", async () => {
      await writeSettings({
        testDir,
        settings: {
          permissions: {
            ask: ["mcp__github__get_issue(owner:foo)", "mcp__filesystem(x)"],
            deny: ["mcp__github__delete_repo(owner:bar)", "mcp__*(x)", "*(git *)"],
          },
        },
      });

      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.permission).toEqual({
        mcp__github__get_issue: { "*": "ask" },
        mcp__filesystem: { "*": "ask" },
        mcp__github__delete_repo: { "*": "deny" },
        mcp: { "*": "deny" },
      });
    });

    it("imports a differently-cased MCP__ rule the way Command Code reads it: as a tool name", async () => {
      await writeSettings({
        testDir,
        settings: {
          permissions: {
            // Skipped in allow: the name globs are ignored there, and the
            // scoped rule — which Command Code globs against the call's
            // arguments — cannot be imported without widening it; scoped by
            // the specifier in deny/ask.
            allow: ["MCP__github__delete_repo(owner:sandbox)", "MCP__*", "MCP__github__*"],
            ask: ["MCP__github__get_issue(owner:foo)", "MCP__github__*"],
            deny: ["MCP__*", "MCP__github(owner:foo)", "MCP__*(x)", "MCP__git*__list"],
          },
        },
      });
      const warn = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.permission).toEqual({
        mcp__github__get_issue: { "owner:foo": "ask" },
        mcp__github: { "*": "ask" },
        mcp: { "*": "deny" },
      });
      const skipped = warn.mock.calls
        .map(([message]) => message)
        .filter((message) => message.includes("was not imported"));
      expect(skipped).toEqual([
        expect.stringContaining(
          "globs the specifier of 'MCP__github__delete_repo(owner:sandbox)' in \"allow\" against the call's arguments",
        ),
        expect.stringContaining("ignores 'MCP__*' in \"allow\""),
        expect.stringContaining("ignores 'MCP__github__*' in \"allow\""),
      ]);
    });

    it("imports a scoped mcp allow as the whole tool and keeps the grant on regenerate", async () => {
      // Command Code ignores the specifier in allow, so the file grants the
      // whole tool; the round trip must not drop that grant.
      await writeSettings({
        testDir,
        settings: { permissions: { allow: ["mcp__github__get_issue(owner:foo)"] } },
      });

      const warn = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});
      const imported = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      const rulesyncPermissions = imported.toRulesyncPermissions();
      expect(rulesyncPermissions.getJson().permission).toEqual({
        mcp__github__get_issue: { "*": "allow" },
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain(
        `'mcp__github__get_issue(owner:foo)' in "allow" was imported as the whole 'mcp__github__get_issue' tool`,
      );

      const regenerated = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });
      expect(JSON.parse(regenerated.getFileContent()).permissions).toEqual({
        allow: ["mcp__github__get_issue"],
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

    it("skips *() and mcp__*() in allow, which Command Code reads as bare wildcards", async () => {
      await writeSettings({
        testDir,
        settings: {
          permissions: {
            allow: ["*()", "mcp__*()", "Shell()"],
            deny: ["mcp__*()"],
          },
        },
      });

      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.permission).toEqual({
        bash: { "*": "allow" },
        mcp: { "*": "deny" },
      });
    });

    it("folds a full MCP__ tool name so it round-trips through generate", async () => {
      const logger = createMockLogger();
      await writeSettings({
        testDir,
        settings: {
          permissions: {
            allow: ["MCP__github", "MCP__github__*"],
            deny: ["MCP__*", "MCP__GitHub__Delete_Repo", "mcp__*"],
          },
        },
      });

      // Command Code only reads the MCP shape from an exact `mcp__` prefix; a
      // differently-cased spelling is a plain tool-name rule there. The globs
      // `MCP__*` / `MCP__github__*` are ignored in allow (so they must not
      // become live allows for other targets) but match by name in deny, and
      // `MCP__github` names no tool at all; a full tool name still matches
      // that tool by name and folds to the canonical category, keeping the
      // server and tool spelling because the `mcp__` rule written back is
      // matched case-sensitively.
      const warn = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});
      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      const rulesyncPermissions = permissions.toRulesyncPermissions();
      expect(rulesyncPermissions.getJson().permission).toEqual({
        mcp: { "*": "deny" },
        mcp__GitHub__Delete_Repo: { "*": "deny" },
      });
      // The name rule matched case-insensitively; the exact-prefix rule
      // written back will not, which is worth a word — as is the glob allow
      // Command Code ignores.
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[0]?.[0]).toContain(`ignores 'MCP__github__*' in "allow"`);
      expect(warn.mock.calls[1]?.[0]).toContain(
        `matches 'MCP__GitHub__Delete_Repo' in "deny" against MCP tool names case-insensitively`,
      );

      const regenerated = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions,
      });
      // `MCP__github` is unmodeled and `mcp__github__*` is not a category the
      // config names, so both stay the user's; `MCP__*` folds onto the managed
      // `mcp` category and is replaced by the canonical `mcp__*`.
      expect(JSON.parse(regenerated.getFileContent()).permissions).toEqual({
        allow: ["MCP__github", "MCP__github__*"],
        deny: ["mcp__*", "mcp__GitHub__Delete_Repo"],
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("reads the rules Command Code treats as every MCP tool or a whole server", async () => {
      // A `*` server matches every MCP tool in deny/ask (the tool half is
      // ignored), and `mcp__<server>__*` / `mcp__<server>__` are the whole
      // server, exactly like `mcp__<server>`. Neither grants anything in
      // allow, and any other `*` in the server half matches nothing at all.
      await writeSettings({
        testDir,
        settings: {
          permissions: {
            allow: ["mcp__*__list_issues", "mcp__filesystem__*", "mcp__*__*", "mcp__git*"],
            ask: ["mcp__*__list_issues", "mcp__github__"],
            deny: ["mcp__*__*", "mcp__playwright__*", "mcp__git*__list_issues"],
          },
        },
      });

      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      expect(permissions.toRulesyncPermissions().getJson().permission).toEqual({
        mcp: { "*": "deny" },
        mcp__filesystem: { "*": "allow" },
        mcp__github: { "*": "ask" },
        mcp__playwright: { "*": "deny" },
      });
    });

    it("reads the internal tool names Command Code accepts as aliases", async () => {
      await writeSettings({
        testDir,
        settings: {
          permissions: {
            allow: ["PowerShell(Get-ChildItem *)", "write_file(./src/**)", "Task", "Agent"],
            deny: ["shell_command(rm -rf *)", "monitor_command", "kill_shell", "web_fetch(*)"],
            ask: ["web_search", "edit_file", "read_file(./.env)", "NotebookEdit(*.ipynb)"],
          },
        },
      });

      // `Agent` / `Task` enforce nothing in Command Code, so they are not
      // imported; `NotebookEdit` is the edit tool set and imports as `edit`.
      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      expect(permissions.toRulesyncPermissions().getJson().permission).toEqual({
        bash: { "Get-ChildItem *": "allow", "rm -rf *": "deny", "*": "deny" },
        edit: { "*.ipynb": "ask" },
        webfetch: { "*": "deny" },
        websearch: { "*": "ask" },
        write: { "./src/**": "allow" },
      });
    });

    it("splits a rule like Command Code does: trimmed tool half, escaped parentheses", async () => {
      await writeSettings({
        testDir,
        settings: {
          permissions: {
            allow: ["Shell(echo \\(hi\\))", "Read(./src/**", "mcp__github__x(y"],
            deny: ["Shell (rm -rf *)", " Read (./.env) "],
          },
        },
      });

      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      expect(permissions.toRulesyncPermissions().getJson().permission).toEqual({
        bash: { "echo (hi)": "allow", "rm -rf *": "deny" },
        read: { "./.env": "deny" },
      });
    });

    it("reads specifier whitespace the way each Command Code matcher does", async () => {
      // The shell matcher trims and collapses whitespace on the pattern: a
      // blank one matches nothing, and a padded `*` stays a pattern rule —
      // every command in deny/ask, but narrower than the bare `Shell` in
      // allow, where it is skipped rather than widened. The path matcher
      // uses the specifier as written, so a padded `*` or a blank never
      // matches and is left alone.
      await writeSettings({
        testDir,
        settings: {
          permissions: {
            allow: [
              "Shell( )",
              "Read( * )",
              "Read( )",
              "Shell( * )",
              "Read(./src/ **)",
              "Shell(:*)",
            ],
            ask: ["Shell(*  )", "Shell( :* )"],
            deny: ["Shell( rm  -rf * )", "Shell(git *)", "Shell( * )", "Shell(git:*)"],
          },
        },
      });
      const warn = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      expect(permissions.toRulesyncPermissions().getJson().permission).toEqual({
        bash: { "*": "deny", "rm -rf *": "deny", "git *": "deny", "git:*": "deny" },
        read: { "./src/ **": "allow" },
      });
      // A bare `:*` has no prefix, so Command Code's shell matcher rejects
      // every command for it; importing it would hand other targets an
      // empty-prefix allow-all.
      expect(warn.mock.calls.map(([message]) => message)).toEqual([
        expect.stringContaining(
          `reads 'Shell( * )' in "allow" as a pattern narrower than the bare 'Shell'`,
        ),
        expect.stringContaining(`rule 'Shell( :* )' in "ask" is not one rulesync can model`),
      ]);
    });

    it("imports the string entries of a list that also holds a non-string one", async () => {
      await writeSettings({
        testDir,
        settings: {
          permissions: { deny: ["Shell(rm -rf *)", null], allow: ["Read", 1], ask: { x: 1 } },
        },
      });
      const warn = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      expect(permissions.toRulesyncPermissions().getJson().permission).toEqual({
        bash: { "rm -rf *": "deny" },
        read: { "*": "allow" },
      });
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'permission list "allow" holds 1 entry that is not a string, which Command Code skips; that entry was not imported',
        ),
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('permission list "deny" holds 1 entry that is not a string'),
      );
    });

    it("drops entries whose pattern is a prototype-pollution key, warning for a deny", async () => {
      await writeSettings({
        testDir,
        settings: {
          permissions: {
            deny: ["Shell(__proto__)", "Shell(constructor)", "Shell(git *)"],
          },
        },
      });
      const warn = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.permission).toEqual({ bash: { "git *": "deny" } });
      expect(Object.prototype).not.toHaveProperty("git *");
      expect(warn.mock.calls.map(([message]) => message)).toEqual([
        expect.stringContaining(`rule 'Shell(__proto__)' in "deny" is not one rulesync can model`),
        expect.stringContaining(
          `rule 'Shell(constructor)' in "deny" is not one rulesync can model`,
        ),
      ]);
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

    it("does not model Object.prototype member names as tools on import", async () => {
      await writeSettings({
        testDir,
        settings: { permissions: { allow: ["Constructor", "__proto__(x)", "Read"] } },
      });

      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      expect(permissions.toRulesyncPermissions().getJson().permission).toEqual({
        read: { "*": "allow" },
      });
    });

    it("skips rules for tool names rulesync does not model, warning for deny and ask", async () => {
      // Command Code still enforces such an entry, so losing it from a deny
      // or ask is worth a word; a skipped allow grants nothing elsewhere.
      await writeSettings({
        testDir,
        settings: {
          permissions: {
            allow: ["edit_file", "mcp"],
            ask: ["Agent"],
            deny: ["edit_*", "read_directory(/tmp)"],
          },
        },
      });
      const warn = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      const permissions = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.permission).toEqual({});
      expect(warn.mock.calls.map(([message]) => message)).toEqual([
        expect.stringContaining(`rule 'Agent' in "ask" is not one rulesync can model`),
        expect.stringContaining(`rule 'edit_*' in "deny" is not one rulesync can model`),
        expect.stringContaining(
          `rule 'read_directory(/tmp)' in "deny" is not one rulesync can model`,
        ),
      ]);
    });

    it("ignores non-array lists and non-object permissions", async () => {
      await writeSettings({
        testDir,
        settings: { permissions: { allow: "Shell(git *)", deny: { 0: "Shell(rm *)" } } },
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

    it("imports a server rule written from the bare mcp category as its own category", async () => {
      // `mcp: { github: "allow" }` generates `mcp__github`, which has no way
      // back to the bare category: it imports as the `mcp__github` category.
      const source = createRulesyncPermissions({ mcp: { github: "allow", "*": "ask" } });
      const generated = await CommandcodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: source,
      });
      await writeSettings({ testDir, settings: JSON.parse(generated.getFileContent()) });

      const imported = await CommandcodePermissions.fromFile({ outputRoot: testDir });
      expect(imported.toRulesyncPermissions().getJson().permission).toEqual({
        mcp: { "*": "ask" },
        mcp__github: { "*": "allow" },
      });
    });

    it("round-trips generated rules", async () => {
      const source = createRulesyncPermissions({
        bash: { "git *": "allow", "rm -rf *": "deny" },
        read: { "*": "allow" },
        mcp__github__get_issue: { "*": "ask" },
        mcp__github__delete_repo: { "*": "deny" },
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

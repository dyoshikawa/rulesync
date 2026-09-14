import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import { TabninePermissions } from "./tabnine-permissions.js";

const SETTINGS_DIR = join(".tabnine", "agent");
const SETTINGS_FILE = "settings.json";

function createRulesyncPermissions(config: Record<string, unknown>) {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify(config),
    validate: true,
  });
}

async function writeSettings({
  testDir,
  settings,
}: {
  testDir: string;
  settings: Record<string, unknown> | string;
}): Promise<void> {
  const dir = join(testDir, SETTINGS_DIR);
  await ensureDir(dir);
  await writeFileContent(
    join(dir, SETTINGS_FILE),
    typeof settings === "string" ? settings : JSON.stringify(settings, null, 2),
  );
}

describe("TabninePermissions", () => {
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
    it("returns the agent settings path for both scopes", () => {
      expect(TabninePermissions.getSettablePaths()).toEqual({
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: SETTINGS_FILE,
      });
      expect(TabninePermissions.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: SETTINGS_FILE,
      });
    });
  });

  describe("isDeletable", () => {
    it("is not deletable (shared settings file)", () => {
      const permissions = new TabninePermissions({
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: SETTINGS_FILE,
        fileContent: "{}",
      });
      expect(permissions.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("writes shell prefixes to tools.allowed/tools.exclude and leaves ask unwritten", async () => {
      const logger = createMockLogger();
      const permissions = await TabninePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          permission: {
            bash: {
              "git *": "allow",
              pnpm: "allow",
              "rm -rf *": "deny",
              "npm publish": "ask",
            },
          },
        }),
        logger,
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.tools).toEqual({
        allowed: ["run_shell_command(git)", "run_shell_command(pnpm)"],
        exclude: ["run_shell_command(rm -rf)"],
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("maps the bare '*' shell pattern to the whole run_shell_command tool", async () => {
      const permissions = await TabninePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          permission: { bash: { "*": "allow" } },
        }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.tools.allowed).toEqual(["run_shell_command"]);
    });

    it("skips shell patterns that are not a command prefix with a warning", async () => {
      const logger = createMockLogger();
      const permissions = await TabninePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          permission: {
            bash: { "git * push": "allow", "npm run:*": "deny", "docker *": "allow" },
          },
        }),
        logger,
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.tools).toEqual({ allowed: ["run_shell_command(docker)"] });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("skipped 2 'bash' rule(s) whose pattern is not a command prefix"),
      );
    });

    it("withholds a bash allow that overlaps a deny tools.exclude cannot carry", async () => {
      const logger = createMockLogger();
      const permissions = await TabninePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          permission: {
            bash: {
              "git *": "allow",
              "git * --force": "deny",
              pnpm: "allow",
              "pnpm publish*": "deny",
              "docker *": "allow",
            },
          },
        }),
        logger,
      });

      // `git *` would auto-approve `git push --force`, and the bare `pnpm`
      // prefix also covers `pnpm publish`; neither deny has a prefix to enforce
      // it, so both allows are withheld and only `docker *` is written.
      const json = JSON.parse(permissions.getFileContent());
      expect(json.tools).toEqual({ allowed: ["run_shell_command(docker)"] });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`withheld 2 'bash' allow rule(s) ("git *", "pnpm")`),
      );
    });

    it("withholds a bare-prefix allow that overlaps a bash ask", async () => {
      const logger = createMockLogger();
      const permissions = await TabninePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          permission: {
            bash: { pnpm: "allow", "pnpm publish *": "ask", "docker *": "allow" },
          },
        }),
        logger,
      });

      // A bare `pnpm` prefix auto-approves `pnpm publish` as well, so the ask
      // can only be honored by withholding it.
      const json = JSON.parse(permissions.getFileContent());
      expect(json.tools).toEqual({ allowed: ["run_shell_command(docker)"] });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("was not given the allow rule(s) for pnpm"),
      );
    });

    it("withholds a bare-prefix allow that overlaps a '*' deny or ask", async () => {
      const logger = createMockLogger();
      const permissions = await TabninePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          permission: {
            "*": { "pnpm publish *": "deny", "git * --force": "ask" },
            bash: { pnpm: "allow", git: "allow", "docker *": "allow" },
          },
        }),
        logger,
      });

      const json = JSON.parse(permissions.getFileContent());
      // Bare `pnpm` and `git` prefixes cover `pnpm publish` and `git push
      // --force`; neither `*` rule can be written, so both allows are withheld.
      expect(json.tools).toEqual({ allowed: ["run_shell_command(docker)"] });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("was not given the allow rule(s) for pnpm, git"),
      );
    });

    it("rewrites a stale shell entry once the '*' category restricts shell commands", async () => {
      await writeSettings({
        testDir,
        settings: { tools: { allowed: ["run_shell_command(git)", "some_mcp_tool"] } },
      });

      const permissions = await TabninePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          permission: { "*": { "git *": "deny" } },
        }),
      });

      // The `bash` category that wrote `run_shell_command(git)` is gone and
      // `*` now denies `git *`: the shell tool is managed, so the stale allow
      // goes while the MCP tool entry stays.
      const json = JSON.parse(permissions.getFileContent());
      expect(json.tools).toEqual({ allowed: ["some_mcp_tool"] });
    });

    it("maps whole-tool '*' rules of the other categories to built-in tool names", async () => {
      const logger = createMockLogger();
      const permissions = await TabninePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          permission: {
            read: { "*": "allow" },
            edit: { "*": "allow", "src/**": "allow" },
            write: { "*": "ask" },
            webfetch: { "*": "deny" },
            websearch: { "*": "deny" },
            save_memory: { "*": "deny" },
          },
        }),
        logger,
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.tools).toEqual({
        allowed: ["read_file", "replace"],
        exclude: ["web_fetch", "google_web_search", "save_memory"],
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("skipped 1 rule(s) with a pattern other than '*'"),
      );
    });

    it("withholds a bash allow that an all-tools deny covers, without writing the deny", async () => {
      const logger = createMockLogger();
      const permissions = await TabninePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          permission: {
            "*": { "npm *": "deny" },
            bash: { "npm publish": "allow", "git *": "allow" },
          },
        }),
        logger,
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.tools).toEqual({ allowed: ["run_shell_command(git)"] });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("was not given the allow rule(s) for npm publish"),
      );
    });

    it("preserves foreign keys and the user's other tools.* keys", async () => {
      await writeSettings({
        testDir,
        settings: {
          general: { defaultApprovalMode: "auto_edit" },
          mcpServers: { github: { command: "gh-mcp" } },
          tools: {
            core: ["read_file"],
            allowed: ["run_shell_command(npm)", "some_mcp_tool"],
            exclude: ["run_shell_command(rm -rf)", "web_fetch"],
            shell: { enableInteractiveShell: true },
          },
        },
      });

      const permissions = await TabninePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          permission: { bash: { "git *": "allow" } },
        }),
      });

      // The shell tool is managed by the canonical block, so its stale entries
      // are rewritten; the hand-written entries for tools the block does not
      // name (an MCP tool, `web_fetch`) stay in place.
      const json = JSON.parse(permissions.getFileContent());
      expect(json.general).toEqual({ defaultApprovalMode: "auto_edit" });
      expect(json.mcpServers).toEqual({ github: { command: "gh-mcp" } });
      expect(json.tools).toEqual({
        core: ["read_file"],
        shell: { enableInteractiveShell: true },
        allowed: ["run_shell_command(git)", "some_mcp_tool"],
        exclude: ["web_fetch"],
      });
    });

    it("retracts an owned list when the canonical block no longer yields entries", async () => {
      await writeSettings({
        testDir,
        settings: { tools: { allowed: ["run_shell_command(git)"], exclude: ["web_fetch"] } },
      });

      const permissions = await TabninePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          permission: { bash: { "git *": "ask" }, webfetch: { "*": "ask" } },
        }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.tools).toEqual({});
    });

    it("keeps a hand-written entry of a tool the canonical block never names", async () => {
      await writeSettings({
        testDir,
        settings: { tools: { exclude: ["run_shell_command(rm -rf)", "some_mcp_tool"] } },
      });

      const permissions = await TabninePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ permission: {} }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.tools).toEqual({ exclude: ["run_shell_command(rm -rf)", "some_mcp_tool"] });
    });

    it("writes only the tools and general groups of the tabnine override", async () => {
      const logger = createMockLogger();
      const permissions = await TabninePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          permission: { bash: { "git *": "allow" } },
          tabnine: {
            general: { defaultApprovalMode: "auto_edit" },
            tools: { core: ["read_file"] },
            mcpServers: { rogue: { command: "evil" } },
            hooks: { BeforeTool: [] },
          },
        }),
        logger,
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json).toEqual({
        general: { defaultApprovalMode: "auto_edit" },
        tools: { core: ["read_file"], allowed: ["run_shell_command(git)"] },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`ignored 2 key(s) of the tabnine override ("mcpServers", "hooks")`),
      );
    });

    it("does not read a category name off Object.prototype", async () => {
      const logger = createMockLogger();
      const permissions = await TabninePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          permission: { toString: { "*": "allow" } },
        }),
        logger,
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.tools).toEqual({ allowed: ["toString"] });
    });

    it("does not create an empty tools group when there is nothing to write", async () => {
      await writeSettings({ testDir, settings: { general: { vimMode: true } } });

      const permissions = await TabninePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ permission: {} }),
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual({ general: { vimMode: true } });
    });

    it("merges the tabnine override beneath the canonical lists", async () => {
      const permissions = await TabninePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          permission: { bash: { "git *": "allow" } },
          tabnine: {
            general: { defaultApprovalMode: "yolo" },
            tools: {
              core: ["read_file", "run_shell_command"],
              allowed: ["custom_mcp_tool", "run_shell_command(git)"],
              exclude: ["web_fetch(https://example.com)"],
            },
          },
        }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.general).toEqual({ defaultApprovalMode: "yolo" });
      expect(json.tools).toEqual({
        core: ["read_file", "run_shell_command"],
        allowed: ["run_shell_command(git)", "custom_mcp_tool"],
        exclude: ["web_fetch(https://example.com)"],
      });
    });

    it("reads the tabnine tool-scoped permission block", async () => {
      const permissions = await TabninePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          permission: { bash: { "git *": "allow" } },
          tabnine: { permission: { bash: { "pnpm *": "allow" } } },
        }).forTarget({ toolTarget: "tabnine" }),
      });

      const json = JSON.parse(permissions.getFileContent());
      // The tool-scoped category replaces the shared one wholesale.
      expect(json.tools.allowed).toEqual(["run_shell_command(pnpm)"]);
    });

    it("refuses to write over a settings file it cannot parse", async () => {
      await writeSettings({ testDir, settings: "{ not json" });

      await expect(
        TabninePermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions: createRulesyncPermissions({
            permission: { bash: { "git *": "allow" } },
          }),
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromFile / toRulesyncPermissions", () => {
    it("imports both lists into canonical categories", async () => {
      await writeSettings({
        testDir,
        settings: {
          tools: {
            allowed: ["run_shell_command(git)", "run_shell_command", "read_file", "replace"],
            exclude: ["run_shell_command(rm -rf)", "web_fetch", "save_memory"],
          },
        },
      });

      const permissions = await TabninePermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(permissions.toRulesyncPermissions().getFileContent());

      expect(json.permission).toEqual({
        bash: { "git *": "allow", "*": "allow", "rm -rf *": "deny" },
        read: { "*": "allow" },
        edit: { "*": "allow" },
        webfetch: { "*": "deny" },
        save_memory: { "*": "deny" },
      });
      expect(json.tabnine).toBeUndefined();
    });

    it("keeps an entry named after an Object.prototype member out of the categories", async () => {
      await writeSettings({
        testDir,
        settings: {
          tools: { allowed: ["__proto__", "read_file"], exclude: ["constructor", "prototype"] },
        },
      });

      const permissions = await TabninePermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(permissions.toRulesyncPermissions().getFileContent());

      expect(json.permission).toEqual({ read: { "*": "allow" } });
      expect(json.tabnine).toEqual({
        tools: { exclude: ["constructor", "prototype"], allowed: ["__proto__"] },
      });
      expect(Object.hasOwn({}, "*")).toBe(false);
      expect(({} as Record<string, unknown>)["*"]).toBeUndefined();
      expect((Object as unknown as Record<string, unknown>)["*"]).toBeUndefined();
    });

    it("keeps a tool listed in both lists as deny", async () => {
      await writeSettings({
        testDir,
        settings: { tools: { allowed: ["web_fetch"], exclude: ["web_fetch"] } },
      });

      const permissions = await TabninePermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(permissions.toRulesyncPermissions().getFileContent());

      expect(json.permission.webfetch).toEqual({ "*": "deny" });
    });

    it("keeps unmapped entries and the other settings groups in the tabnine override", async () => {
      await writeSettings({
        testDir,
        settings: {
          general: { defaultApprovalMode: "auto_edit" },
          tools: {
            core: ["read_file"],
            allowed: ["web_fetch(https://example.com)", "(broken", "read_file"],
            exclude: ["run_shell_command(git"],
          },
          context: { fileName: "TABNINE.md" },
        },
      });

      const permissions = await TabninePermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(permissions.toRulesyncPermissions().getFileContent());

      expect(json.permission).toEqual({ read: { "*": "allow" } });
      expect(json.tabnine).toEqual({
        general: { defaultApprovalMode: "auto_edit" },
        tools: {
          core: ["read_file"],
          allowed: ["web_fetch(https://example.com)", "(broken"],
          exclude: ["run_shell_command(git"],
        },
      });
      // `context` is not a permissions concern, so it stays with the file.
      expect(json.tabnine.context).toBeUndefined();
    });

    it("round-trips a settings file through the override", async () => {
      await writeSettings({
        testDir,
        settings: {
          general: { defaultApprovalMode: "auto_edit" },
          tools: {
            core: ["read_file"],
            allowed: ["run_shell_command(git)", "custom_mcp_tool", "web_fetch(https://x)"],
            exclude: ["run_shell_command(rm)", "save_memory"],
          },
        },
      });

      const imported = (
        await TabninePermissions.fromFile({ outputRoot: testDir })
      ).toRulesyncPermissions();
      const regenerated = await TabninePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions(imported.getJson()),
      });

      const json = JSON.parse(regenerated.getFileContent());
      expect(json.general).toEqual({ defaultApprovalMode: "auto_edit" });
      expect(json.tools.core).toEqual(["read_file"]);
      expect(json.tools.allowed.toSorted()).toEqual(
        ["run_shell_command(git)", "custom_mcp_tool", "web_fetch(https://x)"].toSorted(),
      );
      expect(json.tools.exclude.toSorted()).toEqual(
        ["run_shell_command(rm)", "save_memory"].toSorted(),
      );
    });

    it("returns an empty permission block when no list is present", async () => {
      await writeSettings({ testDir, settings: { general: { vimMode: true } } });

      const permissions = await TabninePermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(permissions.toRulesyncPermissions().getFileContent());

      expect(json.permission).toEqual({});
      expect(json.tabnine).toEqual({ general: { vimMode: true } });
    });

    it("returns an empty file content when the settings file is missing", async () => {
      const permissions = await TabninePermissions.fromFile({ outputRoot: testDir });
      expect(permissions.getFileContent()).toBe("{}");
      expect(JSON.parse(permissions.toRulesyncPermissions().getFileContent())).toEqual({
        permission: {},
      });
    });

    it("throws on a settings file that cannot be parsed", async () => {
      await writeSettings({ testDir, settings: "[1, 2]" });

      const permissions = await TabninePermissions.fromFile({ outputRoot: testDir });
      expect(() => permissions.toRulesyncPermissions()).toThrow(
        /Failed to parse Tabnine CLI settings in/,
      );
    });
  });
});

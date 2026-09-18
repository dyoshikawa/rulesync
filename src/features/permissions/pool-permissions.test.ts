import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { PoolPermissions } from "./pool-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

function rulesyncPermissions(
  permission: Record<string, Record<string, string>>,
): RulesyncPermissions {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify({ permission }),
  });
}

describe("PoolPermissions", () => {
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

  const projectSettingsPath = () => join(testDir, ".poolside", "settings.yaml");

  describe("getSettablePaths", () => {
    it("should point to .poolside/settings.yaml in project mode", () => {
      expect(PoolPermissions.getSettablePaths({ global: false })).toEqual({
        relativeDirPath: ".poolside",
        relativeFilePath: "settings.yaml",
      });
    });

    it("should point to .config/poolside/settings.yaml in global mode", () => {
      expect(PoolPermissions.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".config", "poolside"),
        relativeFilePath: "settings.yaml",
      });
    });
  });

  describe("flags", () => {
    it("should never be deletable and skip creation for an empty payload", () => {
      const permissions = new PoolPermissions({
        outputRoot: testDir,
        relativeDirPath: ".poolside",
        relativeFilePath: "settings.yaml",
        fileContent: "",
      });
      expect(permissions.isDeletable()).toBe(false);
      expect(permissions.shouldSkipCreationWhenPayloadEmpty()).toBe(true);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("should write tool rules as allow/deny lists and file rules as paths", async () => {
      const permissions = await PoolPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "git *": "allow", "npm test": "allow", "rm -rf *": "deny" },
          webfetch: { "https://docs.example.com/**": "allow" },
          websearch: { "*": "deny" },
          read: { "src/**": "allow", ".env": "deny", "**/*.pem": "deny" },
          edit: { "src/**": "allow" },
          write: { "docs/**": "allow" },
        }),
      });

      expect(permissions.getSettings()).toEqual({
        tools: {
          shell: { allow: ["git *", "npm test"], deny: ["rm -rf *"] },
          // A `**` run is Pool's `*` (which already matches `/`).
          web_fetch: { allow: ["https://docs.example.com/*"] },
          web_search: { deny: ["*"] },
        },
        paths: {
          allow: [
            { path: "src/**", write: true },
            { path: "docs/**", write: true },
          ],
          deny: [{ path: ".env" }, { path: "**/*.pem" }],
        },
      });
    });

    it("should spell the catch-all path as ** and pass other categories through", async () => {
      const permissions = await PoolPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          read: { "*": "allow" },
          grep: { "*": "allow" },
        }),
      });

      expect(permissions.getSettings()).toEqual({
        tools: { grep: { allow: ["*"] } },
        paths: { allow: [{ path: "**" }] },
      });
    });

    it("should withhold an allow that overlaps an ask of the same tool", async () => {
      const logger = createMockLogger();
      const permissions = await PoolPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "git *": "allow", "git push *": "ask", "npm test": "allow" },
        }),
        logger,
      });

      expect(permissions.getSettings()).toEqual({
        tools: { shell: { allow: ["npm test"] } },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'the "allow" rule for "bash" (pattern "git *") was withheld because it overlaps the "ask" rule(s) "git push *"',
        ),
      );
    });

    it("should skip a tool pattern that needs a wildcard Pool does not know", async () => {
      const logger = createMockLogger();
      const permissions = await PoolPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "git {status,log}": "allow", "rm -?f *": "deny", "ls *": "allow" },
        }),
        logger,
      });

      expect(permissions.getSettings()).toEqual({
        tools: { shell: { allow: ["ls *"] } },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('(pattern "git {status,log}") was skipped'),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('(pattern "rm -?f *") was skipped'),
      );
    });

    it("should honor an all-tools restriction on bash and skip the * category itself", async () => {
      const logger = createMockLogger();
      const permissions = await PoolPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          "*": { "rm -rf *": "deny" },
          bash: { "git *": "allow" },
        }),
        logger,
      });

      expect(permissions.getSettings()).toEqual({
        tools: { shell: { allow: ["git *"], deny: ["rm -rf *"] } },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('the "deny" rule for "*" (pattern "rm -rf *") was skipped'),
      );
    });

    it("should skip MCP categories and point at poolAllow", async () => {
      const logger = createMockLogger();
      const permissions = await PoolPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          mcp__github__create_issue: { "*": "allow" },
        }),
        logger,
      });

      expect(permissions.getSettings()).toEqual({});
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('the rules for "mcp__github__create_issue" were skipped'),
      );
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"poolAllow"'));
    });

    it("should keep a read allow read-only when a write deny overlaps it", async () => {
      const logger = createMockLogger();
      const permissions = await PoolPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          read: { "src/**": "allow", "config/**": "allow" },
          edit: { "src/**": "allow", "src/generated/**": "deny", "config/**": "ask" },
          write: { "config/**": "allow" },
        }),
        logger,
      });

      // `src/**` may be read but its write flag is withheld by the narrower
      // deny; `config/**` likewise by the `edit` ask.
      expect(permissions.getSettings()).toEqual({
        paths: { allow: [{ path: "src/**" }, { path: "config/**" }] },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'the "deny" rule for "edit" (pattern "src/generated/**") was not written',
        ),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'the "allow" rule for "edit" (pattern "src/**") was withheld because it overlaps the restriction(s) "src/generated/**"',
        ),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'the "allow" rule for "write" (pattern "config/**") was withheld because it overlaps the restriction(s) "config/**"',
        ),
      );
    });

    it("should not report a write deny that a read deny already covers", async () => {
      const logger = createMockLogger();
      const permissions = await PoolPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          read: { ".env": "deny" },
          edit: { ".env": "deny" },
          write: { ".env": "deny" },
        }),
        logger,
      });

      expect(permissions.getSettings()).toEqual({
        paths: { deny: [{ path: ".env" }] },
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should withhold a read allow and a write allow that overlap a read ask", async () => {
      const logger = createMockLogger();
      const permissions = await PoolPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          read: { "**": "allow", "secrets/**": "ask" },
          write: { "secrets/**": "allow", "docs/**": "allow" },
        }),
        logger,
      });

      expect(permissions.getSettings()).toEqual({
        paths: { allow: [{ path: "docs/**", write: true }] },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('the "allow" rule for "read" (pattern "**") was withheld'),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('the "allow" rule for "write" (pattern "secrets/**") was withheld'),
      );
    });

    it("should skip absolute and home paths at project scope", async () => {
      const logger = createMockLogger();
      const permissions = await PoolPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          read: { "/etc/**": "deny", "~/.ssh/**": "deny", "src/**": "allow" },
        }),
        logger,
      });

      expect(permissions.getSettings()).toEqual({
        paths: { allow: [{ path: "src/**" }] },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Pool\'s project settings take project-relative paths, so the "deny" rule for "read" (pattern "/etc/**") was skipped',
        ),
      );
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('(pattern "~/.ssh/**")'));
    });

    it("should skip relative paths at global scope", async () => {
      const logger = createMockLogger();
      const permissions = await PoolPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          read: { "~/.ssh/**": "deny", "src/**": "allow" },
          edit: { "/tmp/**": "allow" },
        }),
        logger,
        global: true,
      });

      expect(permissions.getSettings()).toEqual({
        paths: { allow: [{ path: "/tmp/**", write: true }], deny: [{ path: "~/.ssh/**" }] },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Pool\'s user settings take absolute or "~" paths, so the "allow" rule for "read" (pattern "src/**") was skipped',
        ),
      );
    });

    it("should merge into the existing settings and keep what it does not manage", async () => {
      await writeFileContent(
        projectSettingsPath(),
        [
          "pool:",
          "  model: gpt",
          "mcp_servers:",
          "  github:",
          "    command: gh-mcp",
          "tools:",
          "  shell:",
          "    allow: [stale]",
          "    deny: [also stale]",
          "    disabled: false",
          "  edit:",
          "    disabled: true",
          "  custom:",
          "    allow: [keep]",
          "paths:",
          "  allow:",
          "    - path: stale/**",
          "  deny:",
          "    - path: stale.txt",
          "",
        ].join("\n"),
      );

      const permissions = await PoolPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "git *": "allow" },
          read: { "src/**": "allow" },
        }),
      });

      expect(permissions.getSettings()).toEqual({
        pool: { model: "gpt" },
        mcp_servers: { github: { command: "gh-mcp" } },
        tools: {
          // The managed tool's lists are rebuilt (the stale deny retracted);
          // its `disabled` flag, and unmanaged tools, are left alone.
          shell: { allow: ["git *"], disabled: false },
          edit: { disabled: true },
          custom: { allow: ["keep"] },
        },
        paths: { allow: [{ path: "src/**" }] },
      });
    });

    it("should retract the lists of a managed tool whose rules turned to ask", async () => {
      await writeFileContent(
        projectSettingsPath(),
        ["tools:", "  shell:", "    allow: [git *]", "    disabled: false", ""].join("\n"),
      );

      const permissions = await PoolPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "git *": "ask" },
        }),
      });

      expect(permissions.getSettings()).toEqual({
        tools: { shell: { disabled: false } },
      });
    });

    it("should leave paths alone when no file category is configured", async () => {
      await writeFileContent(
        projectSettingsPath(),
        ["paths:", "  allow:", "    - path: docs/**", "      write: true", ""].join("\n"),
      );

      const permissions = await PoolPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "git *": "allow" },
        }),
      });

      expect(permissions.getSettings()).toEqual({
        tools: { shell: { allow: ["git *"] } },
        paths: { allow: [{ path: "docs/**", write: true }] },
      });
    });

    it("should not grow empty blocks for a config without rules", async () => {
      const permissions = await PoolPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "git *": "ask" },
          read: { "src/**": "ask" },
        }),
      });

      // An empty document, which the processor never creates a file for.
      expect(permissions.getSettings()).toEqual({});
    });

    it("should write the global settings file under .config/poolside", async () => {
      const permissions = await PoolPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "git *": "allow" },
        }),
        global: true,
      });

      expect(permissions.getRelativeDirPath()).toBe(join(".config", "poolside"));
      expect(permissions.getRelativeFilePath()).toBe("settings.yaml");
      expect(permissions.getSettings()).toEqual({
        tools: { shell: { allow: ["git *"] } },
      });
    });

    it("should fail closed on an unparseable settings file", async () => {
      await writeFileContent(projectSettingsPath(), "- not\n- a: [map\n");

      await expect(
        PoolPermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions: rulesyncPermissions({ bash: { "git *": "allow" } }),
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromFile", () => {
    it("should read an existing settings file and default to empty when missing", async () => {
      const missing = await PoolPermissions.fromFile({ outputRoot: testDir });
      expect(missing.getSettings()).toEqual({});

      await writeFileContent(projectSettingsPath(), "tools:\n  shell:\n    allow: [git *]\n");
      const present = await PoolPermissions.fromFile({ outputRoot: testDir });
      expect(present.getSettings()).toEqual({ tools: { shell: { allow: ["git *"] } } });
    });
  });

  describe("toRulesyncPermissions", () => {
    it("should map tool lists and paths back to canonical categories", () => {
      const permissions = new PoolPermissions({
        outputRoot: testDir,
        relativeDirPath: ".poolside",
        relativeFilePath: "settings.yaml",
        fileContent: [
          "mcp_servers:",
          "  github:",
          "    command: gh-mcp",
          "    allow: ['*']",
          "tools:",
          "  shell:",
          "    allow: ['git *', 'rm -rf *', '']",
          "    deny: ['rm -rf *']",
          "  web_fetch:",
          "    allow: ['https://docs.example.com/*']",
          "  web_search:",
          "    disabled: true",
          "    allow: ['*']",
          "  toString:",
          "    allow: ['*']",
          "  __proto__:",
          "    allow: ['*']",
          "  broken: nope",
          "paths:",
          "  allow:",
          "    - path: src/**",
          "      write: true",
          "    - path: docs/**",
          "    - path: ''",
          "    - nope",
          "  deny:",
          "    - path: .env",
          "",
        ].join("\n"),
      });

      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.permission).toEqual({
        // A denied pattern wins over the same allowed one.
        bash: { "git *": "allow", "rm -rf *": "deny" },
        webfetch: { "https://docs.example.com/*": "allow" },
        // A disabled tool never runs; its own lists are moot.
        websearch: { "*": "deny" },
        // An inherited-property name gets its own bucket instead of writing
        // into Object.prototype's function.
        toString: { "*": "allow" },
        read: { "src/**": "allow", "docs/**": "allow", ".env": "deny" },
        edit: { "src/**": "allow", ".env": "deny" },
        write: { "src/**": "allow", ".env": "deny" },
      });
      expect(Object.hasOwn(Object.prototype.toString, "*")).toBe(false);
    });

    it("should yield no rules when the settings carry neither block", () => {
      const permissions = new PoolPermissions({
        outputRoot: testDir,
        relativeDirPath: ".poolside",
        relativeFilePath: "settings.yaml",
        fileContent: "pool:\n  model: gpt\n",
      });
      expect(permissions.toRulesyncPermissions().getJson().permission).toEqual({});
    });
  });

  describe("forDeletion", () => {
    it("should return a well-formed, non-deletable instance", () => {
      const permissions = PoolPermissions.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".poolside",
        relativeFilePath: "settings.yaml",
      });
      expect(permissions.getSettings()).toEqual({});
      expect(permissions.isDeletable()).toBe(false);
    });
  });
});

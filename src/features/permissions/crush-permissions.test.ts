import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CrushPermissions } from "./crush-permissions.js";
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

describe("CrushPermissions", () => {
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

  const projectConfigPath = () => join(testDir, "crush.json");

  describe("getSettablePaths", () => {
    it("should point to crush.json in project mode", () => {
      expect(CrushPermissions.getSettablePaths({ global: false })).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
      });
    });

    it("should point to .config/crush/crush.json in global mode", () => {
      expect(CrushPermissions.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".config", "crush"),
        relativeFilePath: "crush.json",
      });
    });
  });

  describe("flags", () => {
    it("should never be deletable and skip creation for an empty payload", () => {
      const permissions = new CrushPermissions({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
        fileContent: "",
      });
      expect(permissions.isDeletable()).toBe(false);
      expect(permissions.shouldSkipCreationWhenPayloadEmpty()).toBe(true);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("should write catch-all allows to allowed_tools and denies to disabled_tools", async () => {
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "*": "allow" },
          read: { "**": "allow" },
          webfetch: { "*": "deny" },
          sourcegraph: { "*": "deny" },
          edit: { "*": "ask" },
          mcp__github__create_issue: { "*": "allow" },
        }),
      });

      expect(permissions.getJson()).toEqual({
        permissions: { allowed_tools: ["bash", "view", "mcp_github_create_issue"] },
        options: { disabled_tools: ["fetch", "sourcegraph"] },
      });
    });

    it("should skip pattern-specific rules and keep a restricted tool on prompt", async () => {
      const logger = createMockLogger();
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "*": "allow", "git push *": "deny" },
          read: { "*": "allow", "*.env": "ask" },
          write: { "*": "allow", "src/**": "allow" },
        }),
        logger,
      });

      // `write` only carries a pattern-specific allow, so its catch-all allow
      // is still written; `bash` and `read` carry restrictions and stay off.
      expect(permissions.getJson()).toEqual({
        permissions: { allowed_tools: ["write"] },
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"git push *"'));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Crush keeps prompting for "bash"'),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Crush keeps prompting for "view"'),
      );
    });

    it("should honor an all-tools restriction on bash and skip the * category itself", async () => {
      const logger = createMockLogger();
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          "*": { "*": "allow", "rm -rf *": "deny" },
          bash: { "*": "allow" },
          read: { "*": "allow" },
        }),
        logger,
      });

      // The `*` deny is mirrored onto bash, which then carries a restriction.
      expect(permissions.getJson()).toEqual({
        permissions: { allowed_tools: ["view"] },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Crush has no allow-all or disable-all tool list"),
      );
    });

    it("should not disable an MCP tool through options.disabled_tools", async () => {
      const logger = createMockLogger();
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          mcp__github__delete_repo: { "*": "deny" },
        }),
        logger,
      });

      expect(permissions.getJson()).toEqual({});
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("only covers built-in tools"),
      );
    });

    it("should preserve unmanaged entries and sibling keys, and retract stale managed ones", async () => {
      await writeFileContent(
        projectConfigPath(),
        JSON.stringify({
          providers: { anthropic: {} },
          permissions: { allowed_tools: ["ls", "bash", "edit:write", "view:read"] },
          options: { debug: true, disabled_tools: ["sourcegraph", "view"] },
        }),
      );

      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "*": "ask" },
          read: { "*": "allow" },
          edit: { "*": "deny" },
        }),
      });

      // `tool:action` entries are narrower than anything rulesync derives, so
      // they survive even for a managed tool; the bare `bash` is retracted.
      expect(permissions.getJson()).toEqual({
        providers: { anthropic: {} },
        permissions: { allowed_tools: ["ls", "edit:write", "view:read", "view"] },
        options: { debug: true, disabled_tools: ["sourcegraph", "edit"] },
      });
    });

    it("should retract an emptied list and leave absent groups absent", async () => {
      await writeFileContent(
        projectConfigPath(),
        JSON.stringify({ permissions: { allowed_tools: ["bash"] } }),
      );

      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "*": "ask" } }),
      });

      expect(permissions.getJson()).toEqual({ permissions: {} });
    });

    it("should produce an empty payload when nothing is expressible", async () => {
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "git *": "allow" } }),
      });

      expect(permissions.getJson()).toEqual({});
    });

    it("should write into an existing .crush.json instead of crush.json", async () => {
      await writeFileContent(join(testDir, ".crush.json"), JSON.stringify({ options: {} }));

      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "*": "allow" } }),
      });

      expect(permissions.getRelativeFilePath()).toBe(".crush.json");
      expect(permissions.getJson()).toEqual({
        options: {},
        permissions: { allowed_tools: ["bash"] },
      });
    });

    it("should target ~/.config/crush/crush.json in global mode", async () => {
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "*": "allow" } }),
        global: true,
      });

      expect(permissions.getRelativeDirPath()).toBe(join(".config", "crush"));
      expect(permissions.getRelativeFilePath()).toBe("crush.json");
    });

    it("should fail closed on an unparseable existing config", async () => {
      await writeFileContent(projectConfigPath(), "{ not json");

      await expect(
        CrushPermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions: rulesyncPermissions({ bash: { "*": "allow" } }),
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromFile", () => {
    it("should read an existing config and default to empty when missing", async () => {
      const missing = await CrushPermissions.fromFile({ outputRoot: testDir });
      expect(missing.getJson()).toEqual({});

      await writeFileContent(
        projectConfigPath(),
        JSON.stringify({ permissions: { allowed_tools: ["bash"] } }),
      );
      const present = await CrushPermissions.fromFile({ outputRoot: testDir });
      expect(present.getJson()).toEqual({ permissions: { allowed_tools: ["bash"] } });
    });
  });

  describe("toRulesyncPermissions", () => {
    it("should map both lists back to catch-all rules", () => {
      const permissions = new CrushPermissions({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
        fileContent: `{
          "permissions": { "allowed_tools": ["bash", "view", "edit:write", "mcp_github_create_issue", "sourcegraph", "__proto__", "toString"] },
          "options": { "disabled_tools": ["fetch", "sourcegraph", "valueOf"] }
        }`,
      });

      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.permission).toEqual({
        bash: { "*": "allow" },
        read: { "*": "allow" },
        mcp_github_create_issue: { "*": "allow" },
        webfetch: { "*": "deny" },
        // A disabled tool never runs, so the deny wins over the stale allow.
        sourcegraph: { "*": "deny" },
        // An inherited-property name gets its own bucket instead of writing
        // into Object.prototype's function.
        toString: { "*": "allow" },
        valueOf: { "*": "deny" },
      });
      expect(Object.hasOwn(Object.prototype.toString, "*")).toBe(false);
      expect(Object.hasOwn(Object.prototype.valueOf, "*")).toBe(false);
    });

    it("should yield no rules when the config has neither list", () => {
      const permissions = new CrushPermissions({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
        fileContent: "{}",
      });
      expect(permissions.toRulesyncPermissions().getJson().permission).toEqual({});
    });
  });

  describe("forDeletion", () => {
    it("should return a well-formed, non-deletable instance", () => {
      const permissions = CrushPermissions.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
      });
      expect(permissions.getJson()).toEqual({});
      expect(permissions.isDeletable()).toBe(false);
    });
  });
});

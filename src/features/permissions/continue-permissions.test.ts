import { join } from "node:path";

import { dump, load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, fileExists, readFileContent, writeFileContent } from "../../utils/file.js";
import { isRecord } from "../../utils/type-guards.js";
import { ContinuePermissions } from "./continue-permissions.js";
import { PermissionsProcessor } from "./permissions-processor.js";
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

function listsOf(yamlContent: string): Record<string, unknown> {
  const parsed = load(yamlContent);
  return isRecord(parsed) ? parsed : {};
}

describe("ContinuePermissions", () => {
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
    it("targets permissions.yaml in the ~/.continue directory", () => {
      const paths = ContinuePermissions.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(".continue");
      expect(paths.relativeFilePath).toBe("permissions.yaml");
    });
  });

  describe("isDeletable", () => {
    it("is never deletable (the CLI writes its own decisions into the file)", () => {
      const perms = new ContinuePermissions({
        relativeDirPath: ".continue",
        relativeFilePath: "permissions.yaml",
        fileContent: "",
        validate: false,
      });
      expect(perms.isDeletable()).toBe(false);
    });
  });

  describe("shouldSkipCreationWhenPayloadEmpty", () => {
    let homeDir: string;
    let cleanupHome: () => Promise<void>;

    beforeEach(async () => {
      ({ testDir: homeDir, cleanup: cleanupHome } = await setupTestDirectory({ home: true }));
      vi.stubEnv("HOME_DIR", homeDir);
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      await cleanupHome();
    });

    const permissionsPath = (): string => join(homeDir, ".continue", "permissions.yaml");

    const generateThroughProcessor = async (
      permission: Record<string, Record<string, string>>,
    ): Promise<void> => {
      const processor = new PermissionsProcessor({
        logger: createMockLogger(),
        outputRoot: homeDir,
        toolTarget: "continue",
        global: true,
      });
      const toolFiles = await processor.convertRulesyncFilesToToolFiles([
        rulesyncPermissions(permission),
      ]);
      await processor.writeAiFiles(toolFiles);
    };

    it("is skipped: permissions.yaml is Continue's file", () => {
      const perms = new ContinuePermissions({
        relativeDirPath: ".continue",
        relativeFilePath: "permissions.yaml",
        fileContent: "",
        validate: false,
      });
      expect(perms.shouldSkipCreationWhenPayloadEmpty()).toBe(true);
    });

    it("does not create permissions.yaml when nothing maps and the file does not exist", async () => {
      await generateThroughProcessor({});

      expect(await fileExists(permissionsPath())).toBe(false);
    });

    it("creates permissions.yaml when a rule maps", async () => {
      await generateThroughProcessor({ bash: { "git status": "allow" } });

      expect(listsOf(await readFileContent(permissionsPath())).allow).toEqual(["Bash(git status)"]);
    });
  });

  describe("global-only enforcement", () => {
    it("throws on non-global fromRulesyncPermissions", async () => {
      await expect(
        ContinuePermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions: rulesyncPermissions({ bash: { "*": "ask" } }),
          global: false,
        }),
      ).rejects.toThrow(/global-only/);
    });

    it("throws on non-global fromFile", async () => {
      await expect(
        ContinuePermissions.fromFile({ outputRoot: testDir, global: false }),
      ).rejects.toThrow(/global-only/);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("maps allow/ask/deny onto allow/ask/exclude with Continue tool names", async () => {
      const perms = await ContinuePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "*": "allow", "rm -rf *": "deny", "git push*": "ask" },
          read: { "*": "allow" },
          edit: { "src/**": "ask" },
          write: { "*.env": "deny" },
          webfetch: { "https://example.com/*": "allow" },
        }),
        global: true,
      });

      const lists = listsOf(perms.getFileContent());
      expect(lists.allow).toEqual(["Bash", "Read", "Fetch(https://example.com/*)"]);
      expect(lists.ask).toEqual(["Bash(git push*)", "Edit(src/**)"]);
      expect(lists.exclude).toEqual(["Bash(rm -rf *)", "Write(*.env)"]);
    });

    it("writes the all-tools category as the bare * entry", async () => {
      const perms = await ContinuePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ "*": { "*": "ask" } }),
        global: true,
      });

      const lists = listsOf(perms.getFileContent());
      expect(lists.ask).toEqual(["*"]);
      // honorAllToolsOnBash mirrors the all-tools rule onto bash, but the bare
      // `*` already covers it, so Bash is not listed separately.
      expect(lists.allow).toBeUndefined();
    });

    it("skips pattern-specific all-tools rules instead of writing dead * entries", async () => {
      const logger = createMockLogger();
      const perms = await ContinuePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          "*": { "*": "allow", "rm -rf *": "deny" },
          bash: { "git status *": "allow" },
        }),
        global: true,
        logger,
      });

      const lists = listsOf(perms.getFileContent());
      expect(lists.allow).toEqual(["*", "Bash(git status *)"]);
      // The bash mirror from honorAllToolsOnBash keeps the deny; `*(rm -rf *)`
      // itself would match nothing in Continue and is not written.
      expect(lists.exclude).toEqual(["Bash(rm -rf *)"]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('rule for "*"'));
    });

    it("writes a run of * as the catch-all instead of skipping it", async () => {
      const logger = createMockLogger();
      const perms = await ContinuePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          "*": { "**": "deny" },
          read: { "***": "allow" },
        }),
        global: true,
        logger,
      });

      const lists = listsOf(perms.getFileContent());
      // Continue matches `Tool(**)` against every argument, the same as the
      // bare entry, so the all-tools rule is honored rather than dropped.
      expect(lists.exclude).toEqual(["*"]);
      expect(lists.allow).toEqual(["Read"]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("drops prototype-pollution categories and patterns instead of writing them", async () => {
      const perms = await ContinuePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        // JSON.parse yields own `__proto__` keys (an object literal would
        // set the prototype instead).
        rulesyncPermissions: rulesyncPermissions(
          JSON.parse(
            '{"constructor":{"*":"allow"},"bash":{"__proto__":"deny","git status *":"allow"}}',
          ),
        ),
        global: true,
      });

      const lists = listsOf(perms.getFileContent());
      expect(lists.allow).toEqual(["Bash(git status *)"]);
      expect(lists.exclude).toBeUndefined();
      expect(perms.getFileContent()).not.toContain("native code");
    });

    it("passes unknown categories through verbatim as tool names", async () => {
      const perms = await ContinuePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          mcp__github__create_issue: { "*": "allow" },
          List: { "*": "ask" },
        }),
        global: true,
      });

      const lists = listsOf(perms.getFileContent());
      expect(lists.allow).toEqual(["mcp__github__create_issue"]);
      expect(lists.ask).toEqual(["List"]);
    });

    it("warns and skips a pattern holding a parenthesis (the loader would refuse the file)", async () => {
      const mockLogger = createMockLogger();
      const perms = await ContinuePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "echo $(whoami)": "allow", "git status": "allow" },
        }),
        logger: mockLogger,
        global: true,
      });

      const lists = listsOf(perms.getFileContent());
      expect(lists.allow).toEqual(["Bash(git status)"]);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("parenthesis"));
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("echo $(whoami)"));
    });

    it("warns when two categories resolve to the same entry with different actions", async () => {
      const mockLogger = createMockLogger();
      const perms = await ContinuePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "*": "allow" },
          Bash: { "*": "deny" },
        }),
        logger: mockLogger,
        global: true,
      });

      const lists = listsOf(perms.getFileContent());
      expect(lists.allow).toEqual(["Bash"]);
      expect(lists.exclude).toEqual(["Bash"]);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("conflicting actions"));
    });

    it("produces empty content when nothing maps", async () => {
      const perms = await ContinuePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({}),
        global: true,
      });

      expect(perms.getFileContent()).toBe("");
    });

    it("preserves entries for tools the canonical config does not manage", async () => {
      const dirPath = join(testDir, ".continue");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "permissions.yaml"),
        dump({
          allow: ["Bash(stale *)", "mcp__slack__post", "List"],
          ask: ["Bash"],
          exclude: ["Write(*.pem)"],
        }),
      );

      const perms = await ContinuePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "git *": "allow" },
        }),
        global: true,
      });

      const lists = listsOf(perms.getFileContent());
      // The stale Bash entries are rebuilt; the unmanaged ones survive verbatim.
      expect(lists.allow).toEqual(["mcp__slack__post", "List", "Bash(git *)"]);
      expect(lists.ask).toBeUndefined();
      expect(lists.exclude).toEqual(["Write(*.pem)"]);
    });

    it("keeps an existing entry outside the loader grammar untouched", async () => {
      const dirPath = join(testDir, ".continue");
      await ensureDir(dirPath);
      await writeFileContent(join(dirPath, "permissions.yaml"), dump({ allow: ["Bash(broken"] }));

      const perms = await ContinuePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "*": "allow" } }),
        global: true,
      });

      expect(listsOf(perms.getFileContent()).allow).toEqual(["Bash(broken", "Bash"]);
    });

    it("throws when the existing permissions.yaml is not parseable", async () => {
      const dirPath = join(testDir, ".continue");
      await ensureDir(dirPath);
      await writeFileContent(join(dirPath, "permissions.yaml"), "allow: [unterminated");

      await expect(
        ContinuePermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions: rulesyncPermissions({ bash: { "*": "allow" } }),
          global: true,
        }),
      ).rejects.toThrow(/Failed to parse existing Continue permissions\.yaml/);
    });
  });

  describe("toRulesyncPermissions", () => {
    it("maps the three lists back onto canonical categories and actions", () => {
      const perms = new ContinuePermissions({
        relativeDirPath: ".continue",
        relativeFilePath: "permissions.yaml",
        fileContent: dump({
          allow: ["Bash(git *)", "Read", "Fetch(https://docs.example.com/*)", "mcp__x__y"],
          ask: ["Edit(src/**)", "*"],
          exclude: ["Write(*.env)", "Bash(rm -rf *)"],
        }),
        validate: false,
        global: true,
      });

      const json = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(json.permission).toEqual({
        bash: { "git *": "allow", "rm -rf *": "deny" },
        read: { "*": "allow" },
        webfetch: { "https://docs.example.com/*": "allow" },
        mcp__x__y: { "*": "allow" },
        edit: { "src/**": "ask" },
        "*": { "*": "ask" },
        write: { "*.env": "deny" },
      });
    });

    it("lets the first matching list win when an entry appears in several lists", () => {
      const perms = new ContinuePermissions({
        relativeDirPath: ".continue",
        relativeFilePath: "permissions.yaml",
        fileContent: dump({ allow: ["Bash"], exclude: ["Bash"] }),
        validate: false,
        global: true,
      });

      const json = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(json.permission.bash["*"]).toBe("deny");
    });

    it("skips entries outside the loader grammar and tolerates malformed lists", () => {
      const perms = new ContinuePermissions({
        relativeDirPath: ".continue",
        relativeFilePath: "permissions.yaml",
        fileContent: dump({ allow: ["Bash(broken", "Read"], ask: "not-a-list" }),
        validate: false,
        global: true,
      });

      const json = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(json.permission).toEqual({ read: { "*": "allow" } });
    });

    it("ignores prototype-pollution entries without touching Object.prototype", () => {
      const perms = new ContinuePermissions({
        relativeDirPath: ".continue",
        relativeFilePath: "permissions.yaml",
        fileContent: dump({
          allow: ["__proto__(polluted)", "constructor", "Read"],
          exclude: ["Bash(constructor)"],
        }),
        validate: false,
        global: true,
      });

      const json = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(json.permission).toEqual({ read: { "*": "allow" } });
      const probe: Record<string, unknown> = {};
      expect(probe.polluted).toBeUndefined();
      expect(Object.hasOwn(Object, "*")).toBe(false);
    });

    it("returns an empty config for empty content", () => {
      const perms = new ContinuePermissions({
        relativeDirPath: ".continue",
        relativeFilePath: "permissions.yaml",
        fileContent: "",
        validate: false,
        global: true,
      });

      expect(JSON.parse(perms.toRulesyncPermissions().getFileContent())).toEqual({
        permission: {},
      });
    });

    it("throws when the content is not parseable", () => {
      const perms = new ContinuePermissions({
        relativeDirPath: ".continue",
        relativeFilePath: "permissions.yaml",
        fileContent: "allow: [unterminated",
        validate: false,
        global: true,
      });

      expect(() => perms.toRulesyncPermissions()).toThrow(
        /Failed to parse Continue permissions content/,
      );
    });
  });

  describe("round-trip", () => {
    it("maps rulesync -> continue -> rulesync preserving actions and patterns", async () => {
      const original = rulesyncPermissions({
        bash: { "*": "allow", "git push*": "ask" },
        edit: { "*": "ask" },
        webfetch: { "*": "deny" },
        write: { "*.env": "deny" },
      });

      const toolPerms = await ContinuePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: original,
        global: true,
      });

      const json = JSON.parse(toolPerms.toRulesyncPermissions().getFileContent());
      expect(json.permission.bash).toEqual({ "*": "allow", "git push*": "ask" });
      expect(json.permission.edit["*"]).toBe("ask");
      expect(json.permission.webfetch["*"]).toBe("deny");
      expect(json.permission.write["*.env"]).toBe("deny");
    });
  });

  describe("fromFile", () => {
    it("reads an existing permissions.yaml from the home-relative path", async () => {
      const dirPath = join(testDir, ".continue");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "permissions.yaml"),
        dump({ allow: ["Bash(npm test)"], exclude: ["Edit"] }),
      );

      const perms = await ContinuePermissions.fromFile({ outputRoot: testDir, global: true });
      const json = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(json.permission.bash["npm test"]).toBe("allow");
      expect(json.permission.edit["*"]).toBe("deny");
    });

    it("returns empty content when the file does not exist", async () => {
      const perms = await ContinuePermissions.fromFile({ outputRoot: testDir, global: true });
      expect(perms.getFileContent()).toBe("");
    });
  });

  describe("forDeletion", () => {
    it("is not deletable", () => {
      const perms = ContinuePermissions.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".continue",
        relativeFilePath: "permissions.yaml",
      });
      expect(perms.isDeletable()).toBe(false);
    });
  });
});

import { join } from "node:path";

import { dump, load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, fileExists, readFileContent, writeFileContent } from "../../utils/file.js";
import { isRecord } from "../../utils/type-guards.js";
import { GoosePermissions } from "./goose-permissions.js";
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

function userPermissionOf(yamlContent: string): Record<string, unknown> {
  const parsed = load(yamlContent);
  if (!isRecord(parsed)) return {};
  return isRecord(parsed.user) ? parsed.user : {};
}

describe("GoosePermissions", () => {
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
    it("targets permission.yaml in the ~/.config/goose directory", () => {
      const paths = GoosePermissions.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".config", "goose"));
      expect(paths.relativeFilePath).toBe("permission.yaml");
    });
  });

  describe("isDeletable", () => {
    it("is never deletable (shared permission.yaml)", () => {
      const perms = new GoosePermissions({
        relativeDirPath: join(".config", "goose"),
        relativeFilePath: "permission.yaml",
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
      // `getHomeDirectory()` honours HOME_DIR ahead of everything else, so the
      // pseudo-home is reached without module-mocking the whole file utils.
      vi.stubEnv("HOME_DIR", homeDir);
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      await cleanupHome();
    });

    const permissionPath = (): string => join(homeDir, ".config", "goose", "permission.yaml");

    const generateThroughProcessor = async (
      permission: Record<string, Record<string, string>>,
    ): Promise<void> => {
      const processor = new PermissionsProcessor({
        logger: createMockLogger(),
        outputRoot: homeDir,
        toolTarget: "goose",
        global: true,
      });
      const toolFiles = await processor.convertRulesyncFilesToToolFiles([
        rulesyncPermissions(permission),
      ]);
      await processor.writeAiFiles(toolFiles);
    };

    it("is skipped: permission.yaml is Goose's file, not one to conjure for an empty payload", () => {
      const perms = new GoosePermissions({
        relativeDirPath: join(".config", "goose"),
        relativeFilePath: "permission.yaml",
        fileContent: "",
        validate: false,
      });
      expect(perms.shouldSkipCreationWhenPayloadEmpty()).toBe(true);
    });

    it("does not create permission.yaml when nothing maps and the file does not exist", async () => {
      // No rule maps, so the `user` block holds three empty lists — a file
      // that would say nothing.
      await generateThroughProcessor({});

      expect(await fileExists(permissionPath())).toBe(false);
    });

    it("still creates permission.yaml when a rule maps", async () => {
      await generateThroughProcessor({ bash: { "*": "allow" } });

      expect(userPermissionOf(await readFileContent(permissionPath())).always_allow).toEqual([
        "developer__shell",
      ]);
    });

    it("still rewrites an existing permission.yaml when nothing maps", async () => {
      await writeFileContent(
        permissionPath(),
        dump({
          user: { always_allow: ["developer__shell"], ask_before: [], never_allow: [] },
          smart_approve: { always_allow: ["developer__text_editor"] },
        }),
      );

      await generateThroughProcessor({});

      // The stale allowlist is emptied, and the unrelated block survives, so
      // the skip never withholds a write from a file the user already has.
      const content = await readFileContent(permissionPath());
      expect(userPermissionOf(content).always_allow).toEqual([]);
      const parsed = load(content);
      expect(isRecord(parsed) ? parsed.smart_approve : undefined).toEqual({
        always_allow: ["developer__text_editor"],
      });
    });
  });

  describe("global-only enforcement", () => {
    it("throws on non-global fromRulesyncPermissions", async () => {
      await expect(
        GoosePermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions: rulesyncPermissions({ bash: { "*": "ask" } }),
          global: false,
        }),
      ).rejects.toThrow(/global-only/);
    });

    it("throws on non-global fromFile", async () => {
      await expect(
        GoosePermissions.fromFile({ outputRoot: testDir, global: false }),
      ).rejects.toThrow(/global-only/);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("maps allow/ask/deny catch-alls onto always_allow/ask_before/never_allow", async () => {
      const perms = await GoosePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "*": "allow" },
          edit: { "*": "ask" },
          webfetch: { "*": "deny" },
        }),
        global: true,
      });

      const user = userPermissionOf(perms.getFileContent());
      expect(user.always_allow).toEqual(["developer__shell"]);
      expect(user.ask_before).toEqual(["developer__text_editor"]);
      expect(user.never_allow).toEqual(["webfetch"]);
    });

    it("passes unknown categories through verbatim as Goose tool names", async () => {
      const perms = await GoosePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          developer__image_processor: { "*": "allow" },
        }),
        global: true,
      });

      const user = userPermissionOf(perms.getFileContent());
      expect(user.always_allow).toEqual(["developer__image_processor"]);
    });

    it("warns and skips non-catch-all patterns (Goose lists hold whole tool names)", async () => {
      const mockLogger = createMockLogger();
      const perms = await GoosePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "git status": "allow" },
        }),
        logger: mockLogger,
        global: true,
      });

      const user = userPermissionOf(perms.getFileContent());
      expect(user.always_allow).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("git status"));
    });

    it("warns and lets edit win when edit and write set conflicting catch-alls", async () => {
      const mockLogger = createMockLogger();
      const perms = await GoosePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          write: { "*": "allow" },
          edit: { "*": "deny" },
        }),
        logger: mockLogger,
        global: true,
      });

      const user = userPermissionOf(perms.getFileContent());
      // edit (deny) deterministically wins over write (allow) on the shared
      // developer__text_editor tool; it is listed exactly once.
      expect(user.never_allow).toEqual(["developer__text_editor"]);
      expect(user.always_allow).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('"deny" value takes precedence'),
      );
    });

    it("merges into permission.yaml preserving the smart_approve cache", async () => {
      const dirPath = join(testDir, ".config", "goose");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "permission.yaml"),
        dump({
          smart_approve: {
            always_allow: ["developer__shell"],
            ask_before: [],
            never_allow: [],
          },
          user: {
            always_allow: ["stale_tool"],
            ask_before: [],
            never_allow: [],
          },
        }),
      );

      const perms = await GoosePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "*": "allow" } }),
        global: true,
      });

      const parsed = load(perms.getFileContent());
      if (!isRecord(parsed)) throw new Error("expected object");
      // The smart_approve LLM cache is preserved untouched.
      const smartApprove = isRecord(parsed.smart_approve) ? parsed.smart_approve : {};
      expect(smartApprove.always_allow).toEqual(["developer__shell"]);
      // The user block is fully managed by rulesync.
      const user = isRecord(parsed.user) ? parsed.user : {};
      expect(user.always_allow).toEqual(["developer__shell"]);
    });
  });

  describe("round-trip", () => {
    it("maps rulesync -> goose -> rulesync preserving allow/ask/deny", async () => {
      const original = rulesyncPermissions({
        bash: { "*": "allow" },
        edit: { "*": "ask" },
        webfetch: { "*": "deny" },
      });

      const toolPerms = await GoosePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: original,
        global: true,
      });

      const roundTripped = toolPerms.toRulesyncPermissions();
      const json = JSON.parse(roundTripped.getFileContent());

      expect(json.permission.bash["*"]).toBe("allow");
      expect(json.permission.edit["*"]).toBe("ask");
      expect(json.permission.webfetch["*"]).toBe("deny");
    });
  });

  describe("fromFile", () => {
    it("reads an existing permission.yaml from the home-relative path", async () => {
      const dirPath = join(testDir, ".config", "goose");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "permission.yaml"),
        dump({
          user: {
            always_allow: ["developer__shell"],
            ask_before: [],
            never_allow: ["developer__text_editor"],
          },
        }),
      );

      const perms = await GoosePermissions.fromFile({ outputRoot: testDir, global: true });
      const rulesync = perms.toRulesyncPermissions();
      const json = JSON.parse(rulesync.getFileContent());
      expect(json.permission.bash["*"]).toBe("allow");
      expect(json.permission.edit["*"]).toBe("deny");
    });
  });

  describe("forDeletion", () => {
    it("is not deletable", () => {
      const perms = GoosePermissions.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".config", "goose"),
        relativeFilePath: "permission.yaml",
      });
      expect(perms.isDeletable()).toBe(false);
    });
  });
});

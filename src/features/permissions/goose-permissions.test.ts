import { join } from "node:path";

import { dump, load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { isRecord } from "../../utils/type-guards.js";
import { GoosePermissions } from "./goose-permissions.js";
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

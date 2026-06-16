import { join } from "node:path";

import { dump, load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { isRecord } from "../../utils/type-guards.js";
import { RovodevPermissions } from "./rovodev-permissions.js";
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

function toolPermissionsOf(yamlContent: string): Record<string, unknown> {
  const parsed = load(yamlContent);
  if (!isRecord(parsed)) return {};
  return isRecord(parsed.toolPermissions) ? parsed.toolPermissions : {};
}

describe("RovodevPermissions", () => {
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
    it("targets config.yml in the ~/.rovodev directory", () => {
      const paths = RovodevPermissions.getSettablePaths();
      expect(paths.relativeDirPath).toBe(".rovodev");
      expect(paths.relativeFilePath).toBe("config.yml");
    });
  });

  describe("isDeletable", () => {
    it("is never deletable (shared config.yml)", () => {
      const perms = new RovodevPermissions({
        relativeDirPath: ".rovodev",
        relativeFilePath: "config.yml",
        fileContent: "",
        validate: false,
      });
      expect(perms.isDeletable()).toBe(false);
    });
  });

  describe("global-only enforcement", () => {
    it("throws on non-global fromRulesyncPermissions", async () => {
      await expect(
        RovodevPermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions: rulesyncPermissions({ bash: { "*": "ask" } }),
          global: false,
        }),
      ).rejects.toThrow(/global-only/);
    });

    it("throws on non-global fromFile", async () => {
      await expect(
        RovodevPermissions.fromFile({ outputRoot: testDir, global: false }),
      ).rejects.toThrow(/global-only/);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("maps bash catch-all to bash.default and patterns to bash.commands", async () => {
      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "*": "ask", "git status": "allow", "rm -rf .*": "deny" },
        }),
        global: true,
      });

      const tp = toolPermissionsOf(perms.getFileContent());
      const bash = isRecord(tp.bash) ? tp.bash : {};
      expect(bash.default).toBe("ask");
      expect(bash.commands).toEqual([
        { command: "git status", permission: "allow" },
        { command: "rm -rf .*", permission: "deny" },
      ]);
    });

    it("maps read/edit catch-alls to the matching per-tool keys", async () => {
      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          read: { "*": "allow" },
          edit: { "*": "deny" },
        }),
        global: true,
      });

      const tp = toolPermissionsOf(perms.getFileContent());
      expect(tp.open_files).toBe("allow");
      expect(tp.grep).toBe("allow");
      expect(tp.expand_code_chunks).toBe("allow");
      expect(tp.expand_folder).toBe("allow");
      expect(tp.find_and_replace_code).toBe("deny");
      expect(tp.create_file).toBe("deny");
      expect(tp.delete_file).toBe("deny");
      expect(tp.move_file).toBe("deny");
    });

    it("routes non-catch-all allow paths to allowedExternalPaths", async () => {
      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          read: { "/tmp/shared": "allow", "/var/data": "allow" },
        }),
        global: true,
      });

      const tp = toolPermissionsOf(perms.getFileContent());
      expect(tp.allowedExternalPaths).toEqual(["/tmp/shared", "/var/data"]);
    });

    it("warns and skips categories without a clean Rovo Dev target", async () => {
      const mockLogger = createMockLogger();
      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          webfetch: { "github.com": "allow" },
        }),
        logger: mockLogger,
        global: true,
      });

      const tp = toolPermissionsOf(perms.getFileContent());
      expect(tp.webfetch).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("webfetch"));
    });

    it("merges into config.yml preserving all other top-level keys", async () => {
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({
          agent: { model: "claude" },
          sessions: { retention: 30 },
          mcp: { someSetting: true },
          toolPermissions: { grep: "allow", customKey: "preserved" },
        }),
      );

      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "*": "ask" } }),
        global: true,
      });

      const parsed = load(perms.getFileContent());
      if (!isRecord(parsed)) throw new Error("expected object");
      // Unrelated top-level keys preserved.
      expect(parsed.agent).toEqual({ model: "claude" });
      expect(parsed.sessions).toEqual({ retention: 30 });
      expect(parsed.mcp).toEqual({ someSetting: true });
      // Managed block merged in; unmanaged keys inside it preserved.
      const tp = isRecord(parsed.toolPermissions) ? parsed.toolPermissions : {};
      expect(isRecord(tp.bash) ? tp.bash.default : undefined).toBe("ask");
      expect(tp.customKey).toBe("preserved");
    });
  });

  describe("round-trip", () => {
    it("maps rulesync -> rovodev -> rulesync preserving bash and per-tool levels", async () => {
      const original = rulesyncPermissions({
        bash: { "*": "ask", "git status": "allow" },
        read: { "*": "allow" },
        edit: { "*": "deny" },
      });

      const toolPerms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: original,
        global: true,
      });

      const roundTripped = toolPerms.toRulesyncPermissions();
      const json = JSON.parse(roundTripped.getFileContent());

      expect(json.permission.bash["*"]).toBe("ask");
      expect(json.permission.bash["git status"]).toBe("allow");
      expect(json.permission.read["*"]).toBe("allow");
      expect(json.permission.edit["*"]).toBe("deny");
    });
  });

  describe("fromFile", () => {
    it("reads an existing config.yml from the home-relative path", async () => {
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({ toolPermissions: { grep: "deny" } }),
      );

      const perms = await RovodevPermissions.fromFile({ outputRoot: testDir, global: true });
      const tp = toolPermissionsOf(perms.getFileContent());
      expect(tp.grep).toBe("deny");
    });
  });
});

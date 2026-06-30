import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { JuniePermissions } from "./junie-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

const buildRulesyncPermissions = (config: unknown): RulesyncPermissions =>
  new RulesyncPermissions({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
    fileContent: JSON.stringify(config),
  });

describe("JuniePermissions", () => {
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
    it("should return .junie/allowlist.json", () => {
      const paths = JuniePermissions.getSettablePaths();
      expect(paths.relativeDirPath).toBe(".junie");
      expect(paths.relativeFilePath).toBe("allowlist.json");
    });

    it("should return the same relative path for global scope", () => {
      const paths = JuniePermissions.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(".junie");
      expect(paths.relativeFilePath).toBe("allowlist.json");
    });
  });

  describe("isDeletable", () => {
    it("should return false since allowlist.json holds top-level settings", () => {
      const instance = new JuniePermissions({
        relativeDirPath: ".junie",
        relativeFilePath: "allowlist.json",
        fileContent: "{}",
      });
      expect(instance.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("should map canonical categories to Junie rule groups", async () => {
      const rulesyncPermissions = buildRulesyncPermissions({
        permission: {
          bash: { "git ": "allow", "rm *": "deny" },
          edit: { "src/**": "allow" },
          read: { "/etc/**": "deny" },
          mcp: { search: "ask" },
        },
      });

      const instance = await JuniePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(instance.getFileContent());
      // Literal patterns become `prefix`; glob patterns become `pattern`.
      expect(json.rules.executables).toEqual([
        { prefix: "git ", action: "allow" },
        { pattern: "rm *", action: "deny" },
      ]);
      expect(json.rules.fileEditing).toEqual([{ pattern: "src/**", action: "allow" }]);
      expect(json.rules.readOutsideProject).toEqual([{ pattern: "/etc/**", action: "deny" }]);
      expect(json.rules.mcpTools).toEqual([{ prefix: "search", action: "ask" }]);
      // defaultBehavior defaults to Junie's documented "ask" when absent.
      expect(json.defaultBehavior).toBe("ask");
    });

    it("should fold write rules into fileEditing alongside edit rules", async () => {
      const rulesyncPermissions = buildRulesyncPermissions({
        permission: {
          edit: { "src/**": "allow" },
          write: { "dist/**": "deny" },
        },
      });

      const instance = await JuniePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(instance.getFileContent());
      expect(json.rules.fileEditing).toEqual([
        { pattern: "src/**", action: "allow" },
        { pattern: "dist/**", action: "deny" },
      ]);
    });

    it("should preserve top-level settings in an existing allowlist.json", async () => {
      const dir = join(testDir, ".junie");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "allowlist.json"),
        JSON.stringify({
          defaultBehavior: "deny",
          allowReadonlyCommands: true,
          rules: { executables: [{ prefix: "old", action: "allow" }] },
        }),
      );

      const rulesyncPermissions = buildRulesyncPermissions({
        permission: { bash: { "git ": "allow" } },
      });

      const instance = await JuniePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(instance.getFileContent());
      // Top-level settings preserved; rules replaced by rulesync-managed groups.
      expect(json.defaultBehavior).toBe("deny");
      expect(json.allowReadonlyCommands).toBe(true);
      expect(json.rules.executables).toEqual([{ prefix: "git ", action: "allow" }]);
    });

    it("should warn and skip categories Junie cannot represent", async () => {
      const mockLogger = createMockLogger();
      const rulesyncPermissions = buildRulesyncPermissions({
        permission: {
          bash: { ls: "allow" },
          webfetch: { "https://example.com": "deny" },
        },
      });

      const instance = await JuniePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger: mockLogger,
      });

      const json = JSON.parse(instance.getFileContent());
      expect(json.rules.executables).toEqual([{ prefix: "ls", action: "allow" }]);
      expect(json.rules.readOutsideProject).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("webfetch"));
    });
  });

  describe("toRulesyncPermissions", () => {
    it("should convert Junie rule groups back into canonical categories", () => {
      const instance = new JuniePermissions({
        relativeDirPath: ".junie",
        relativeFilePath: "allowlist.json",
        fileContent: JSON.stringify({
          defaultBehavior: "ask",
          rules: {
            executables: [
              { prefix: "git ", action: "allow" },
              { pattern: "rm *", action: "deny" },
            ],
            fileEditing: [{ pattern: "src/**", action: "allow" }],
            readOutsideProject: [{ pattern: "/etc/**", action: "deny" }],
            mcpTools: [{ prefix: "search", action: "ask" }],
          },
        }),
      });

      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());
      expect(config.permission.bash).toEqual({ "git ": "allow", "rm *": "deny" });
      expect(config.permission.edit).toEqual({ "src/**": "allow" });
      expect(config.permission.read).toEqual({ "/etc/**": "deny" });
      expect(config.permission.mcp).toEqual({ search: "ask" });
    });

    it("should ignore malformed rules and unknown actions", () => {
      const instance = new JuniePermissions({
        relativeDirPath: ".junie",
        relativeFilePath: "allowlist.json",
        fileContent: JSON.stringify({
          rules: {
            executables: [
              { prefix: "git ", action: "allow" },
              { prefix: "bad", action: "sometimes" },
              { action: "deny" },
              "not-an-object",
            ],
          },
        }),
      });

      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());
      expect(config.permission.bash).toEqual({ "git ": "allow" });
    });
  });

  describe("round-trip", () => {
    it("should round-trip rules across the four groups", async () => {
      const original = buildRulesyncPermissions({
        permission: {
          bash: { "git ": "allow", "rm *": "deny" },
          edit: { "src/**": "allow" },
          read: { "/etc/**": "deny" },
          mcp: { search: "ask" },
        },
      });

      const junie = await JuniePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: original,
      });
      const roundTripped = JSON.parse(junie.toRulesyncPermissions().getFileContent());

      expect(roundTripped.permission).toEqual({
        bash: { "git ": "allow", "rm *": "deny" },
        edit: { "src/**": "allow" },
        read: { "/etc/**": "deny" },
        mcp: { search: "ask" },
      });
    });
  });
});

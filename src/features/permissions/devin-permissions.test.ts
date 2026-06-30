import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { DevinPermissions } from "./devin-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

describe("DevinPermissions", () => {
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

  const makeRulesyncPermissions = (config: unknown): RulesyncPermissions =>
    new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify(config),
      validate: false,
    });

  describe("getSettablePaths", () => {
    it("should return .devin/config.json for project mode", () => {
      expect(DevinPermissions.getSettablePaths()).toEqual({
        relativeDirPath: ".devin",
        relativeFilePath: "config.json",
      });
    });

    it("should return ~/.config/devin/config.json for global mode", () => {
      expect(DevinPermissions.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".config", "devin"),
        relativeFilePath: "config.json",
      });
    });
  });

  describe("isDeletable", () => {
    it("should never delete the shared config.json", () => {
      const perms = DevinPermissions.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".devin",
        relativeFilePath: "config.json",
      });
      expect(perms.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("should map canonical categories to Devin scope matchers under the permissions key", async () => {
      const config = {
        permission: {
          read: { "src/**": "allow" },
          write: { "tests/**": "allow", "*.lock": "deny" },
          edit: { "docs/**": "allow" },
          bash: { git: "allow", rm: "deny", "*": "ask" },
          webfetch: { "https://api.github.com/*": "allow" },
          mcp__github__list_issues: { "*": "allow" },
        },
      };

      const perms = await DevinPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions(config),
      });

      const parsed = JSON.parse(perms.getFileContent());
      expect(parsed.permissions.allow).toContain("Read(src/**)");
      expect(parsed.permissions.allow).toContain("Write(tests/**)");
      expect(parsed.permissions.allow).toContain("Write(docs/**)");
      expect(parsed.permissions.allow).toContain("Exec(git)");
      expect(parsed.permissions.allow).toContain("Fetch(https://api.github.com/*)");
      expect(parsed.permissions.allow).toContain("mcp__github__list_issues");
      expect(parsed.permissions.deny).toContain("Write(*.lock)");
      expect(parsed.permissions.deny).toContain("Exec(rm)");
      // `*` pattern collapses to the bare scope name.
      expect(parsed.permissions.ask).toContain("Exec");
    });

    it("should merge into the shared config.json, preserving mcpServers and hooks", async () => {
      const dir = join(testDir, ".devin");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "config.json"),
        JSON.stringify({
          mcpServers: { a: { command: "x" } },
          hooks: { Stop: [{ hooks: [{ type: "command", command: "s.sh" }] }] },
        }),
      );

      const perms = await DevinPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          permission: { read: { "src/**": "allow" } },
        }),
      });

      const parsed = JSON.parse(perms.getFileContent());
      expect(parsed.mcpServers).toEqual({ a: { command: "x" } });
      expect(parsed.hooks).toEqual({ Stop: [{ hooks: [{ type: "command", command: "s.sh" }] }] });
      expect(parsed.permissions.allow).toEqual(["Read(src/**)"]);
    });

    it("should preserve existing entries for unmanaged scopes", async () => {
      const dir = join(testDir, ".devin");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "config.json"),
        JSON.stringify({ permissions: { allow: ["Fetch(domain:npmjs.org)"] } }),
      );

      const perms = await DevinPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          permission: { read: { "src/**": "allow" } },
        }),
      });

      const parsed = JSON.parse(perms.getFileContent());
      // webfetch is unmanaged here, so the existing Fetch entry survives.
      expect(parsed.permissions.allow).toContain("Fetch(domain:npmjs.org)");
      expect(parsed.permissions.allow).toContain("Read(src/**)");
    });

    it("should write to the global config.json path", async () => {
      const perms = await DevinPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          permission: { read: { "src/**": "allow" } },
        }),
        global: true,
      });
      expect(perms.getRelativeDirPath()).toBe(join(".config", "devin"));
      expect(perms.getRelativeFilePath()).toBe("config.json");
    });
  });

  describe("toRulesyncPermissions", () => {
    it("should map Devin scopes back to canonical categories with deny precedence", () => {
      const perms = new DevinPermissions({
        outputRoot: testDir,
        relativeDirPath: ".devin",
        relativeFilePath: "config.json",
        fileContent: JSON.stringify({
          permissions: {
            allow: ["Read(src/**)", "Exec(git)", "Exec(rm)"],
            deny: ["Exec(rm)", "Write(*.lock)"],
            ask: ["Fetch(domain:npmjs.org)"],
          },
        }),
        validate: false,
      });

      const parsed = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(parsed.permission.read["src/**"]).toBe("allow");
      expect(parsed.permission.bash.git).toBe("allow");
      // deny is processed last, so it wins over the allow on the same (scope, pattern).
      expect(parsed.permission.bash.rm).toBe("deny");
      expect(parsed.permission.write["*.lock"]).toBe("deny");
      expect(parsed.permission.webfetch["domain:npmjs.org"]).toBe("ask");
    });

    it("should skip prototype-pollution keys when importing", () => {
      const perms = new DevinPermissions({
        outputRoot: testDir,
        relativeDirPath: ".devin",
        relativeFilePath: "config.json",
        fileContent: JSON.stringify({
          permissions: {
            allow: ["Read(src/**)"],
            deny: ["__proto__", "Exec(__proto__)", "constructor", "Write(constructor)"],
            ask: [],
          },
        }),
        validate: false,
      });

      const parsed = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      // The legitimate entry survives; the pollution entries are dropped.
      expect(parsed.permission.read["src/**"]).toBe("allow");
      // Object.prototype must not have been mutated.
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.prototype).not.toHaveProperty("__proto__", "deny");
    });

    it("should round-trip a permissions config", async () => {
      const config = {
        permission: {
          read: { "src/**": "allow" },
          bash: { git: "allow", rm: "deny" },
          webfetch: { "https://api.github.com/*": "ask" },
        },
      };
      const perms = await DevinPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions(config),
      });
      const back = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(back.permission).toEqual(config.permission);
    });
  });
});

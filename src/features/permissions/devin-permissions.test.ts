import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
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

    it("should write the devin.sandbox override into the global config.json", async () => {
      const logger = createMockLogger();
      const perms = await DevinPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          permission: { read: { "src/**": "allow" } },
          devin: {
            sandbox: {
              allowed_domains: ["github.com"],
              network_mode: "limited",
              excluded: { allow: ["Exec(git status *)"], deny: ["Exec(git tag *)"] },
            },
          },
        }),
        global: true,
        logger,
      });

      const parsed = JSON.parse(perms.getFileContent());
      expect(parsed.sandbox).toEqual({
        allowed_domains: ["github.com"],
        network_mode: "limited",
        excluded: { allow: ["Exec(git status *)"], deny: ["Exec(git tag *)"] },
      });
      expect(parsed.permissions.allow).toEqual(["Read(src/**)"]);
      // `excluded.allow` names commands that escape the sandbox, so the write is
      // announced. `network_mode: "limited"` and `excluded.deny` restrict, and a
      // non-empty `allowed_domains` is itself an allowlist — narrower than the
      // absent key it replaces — so none of the three is named.
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const [warning] = logger.warn.mock.calls[0] as [string];
      expect(warning).toContain("1 trust-affecting sandbox change");
      expect(warning).toContain("'sandbox.excluded.allow'");
      expect(warning).not.toContain("'sandbox.allowed_domains'");
      expect(warning).not.toContain("'sandbox.network_mode'");
      expect(warning).not.toContain("'sandbox.excluded.deny'");
    });

    it("should not warn for a devin.sandbox override that only narrows the sandbox", async () => {
      const logger = createMockLogger();
      const perms = await DevinPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          permission: { read: { "src/**": "allow" } },
          devin: {
            sandbox: {
              denied_domains: ["evil.example.com"],
              network_mode: "limited",
              allowed_domains: ["github.com"],
              excluded: { deny: ["Exec(git tag *)"] },
            },
          },
        }),
        global: true,
        logger,
      });

      expect(JSON.parse(perms.getFileContent()).sandbox.denied_domains).toEqual([
        "evil.example.com",
      ]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should warn once when network_mode opens every HTTP method", async () => {
      const logger = createMockLogger();
      await DevinPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          permission: { read: { "src/**": "allow" } },
          devin: { sandbox: { network_mode: "full" } },
        }),
        global: true,
        logger,
      });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("1 trust-affecting sandbox change"),
      );
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("'sandbox.network_mode'"));
    });

    it("should preserve an existing sandbox block when no devin override is authored", async () => {
      const dir = join(testDir, ".config", "devin");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "config.json"),
        JSON.stringify({ sandbox: { denied_domains: ["evil.example.com"], network_mode: "full" } }),
      );

      const logger = createMockLogger();
      const perms = await DevinPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          permission: { read: { "src/**": "allow" } },
        }),
        global: true,
        logger,
      });

      // `sandbox` is an owned key of this feature now, so the untouched block
      // must survive a generate that says nothing about it — and preserving a
      // value the user set by hand is not rulesync opening the sandbox.
      const parsed = JSON.parse(perms.getFileContent());
      expect(parsed.sandbox).toEqual({
        denied_domains: ["evil.example.com"],
        network_mode: "full",
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should warn when the override drops restricting sandbox entries already in the file", async () => {
      const dir = join(testDir, ".config", "devin");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "config.json"),
        JSON.stringify({
          sandbox: {
            denied_domains: ["evil.example.com"],
            excluded: { deny: ["Exec(git tag *)"] },
          },
        }),
      );

      const logger = createMockLogger();
      await DevinPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          permission: { read: { "src/**": "allow" } },
          // Shrinks the deny list, and replaces `excluded` wholesale so its
          // `deny` list disappears — both loosen the policy by omission.
          devin: { sandbox: { denied_domains: [], excluded: {} } },
        }),
        global: true,
        logger,
      });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      const [warning] = logger.warn.mock.calls[0] as [string];
      expect(warning).toContain("2 trust-affecting sandbox changes");
      expect(warning).toContain("'sandbox.denied_domains'");
      expect(warning).toContain("'sandbox.excluded.deny'");
    });

    it("should not warn when the override only adds to a restricting sandbox list", async () => {
      const dir = join(testDir, ".config", "devin");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "config.json"),
        JSON.stringify({ sandbox: { denied_domains: ["evil.example.com"] } }),
      );

      const logger = createMockLogger();
      await DevinPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          permission: { read: { "src/**": "allow" } },
          devin: { sandbox: { denied_domains: ["evil.example.com", "worse.example.com"] } },
        }),
        global: true,
        logger,
      });

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should warn about a widened key and a dropped restriction in one message", async () => {
      const dir = join(testDir, ".config", "devin");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "config.json"),
        JSON.stringify({ sandbox: { denied_domains: ["evil.example.com"] } }),
      );

      const logger = createMockLogger();
      await DevinPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          permission: { read: { "src/**": "allow" } },
          // One entry from each collector: a key whose value widens on its own,
          // and a list that loses an entry the file already had.
          devin: {
            sandbox: { denied_domains: [], excluded: { allow: ["Exec(git status *)"] } },
          },
        }),
        global: true,
        logger,
      });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      const [warning] = logger.warn.mock.calls[0] as [string];
      expect(warning).toContain("2 trust-affecting sandbox changes");
      expect(warning).toContain("'sandbox.excluded.allow'");
      expect(warning).toContain("'sandbox.denied_domains'");
    });

    it("should warn when a restricting key in the file is not a list at all", async () => {
      const dir = join(testDir, ".config", "devin");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "config.json"),
        // Hand-written or corrupted: not the list Devin expects. Whatever it
        // meant, replacing it is not something to do silently.
        JSON.stringify({ sandbox: { denied_domains: "evil.example.com" } }),
      );

      const logger = createMockLogger();
      await DevinPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          permission: { read: { "src/**": "allow" } },
          devin: { sandbox: { denied_domains: [] } },
        }),
        global: true,
        logger,
      });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("'sandbox.denied_domains'"));
    });

    it("should not materialize an empty sandbox block", async () => {
      const perms = await DevinPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          permission: { read: { "src/**": "allow" } },
          devin: { sandbox: {} },
        }),
        global: true,
      });

      expect(perms.getFileContent()).not.toContain("sandbox");
    });

    it("should shallow-merge the devin.sandbox override over sibling keys already in the file", async () => {
      const dir = join(testDir, ".config", "devin");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "config.json"),
        JSON.stringify({ sandbox: { denied_domains: ["evil.example.com"], network_mode: "full" } }),
      );

      const perms = await DevinPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          permission: { read: { "src/**": "allow" } },
          devin: { sandbox: { network_mode: "limited" } },
        }),
        global: true,
      });

      const parsed = JSON.parse(perms.getFileContent());
      // The override wins on the key it states; the sibling key survives.
      expect(parsed.sandbox).toEqual({
        denied_domains: ["evil.example.com"],
        network_mode: "limited",
      });
    });

    it("should drop the devin.sandbox override at project scope with a warning", async () => {
      const logger = createMockLogger();
      const perms = await DevinPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          permission: { read: { "src/**": "allow" } },
          devin: { sandbox: { network_mode: "limited" } },
        }),
        logger,
      });

      const parsed = JSON.parse(perms.getFileContent());
      expect(parsed.sandbox).toBeUndefined();
      expect(parsed.permissions.allow).toEqual(["Read(src/**)"]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("user config only"));
    });

    it("should not warn about an empty devin.sandbox override at project scope", async () => {
      const logger = createMockLogger();
      await DevinPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          permission: { read: { "src/**": "allow" } },
          devin: { sandbox: {} },
        }),
        logger,
      });

      // Nothing was dropped, so there is nothing to announce.
      expect(logger.warn).not.toHaveBeenCalled();
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

    it("should route the sandbox block into the devin override", () => {
      const perms = new DevinPermissions({
        outputRoot: testDir,
        relativeDirPath: ".config/devin",
        relativeFilePath: "config.json",
        fileContent: JSON.stringify({
          permissions: { allow: ["Read(src/**)"] },
          sandbox: {
            allowed_domains: ["github.com"],
            excluded: { ask: ["Exec(git push *)"] },
          },
        }),
      });

      const parsed = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(parsed.devin).toEqual({
        sandbox: {
          allowed_domains: ["github.com"],
          excluded: { ask: ["Exec(git push *)"] },
        },
      });
      expect(parsed.permission.read).toEqual({ "src/**": "allow" });
    });

    it("should not emit a devin override when the config has no sandbox block", () => {
      const perms = new DevinPermissions({
        outputRoot: testDir,
        relativeDirPath: ".devin",
        relativeFilePath: "config.json",
        fileContent: JSON.stringify({ permissions: { allow: ["Read(src/**)"] } }),
      });

      expect(JSON.parse(perms.toRulesyncPermissions().getFileContent()).devin).toBeUndefined();
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

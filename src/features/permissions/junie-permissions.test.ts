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
    it("should map canonical categories to Junie rule groups (deny downgraded to ask)", async () => {
      const mockLogger = createMockLogger();
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
        logger: mockLogger,
      });

      const json = JSON.parse(instance.getFileContent());
      // Literal patterns become `prefix`; glob patterns become `pattern`.
      // Junie has no `deny`, so canonical deny is downgraded to `ask` + warned.
      expect(json.rules.executables).toEqual({
        rules: [
          { prefix: "git ", action: "allow" },
          { pattern: "rm *", action: "ask" },
        ],
      });
      expect(json.rules.fileEditing).toEqual({ rules: [{ pattern: "src/**", action: "allow" }] });
      expect(json.rules.readOutsideProject).toEqual({
        rules: [{ pattern: "/etc/**", action: "ask" }],
      });
      expect(json.rules.mcpTools).toEqual({ rules: [{ prefix: "search", action: "ask" }] });
      // defaultBehavior is not fabricated when neither the override nor an
      // existing file supplies it (Junie's own default is already "ask").
      expect(json.defaultBehavior).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("no 'deny'"));
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
      // `write` deny also downgrades to `ask` (Junie has no `deny`).
      expect(json.rules.fileEditing).toEqual({
        rules: [
          { pattern: "src/**", action: "allow" },
          { pattern: "dist/**", action: "ask" },
        ],
      });
    });

    it("should overlay the junie override's top-level autonomy knobs", async () => {
      const rulesyncPermissions = buildRulesyncPermissions({
        permission: { bash: { "git ": "allow" } },
        junie: { allowReadonlyCommands: true, defaultBehavior: "allow" },
      });

      const instance = await JuniePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(instance.getFileContent());
      expect(json.allowReadonlyCommands).toBe(true);
      expect(json.defaultBehavior).toBe("allow");
      expect(json.rules.executables).toEqual({ rules: [{ prefix: "git ", action: "allow" }] });
    });

    it("should let the junie override win over an existing top-level value", async () => {
      const dir = join(testDir, ".junie");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "allowlist.json"),
        JSON.stringify({ defaultBehavior: "ask", allowReadonlyCommands: false }),
      );

      const rulesyncPermissions = buildRulesyncPermissions({
        permission: { bash: { "git ": "allow" } },
        junie: { allowReadonlyCommands: true },
      });

      const instance = await JuniePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(instance.getFileContent());
      expect(json.allowReadonlyCommands).toBe(true);
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
      expect(json.rules.executables).toEqual({ rules: [{ prefix: "git ", action: "allow" }] });
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
      expect(json.rules.executables).toEqual({ rules: [{ prefix: "ls", action: "allow" }] });
      expect(json.rules.readOutsideProject).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("webfetch"));
    });
  });

  describe("AllowListRuleSet shape (issue #2411)", () => {
    it("should author per-group defaults and readSecretFile via the junie override", async () => {
      const rulesyncPermissions = buildRulesyncPermissions({
        permission: { bash: { "git ": "allow" } },
        junie: {
          ruleDefaults: { executables: "ask" },
          readSecretFile: { default: "ask", rules: [{ pattern: "**/.env", action: "ask" }] },
        },
      });

      const instance = await JuniePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(instance.getFileContent());
      expect(json.rules.executables).toEqual({
        default: "ask",
        rules: [{ prefix: "git ", action: "allow" }],
      });
      expect(json.rules.readSecretFile).toEqual({
        default: "ask",
        rules: [{ pattern: "**/.env", action: "ask" }],
      });
      // The group-shaped override fields must not leak onto the top level.
      expect(json.ruleDefaults).toBeUndefined();
      expect(json.readSecretFile).toBeUndefined();
    });

    it("should preserve an existing readSecretFile group and group default on generate", async () => {
      const dir = join(testDir, ".junie");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "allowlist.json"),
        JSON.stringify({
          rules: {
            executables: { default: "ask", rules: [{ prefix: "old", action: "allow" }] },
            readSecretFile: { rules: [{ pattern: "**/secrets/**", action: "ask" }] },
          },
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
      // Rules are rulesync-owned (replaced), but the group's own default and
      // the whole secret-file group — which restricts what Junie may read —
      // survive a generate that does not author them.
      expect(json.rules.executables).toEqual({
        default: "ask",
        rules: [{ prefix: "git ", action: "allow" }],
      });
      expect(json.rules.readSecretFile).toEqual({
        rules: [{ pattern: "**/secrets/**", action: "ask" }],
      });
    });

    it("should let an authored ruleDefault win over an existing group default", async () => {
      const dir = join(testDir, ".junie");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "allowlist.json"),
        JSON.stringify({
          rules: { executables: { default: "allow", rules: [] } },
        }),
      );

      const rulesyncPermissions = buildRulesyncPermissions({
        permission: { bash: { "git ": "allow" } },
        junie: { ruleDefaults: { executables: "ask" } },
      });

      const instance = await JuniePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(instance.getFileContent());
      expect(json.rules.executables.default).toBe("ask");
    });

    it("should not write back an existing group default outside allow/ask", async () => {
      const dir = join(testDir, ".junie");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "allowlist.json"),
        JSON.stringify({
          rules: { executables: { default: "deny", rules: [] } },
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
      // A hand-written "deny" fails Junie's whole-file parse; writing it back
      // would hand Junie a file it destroys.
      expect(json.rules.executables).toEqual({ rules: [{ prefix: "git ", action: "allow" }] });
    });

    it("should sanitize a broken readSecretFile group on import so the canonical file stays valid", () => {
      const instance = new JuniePermissions({
        relativeDirPath: ".junie",
        relativeFilePath: "allowlist.json",
        fileContent: JSON.stringify({
          rules: {
            readSecretFile: {
              default: "deny",
              rules: [
                { pattern: "**/.env", action: "deny" },
                { pattern: "**/.aws/**" },
                "junk",
                { action: "allow" },
              ],
            },
          },
        }),
      });

      const canonical = instance.toRulesyncPermissions();
      const config = JSON.parse(canonical.getFileContent());
      // Restrictive entries survive with the nearest valid action (ask) rather
      // than being dropped — these rules restrict what Junie may read. The
      // invalid default and pattern-less entries are dropped.
      expect(config.junie.readSecretFile).toEqual({
        rules: [
          { pattern: "**/.env", action: "ask" },
          { pattern: "**/.aws/**", action: "ask" },
        ],
      });
      // The lifted value must satisfy the canonical schema, or every later
      // generate would fail on it.
      expect(
        () =>
          new RulesyncPermissions({
            relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
            relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
            fileContent: canonical.getFileContent(),
            validate: true,
          }),
      ).not.toThrow();
    });

    it("should not lift a defaultBehavior outside allow/ask into the override", () => {
      const instance = new JuniePermissions({
        relativeDirPath: ".junie",
        relativeFilePath: "allowlist.json",
        fileContent: JSON.stringify({
          defaultBehavior: "deny",
          rules: { executables: { rules: [{ prefix: "git ", action: "allow" }] } },
        }),
      });

      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());
      expect(config.junie).toBeUndefined();
    });

    it("should import object-form groups, lifting default and readSecretFile into the override", () => {
      const instance = new JuniePermissions({
        relativeDirPath: ".junie",
        relativeFilePath: "allowlist.json",
        fileContent: JSON.stringify({
          rules: {
            executables: { default: "ask", rules: [{ prefix: "git ", action: "allow" }] },
            readSecretFile: { rules: [{ pattern: "**/.env", action: "ask" }] },
          },
        }),
      });

      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());
      expect(config.permission.bash).toEqual({ "git ": "allow" });
      expect(config.junie).toEqual({
        ruleDefaults: { executables: "ask" },
        readSecretFile: { rules: [{ pattern: "**/.env", action: "ask" }] },
      });
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
      // A hand-written `deny` (invalid per Junie, but present) is imported
      // faithfully into the canonical model.
      expect(config.permission.bash).toEqual({ "git ": "allow", "rm *": "deny" });
      expect(config.permission.edit).toEqual({ "src/**": "allow" });
      expect(config.permission.read).toEqual({ "/etc/**": "deny" });
      expect(config.permission.mcp).toEqual({ search: "ask" });
    });

    it("should lift top-level autonomy knobs into the junie override", () => {
      const instance = new JuniePermissions({
        relativeDirPath: ".junie",
        relativeFilePath: "allowlist.json",
        fileContent: JSON.stringify({
          defaultBehavior: "ask",
          allowReadonlyCommands: true,
          rules: { executables: [{ prefix: "git ", action: "allow" }] },
        }),
      });

      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());
      expect(config.junie).toEqual({ allowReadonlyCommands: true, defaultBehavior: "ask" });
    });

    it("should omit the junie override when no top-level knobs are present", () => {
      const instance = new JuniePermissions({
        relativeDirPath: ".junie",
        relativeFilePath: "allowlist.json",
        fileContent: JSON.stringify({
          rules: { executables: [{ prefix: "git ", action: "allow" }] },
        }),
      });

      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());
      expect(config.junie).toBeUndefined();
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
    it("should round-trip rules across the four groups (deny lands as ask)", async () => {
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

      // Junie has no `deny`, so the two deny rules round-trip as `ask`.
      expect(roundTripped.permission).toEqual({
        bash: { "git ": "allow", "rm *": "ask" },
        edit: { "src/**": "allow" },
        read: { "/etc/**": "ask" },
        mcp: { search: "ask" },
      });
    });

    it("should not add a spurious junie override when none was authored", async () => {
      const original = buildRulesyncPermissions({
        permission: { bash: { "git ": "allow" } },
      });

      const junie = await JuniePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: original,
      });
      const roundTripped = JSON.parse(junie.toRulesyncPermissions().getFileContent());

      expect(roundTripped.junie).toBeUndefined();
    });

    it("should round-trip the junie override through export and re-import", async () => {
      const original = buildRulesyncPermissions({
        permission: { bash: { "git ": "allow" } },
        junie: { allowReadonlyCommands: true, defaultBehavior: "ask" },
      });

      const junie = await JuniePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: original,
      });
      const roundTripped = JSON.parse(junie.toRulesyncPermissions().getFileContent());

      expect(roundTripped.junie).toEqual({ allowReadonlyCommands: true, defaultBehavior: "ask" });
    });
  });
});

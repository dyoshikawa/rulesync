import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { BobPermissions } from "./bob-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

function createRulesyncPermissions(permission: Record<string, Record<string, string>>) {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify({ permission }),
    validate: true,
  });
}

function createRulesyncPermissionsWithBob(
  permission: Record<string, Record<string, string>>,
  bob: Record<string, unknown>,
) {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify({ permission, bob }),
    validate: true,
  });
}

async function writeSettings(testDir: string, content: string): Promise<void> {
  await ensureDir(join(testDir, ".bob", "settings"));
  await writeFileContent(join(testDir, ".bob", "settings", "settings.json"), content);
}

function warnings(logger: ReturnType<typeof createMockLogger>): string[] {
  return vi.mocked(logger.warn).mock.calls.map(([message]) => String(message));
}

describe("BobPermissions", () => {
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
    it("returns the user settings file for either scope", () => {
      for (const global of [true, false]) {
        expect(BobPermissions.getSettablePaths({ global })).toEqual({
          relativeDirPath: join(".bob", "settings"),
          relativeFilePath: "settings.json",
        });
      }
    });
  });

  describe("isDeletable", () => {
    it("is not deletable (shared settings file)", () => {
      const permissions = BobPermissions.forDeletion({
        relativeDirPath: join(".bob", "settings"),
        relativeFilePath: "settings.json",
      });
      expect(permissions.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("maps bash allow/deny onto the execute_command executor and omits ask", async () => {
      const permissions = await BobPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          bash: { "git status": "allow", rm: "deny", "npm publish": "ask" },
        }),
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual({
        approval: {
          allowedExecutors: [
            { toolId: "execute_command", approvedCommands: ["git status"], deniedCommands: ["rm"] },
          ],
        },
      });
    });

    it("withholds an allow prefix that an ask rule overlaps", async () => {
      // Bob matches `approvedCommands` as a prefix, so writing `git ` would
      // auto-approve the `git push` the author asked to be prompted for.
      const permissions = await BobPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          bash: { "git ": "allow", "git push *": "ask", ls: "allow" },
        }),
        logger: createMockLogger(),
      });

      const entry = JSON.parse(permissions.getFileContent()).approval.allowedExecutors[0];
      expect(entry.approvedCommands).toEqual(["ls"]);
    });

    it("adds the literal prefix of a glob-shaped deny so it takes effect", async () => {
      const logger = createMockLogger();
      const permissions = await BobPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ bash: { "rm -rf *": "deny" } }),
        logger,
      });

      const entry = JSON.parse(permissions.getFileContent()).approval.allowedExecutors[0];
      expect(entry.deniedCommands).toEqual(["rm -rf *", "rm -rf "]);
      expect(warnings(logger).some((message) => message.includes('"rm -rf *" → "rm -rf "'))).toBe(
        true,
      );
    });

    it("does not describe a bare * as a wildcard", async () => {
      const logger = createMockLogger();
      await BobPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ bash: { "*": "deny", "ls *": "allow" } }),
        logger,
      });

      const messages = warnings(logger);
      expect(messages.some((message) => message.includes("treated as a wildcard"))).toBe(false);
      expect(messages.some((message) => message.includes('"*"') && message.includes("never"))).toBe(
        true,
      );
    });

    it("withholds every allow when a deny pins down no prefix", async () => {
      // Neither `"*"` nor `"*.sh"` can match as a Bob prefix, so writing `ls`
      // would auto-approve commands the canonical deny blocks.
      for (const inert of ["*", "*.sh"]) {
        const logger = createMockLogger();
        const permissions = await BobPermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions: createRulesyncPermissions({
            bash: { [inert]: "deny", ls: "allow" },
          }),
          logger,
        });

        const entry = JSON.parse(permissions.getFileContent()).approval.allowedExecutors[0];
        expect(entry.approvedCommands).toEqual([]);
        expect(entry.deniedCommands).toEqual([inert]);
        expect(
          warnings(logger).some((message) =>
            message.includes('allow entry ("ls") has been withheld'),
          ),
        ).toBe(true);
      }
    });

    it("folds the all-tools * category deny into the command lists", async () => {
      const permissions = await BobPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          bash: { "rm -rf": "allow", ls: "allow" },
          "*": { "rm *": "deny" },
        }),
        logger: createMockLogger(),
      });

      const entry = JSON.parse(permissions.getFileContent()).approval.allowedExecutors[0];
      expect(entry.approvedCommands).toEqual(["ls"]);
      expect(entry.deniedCommands).toEqual(["rm *", "rm "]);
    });

    it("writes an empty approvedCommands list and drops an empty deny list", async () => {
      await writeSettings(
        testDir,
        JSON.stringify({
          approval: {
            allowedExecutors: [
              { toolId: "execute_command", approvedCommands: ["ls"], deniedCommands: ["rm"] },
            ],
          },
        }),
      );

      const permissions = await BobPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ bash: {} }),
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual({
        approval: { allowedExecutors: [{ toolId: "execute_command", approvedCommands: [] }] },
      });
    });

    it("preserves every part of the settings file rulesync does not author", async () => {
      await writeSettings(
        testDir,
        JSON.stringify({
          locale: "ja",
          hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] },
          autoApprove: { skills: true },
          approval: {
            allowed_permissions: ["read", "execute"],
            permissionOptions: [{ groupId: "read", enableOutsideWorkspace: true }],
            allowedExecutors: [
              { toolId: "other_tool", approvedCommands: ["x"] },
              {
                toolId: "execute_command",
                approvedCommands: ["old"],
                deniedCommands: ["older"],
                extra: 1,
              },
            ],
          },
        }),
      );

      const permissions = await BobPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ bash: { "git log": "allow" } }),
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual({
        locale: "ja",
        hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] },
        autoApprove: { skills: true },
        approval: {
          allowed_permissions: ["read", "execute"],
          permissionOptions: [{ groupId: "read", enableOutsideWorkspace: true }],
          allowedExecutors: [
            { toolId: "other_tool", approvedCommands: ["x"] },
            { toolId: "execute_command", approvedCommands: ["git log"], extra: 1 },
          ],
        },
      });
    });

    it("leaves the file untouched and warns when no bash category is stated", async () => {
      const original = { approval: { allowed_permissions: ["read"] }, locale: "en" };
      await writeSettings(testDir, JSON.stringify(original));
      const logger = createMockLogger();

      const permissions = await BobPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ read: { "*": "allow" } }),
        logger,
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual(original);
      expect(warnings(logger).some((message) => message.includes("'read'"))).toBe(true);
    });

    it("warns that an all-tools deny is skipped when no bash category is stated", async () => {
      const logger = createMockLogger();
      await BobPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ "*": { "rm *": "deny" } }),
        logger,
      });

      expect(warnings(logger).some((message) => message.includes("'*' was skipped"))).toBe(true);
    });

    it("warns about allow rules in categories it cannot represent", async () => {
      const logger = createMockLogger();
      await BobPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          bash: { ls: "allow" },
          read: { "*": "allow" },
          webfetch: { "example.com": "deny" },
        }),
        logger,
      });

      const messages = warnings(logger);
      expect(
        messages.some((message) => message.includes("'read' allow rules cannot be represented")),
      ).toBe(true);
      expect(messages.some((message) => message.includes("'webfetch' deny and ask rules"))).toBe(
        true,
      );
    });

    it("writes the bob override's group switches without a bash category", async () => {
      await writeSettings(
        testDir,
        JSON.stringify({
          locale: "en",
          autoApprove: { other: false },
          approval: {
            allowed_permissions: ["execute"],
            allowedExecutors: [{ toolId: "execute_command", approvedCommands: ["ls"] }],
          },
        }),
      );

      const permissions = await BobPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissionsWithBob(
          {},
          {
            approval: {
              allowed_permissions: ["read", "todo"],
              permissionOptions: [{ groupId: "read", enableOutsideWorkspace: true }],
            },
            autoApprove: { skills: true },
          },
        ),
      });

      // The command lists stay as authored because `bash` is not stated, and
      // `autoApprove` is merged over the existing toggles.
      expect(JSON.parse(permissions.getFileContent())).toEqual({
        locale: "en",
        autoApprove: { other: false, skills: true },
        approval: {
          allowed_permissions: ["read", "todo"],
          permissionOptions: [{ groupId: "read", enableOutsideWorkspace: true }],
          allowedExecutors: [{ toolId: "execute_command", approvedCommands: ["ls"] }],
        },
      });
    });

    it("writes the group switches next to the bash command lists", async () => {
      await writeSettings(
        testDir,
        JSON.stringify({ approval: { permissionOptions: [{ groupId: "read" }] } }),
      );

      const permissions = await BobPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissionsWithBob(
          { bash: { "git log": "allow" } },
          { approval: { allowed_permissions: ["execute"] } },
        ),
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual({
        approval: {
          allowed_permissions: ["execute"],
          permissionOptions: [{ groupId: "read" }],
          allowedExecutors: [{ toolId: "execute_command", approvedCommands: ["git log"] }],
        },
      });
    });

    it("creates the settings file for an override-only config", async () => {
      const permissions = await BobPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissionsWithBob(
          {},
          { autoApprove: { skills: false } },
        ),
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual({
        autoApprove: { skills: false },
      });
    });

    it("warns about what the override newly auto-approves, but not about switches already on", async () => {
      await writeSettings(
        testDir,
        JSON.stringify({
          approval: { allowed_permissions: ["read"] },
          autoApprove: { skills: true },
        }),
      );
      const logger = createMockLogger();

      await BobPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissionsWithBob(
          {},
          {
            approval: {
              allowed_permissions: ["read", "execute"],
              permissionOptions: [{ groupId: "edit", enableOutsideWorkspace: true }],
            },
            autoApprove: { skills: true },
          },
        ),
        logger,
      });

      const message = warnings(logger).find((entry) => entry.includes("now auto-approves"));
      expect(message).toContain('the "execute" group');
      expect(message).toContain('the "edit" group outside the workspace');
      expect(message).toContain("every project on this machine");
      expect(message).not.toContain('"read"');
      expect(message).not.toContain("autoApprove.skills");
    });

    it("writes and warns about group IDs Bob does not document", async () => {
      const logger = createMockLogger();

      const permissions = await BobPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissionsWithBob(
          {},
          { approval: { allowed_permissions: ["readonly"] } },
        ),
        logger,
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual({
        approval: { allowed_permissions: ["readonly"] },
      });
      expect(warnings(logger).some((message) => message.includes('group ID(s) "readonly"'))).toBe(
        true,
      );
    });

    it("warns about undocumented toggles and enableOutsideWorkspace outside the read group", async () => {
      const logger = createMockLogger();

      await BobPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissionsWithBob(
          {},
          {
            approval: { permissionOptions: [{ groupId: "edit", enableOutsideWorkspace: true }] },
            autoApprove: { browser: false },
          },
        ),
        logger,
      });

      const message = warnings(logger).find((entry) => entry.includes("does not document"));
      expect(message).toContain(`'autoApprove' toggle(s) "browser"`);
      expect(message).toContain(`'enableOutsideWorkspace' for group(s) "edit"`);
    });

    it("strips control characters from the values it quotes in warnings", async () => {
      const logger = createMockLogger();

      await BobPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissionsWithBob(
          {},
          { approval: { allowed_permissions: ["execute", "\u001b[2K\r"] } },
        ),
        logger,
      });

      for (const message of warnings(logger)) {
        expect(message).not.toContain("\u001b");
        expect(message).not.toContain("\r");
      }
    });

    it("does not create the settings file for an empty autoApprove override", async () => {
      const permissions = await BobPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissionsWithBob({}, { autoApprove: {} }),
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual({});
    });

    it("omits the group-switch hint once the override authors allowed_permissions", async () => {
      const logger = createMockLogger();

      await BobPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissionsWithBob(
          { read: { "*": "allow" } },
          { approval: { allowed_permissions: ["read"] } },
        ),
        logger,
      });

      const message = warnings(logger).find((entry) => entry.includes("'read'"));
      expect(message).toBeDefined();
      expect(message).not.toContain("bob.approval.allowed_permissions");
    });

    it("rejects override fields the Bob schema does not model", () => {
      expect(
        () =>
          new RulesyncPermissions({
            relativeDirPath: ".rulesync",
            relativeFilePath: "permissions.json",
            fileContent: JSON.stringify({
              permission: {},
              bob: { approval: { allowedExecutors: [] } },
            }),
            validate: true,
          }),
      ).toThrow();
    });

    it("refuses to overwrite an unparseable settings file", async () => {
      await writeSettings(testDir, "{ not json");

      await expect(
        BobPermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions: createRulesyncPermissions({ bash: { ls: "allow" } }),
        }),
      ).rejects.toThrow();
    });
  });

  describe("toRulesyncPermissions", () => {
    it("imports the execute_command lists into the bash category, deny winning", async () => {
      await writeSettings(
        testDir,
        JSON.stringify({
          approval: {
            allowed_permissions: ["execute"],
            allowedExecutors: [
              {
                toolId: "execute_command",
                approvedCommands: ["git status", "rm"],
                deniedCommands: ["rm"],
              },
            ],
          },
        }),
      );

      const permissions = await BobPermissions.fromFile({ outputRoot: testDir, global: true });
      expect(permissions.toRulesyncPermissions().getJson()).toEqual({
        permission: { bash: { "git status": "allow", rm: "deny" } },
        bob: { approval: { allowed_permissions: ["execute"] } },
      });
    });

    it("lifts the group switches into the bob override", async () => {
      await writeSettings(
        testDir,
        JSON.stringify({
          autoApprove: { skills: true },
          approval: {
            allowed_permissions: ["read", "mcp"],
            permissionOptions: [{ groupId: "read", enableOutsideWorkspace: true }],
          },
        }),
      );

      const permissions = await BobPermissions.fromFile({ outputRoot: testDir, global: true });
      expect(permissions.toRulesyncPermissions().getJson()).toEqual({
        permission: {},
        bob: {
          approval: {
            allowed_permissions: ["read", "mcp"],
            permissionOptions: [{ groupId: "read", enableOutsideWorkspace: true }],
          },
          autoApprove: { skills: true },
        },
      });
    });

    it("does not lift a key holding an entry the override cannot carry", async () => {
      const settings = {
        autoApprove: { skills: true, other: "yes" },
        approval: {
          allowed_permissions: ["read", 1],
          permissionOptions: [{ groupId: "read", extra: true }],
        },
      };
      await writeSettings(testDir, JSON.stringify(settings));

      const imported = (
        await BobPermissions.fromFile({ outputRoot: testDir, global: true })
      ).toRulesyncPermissions();
      expect(imported.getJson()).toEqual({ permission: {} });

      // A generate from that import therefore leaves every malformed key as is.
      const regenerated = await BobPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: imported,
      });
      expect(JSON.parse(regenerated.getFileContent())).toEqual(settings);
    });

    it("imports an empty permission block when there is no approval block", async () => {
      const permissions = await BobPermissions.fromFile({ outputRoot: testDir, global: true });
      expect(permissions.toRulesyncPermissions().getJson()).toEqual({ permission: {} });
    });
  });
});

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
      });
    });

    it("imports an empty permission block when there is no approval block", async () => {
      const permissions = await BobPermissions.fromFile({ outputRoot: testDir, global: true });
      expect(permissions.toRulesyncPermissions().getJson()).toEqual({ permission: {} });
    });
  });
});

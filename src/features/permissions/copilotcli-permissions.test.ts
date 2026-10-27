import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CopilotcliPermissions } from "./copilotcli-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

const PROJECT_DIR = join(".github", "copilot");
const GLOBAL_DIR = ".copilot";
const SETTINGS_FILE = "settings.json";

function createRulesyncPermissions(permission: Record<string, Record<string, string>>) {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify({ permission }),
    validate: true,
  });
}

function createRulesyncPermissionsFromJson(json: Record<string, unknown>) {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify(json),
    validate: true,
  });
}

async function writeSettings({
  testDir,
  relativeDirPath,
  settings,
}: {
  testDir: string;
  relativeDirPath: string;
  settings: Record<string, unknown>;
}): Promise<void> {
  const dir = join(testDir, relativeDirPath);
  await ensureDir(dir);
  await writeFileContent(join(dir, SETTINGS_FILE), JSON.stringify(settings, null, 2));
}

describe("CopilotcliPermissions", () => {
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
    it("returns the repository settings path for project scope", () => {
      const paths = CopilotcliPermissions.getSettablePaths();
      expect(paths.relativeDirPath).toBe(PROJECT_DIR);
      expect(paths.relativeFilePath).toBe(SETTINGS_FILE);
    });

    it("returns the user settings path for global scope", () => {
      const paths = CopilotcliPermissions.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(GLOBAL_DIR);
      expect(paths.relativeFilePath).toBe(SETTINGS_FILE);
    });
  });

  describe("isDeletable", () => {
    it("is not deletable (shared settings file)", () => {
      const permissions = CopilotcliPermissions.forDeletion({
        relativeDirPath: PROJECT_DIR,
        relativeFilePath: SETTINGS_FILE,
      });
      expect(permissions.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("writes deniedUrls at project scope and omits ask patterns", async () => {
      const permissions = await CopilotcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          webfetch: {
            "https://evil.example.com/*": "deny",
            "https://internal.example.com/*": "deny",
            "https://ask.example.com/*": "ask",
          },
        }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.deniedUrls).toEqual([
        "https://evil.example.com/*",
        "https://internal.example.com/*",
      ]);
      expect(json).not.toHaveProperty("allowedUrls");
    });

    it("drops project-scope allow rules with a warning", async () => {
      const logger = createMockLogger();

      const permissions = await CopilotcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions: createRulesyncPermissions({
          webfetch: { "https://docs.example.com/*": "allow", "https://evil.example.com/*": "deny" },
        }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.deniedUrls).toEqual(["https://evil.example.com/*"]);
      expect(json).not.toHaveProperty("allowedUrls");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("allowedUrls"));
    });

    it("writes both URL lists at global scope without warning", async () => {
      const logger = createMockLogger();

      const permissions = await CopilotcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        global: true,
        logger,
        rulesyncPermissions: createRulesyncPermissions({
          webfetch: { "https://docs.example.com/*": "allow", "https://evil.example.com/*": "deny" },
        }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.allowedUrls).toEqual(["https://docs.example.com/*"]);
      expect(json.deniedUrls).toEqual(["https://evil.example.com/*"]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("preserves foreign keys owned by other features and users", async () => {
      await writeSettings({
        testDir,
        relativeDirPath: PROJECT_DIR,
        settings: {
          model: "claude-sonnet-4.5",
          effortLevel: "high",
          hooks: { sessionStart: [{ type: "command", command: "echo hi" }] },
          deniedUrls: ["https://stale.example.com/*"],
        },
      });

      const permissions = await CopilotcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          webfetch: { "https://evil.example.com/*": "deny" },
        }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.model).toBe("claude-sonnet-4.5");
      expect(json.effortLevel).toBe("high");
      expect(json.hooks).toEqual({ sessionStart: [{ type: "command", command: "echo hi" }] });
      // rulesync owns the URL lists, so the stale entry is replaced wholesale.
      expect(json.deniedUrls).toEqual(["https://evil.example.com/*"]);
    });

    it("leaves both URL keys untouched when the canonical config states no webfetch category", async () => {
      await writeSettings({
        testDir,
        relativeDirPath: GLOBAL_DIR,
        settings: {
          allowedUrls: ["https://hand-written.example.com/*"],
          deniedUrls: ["https://hand-denied.example.com/*"],
        },
      });

      const permissions = await CopilotcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        global: true,
        rulesyncPermissions: createRulesyncPermissions({ bash: { "git *": "allow" } }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.allowedUrls).toEqual(["https://hand-written.example.com/*"]);
      expect(json.deniedUrls).toEqual(["https://hand-denied.example.com/*"]);
    });

    it("retracts an owned key when the stated category yields no entry for it", async () => {
      await writeSettings({
        testDir,
        relativeDirPath: GLOBAL_DIR,
        settings: {
          allowedUrls: ["https://stale.example.com/*"],
          deniedUrls: ["https://stale-denied.example.com/*"],
        },
      });

      const permissions = await CopilotcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        global: true,
        rulesyncPermissions: createRulesyncPermissions({
          webfetch: { "https://ask.example.com/*": "ask" },
        }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json).not.toHaveProperty("allowedUrls");
      expect(json).not.toHaveProperty("deniedUrls");
    });

    it("reads a project-scope allow rule from the copilotcli tool-scoped override", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { webfetch: { "https://shared.example.com/*": "deny" } },
          copilotcli: { permission: { webfetch: { "https://cli.example.com/*": "deny" } } },
        }),
        validate: true,
      });

      const permissions = await CopilotcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions.forTarget({ toolTarget: "copilotcli" }),
      });

      const json = JSON.parse(permissions.getFileContent());
      // The tool-scoped category replaces the shared one wholesale.
      expect(json.deniedUrls).toEqual(["https://cli.example.com/*"]);
    });
  });

  describe("defaultPermissionMode override", () => {
    it.each(["manual", "assisted", "allow-all"])(
      "writes defaultPermissionMode %s at global scope and keeps unrelated keys",
      async (mode) => {
        await writeSettings({
          testDir,
          relativeDirPath: GLOBAL_DIR,
          settings: { model: "claude-sonnet-4.5", deniedUrls: ["https://keep.example.com/*"] },
        });
        const logger = createMockLogger();

        const permissions = await CopilotcliPermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          global: true,
          logger,
          rulesyncPermissions: createRulesyncPermissionsFromJson({
            permission: {},
            copilotcli: { defaultPermissionMode: mode },
          }).forTarget({ toolTarget: "copilotcli" }),
        });

        const json = JSON.parse(permissions.getFileContent());
        expect(json.defaultPermissionMode).toBe(mode);
        expect(json.model).toBe("claude-sonnet-4.5");
        // No webfetch category stated, so the URL list stays as the user left it.
        expect(json.deniedUrls).toEqual(["https://keep.example.com/*"]);
        expect(logger.warn).not.toHaveBeenCalled();
      },
    );

    it("leaves a hand-set defaultPermissionMode untouched when the override does not author it", async () => {
      await writeSettings({
        testDir,
        relativeDirPath: GLOBAL_DIR,
        settings: { defaultPermissionMode: "assisted" },
      });

      const permissions = await CopilotcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        global: true,
        rulesyncPermissions: createRulesyncPermissions({
          webfetch: { "https://evil.example.com/*": "deny" },
        }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json.defaultPermissionMode).toBe("assisted");
      expect(json.deniedUrls).toEqual(["https://evil.example.com/*"]);
    });

    it("skips defaultPermissionMode at project scope with a warning", async () => {
      const logger = createMockLogger();

      const permissions = await CopilotcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        logger,
        rulesyncPermissions: createRulesyncPermissionsFromJson({
          permission: { webfetch: { "https://evil.example.com/*": "deny" } },
          copilotcli: { defaultPermissionMode: "assisted" },
        }).forTarget({ toolTarget: "copilotcli" }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json).not.toHaveProperty("defaultPermissionMode");
      expect(json.deniedUrls).toEqual(["https://evil.example.com/*"]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("defaultPermissionMode"));
    });

    it("rejects a mode outside the Copilot CLI enum", () => {
      expect(() =>
        createRulesyncPermissionsFromJson({
          permission: {},
          // The VS Code `copilot` target's value, not a Copilot CLI mode.
          copilotcli: { defaultPermissionMode: "autopilot" },
        }),
      ).toThrow();
    });

    it("imports a user-scope defaultPermissionMode into the copilotcli override", async () => {
      await writeSettings({
        testDir,
        relativeDirPath: GLOBAL_DIR,
        settings: { defaultPermissionMode: "assisted", model: "claude-sonnet-4.5" },
      });

      const permissions = await CopilotcliPermissions.fromFile({
        outputRoot: testDir,
        global: true,
      });
      const json = JSON.parse(permissions.toRulesyncPermissions().getFileContent());

      expect(json.copilotcli).toEqual({ defaultPermissionMode: "assisted" });
      expect(json.permission).toEqual({});
    });

    it("ignores an unknown user-scope mode and a project-scope mode on import", async () => {
      await writeSettings({
        testDir,
        relativeDirPath: GLOBAL_DIR,
        settings: { defaultPermissionMode: "bogus" },
      });
      await writeSettings({
        testDir,
        relativeDirPath: PROJECT_DIR,
        settings: { defaultPermissionMode: "assisted" },
      });

      const globalJson = JSON.parse(
        (await CopilotcliPermissions.fromFile({ outputRoot: testDir, global: true }))
          .toRulesyncPermissions()
          .getFileContent(),
      );
      const projectJson = JSON.parse(
        (await CopilotcliPermissions.fromFile({ outputRoot: testDir }))
          .toRulesyncPermissions()
          .getFileContent(),
      );

      expect(globalJson).not.toHaveProperty("copilotcli");
      expect(projectJson).not.toHaveProperty("copilotcli");
    });

    it("round-trips a global-scope defaultPermissionMode", async () => {
      const generated = await CopilotcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        global: true,
        rulesyncPermissions: createRulesyncPermissionsFromJson({
          permission: { webfetch: { "https://docs.example.com/*": "allow" } },
          copilotcli: { defaultPermissionMode: "manual" },
        }).forTarget({ toolTarget: "copilotcli" }),
      });
      await writeSettings({
        testDir,
        relativeDirPath: GLOBAL_DIR,
        settings: JSON.parse(generated.getFileContent()),
      });

      const reloaded = await CopilotcliPermissions.fromFile({ outputRoot: testDir, global: true });
      const json = JSON.parse(reloaded.toRulesyncPermissions().getFileContent());

      expect(json.permission.webfetch).toEqual({ "https://docs.example.com/*": "allow" });
      expect(json.copilotcli).toEqual({ defaultPermissionMode: "manual" });
    });
  });

  describe("fromFile / toRulesyncPermissions", () => {
    it("imports deniedUrls at project scope and ignores an unread allowedUrls", async () => {
      await writeSettings({
        testDir,
        relativeDirPath: PROJECT_DIR,
        settings: {
          deniedUrls: ["https://evil.example.com/*"],
          // Not accepted at repository scope upstream, so it must not become an
          // enforced allow rule after an import.
          allowedUrls: ["https://ignored.example.com/*"],
          model: "claude-sonnet-4.5",
        },
      });

      const permissions = await CopilotcliPermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(permissions.toRulesyncPermissions().getFileContent());

      expect(json.permission.webfetch).toEqual({ "https://evil.example.com/*": "deny" });
    });

    it("imports both URL lists at global scope", async () => {
      await writeSettings({
        testDir,
        relativeDirPath: GLOBAL_DIR,
        settings: {
          allowedUrls: ["https://docs.example.com/*"],
          deniedUrls: ["https://evil.example.com/*"],
        },
      });

      const permissions = await CopilotcliPermissions.fromFile({
        outputRoot: testDir,
        global: true,
      });
      const json = JSON.parse(permissions.toRulesyncPermissions().getFileContent());

      expect(json.permission.webfetch).toEqual({
        "https://docs.example.com/*": "allow",
        "https://evil.example.com/*": "deny",
      });
    });

    it("imports a pattern present in both lists as deny", async () => {
      await writeSettings({
        testDir,
        relativeDirPath: GLOBAL_DIR,
        settings: {
          allowedUrls: ["https://both.example.com/*"],
          deniedUrls: ["https://both.example.com/*"],
        },
      });

      const permissions = await CopilotcliPermissions.fromFile({
        outputRoot: testDir,
        global: true,
      });
      const json = JSON.parse(permissions.toRulesyncPermissions().getFileContent());

      expect(json.permission.webfetch).toEqual({ "https://both.example.com/*": "deny" });
    });

    it("round-trips a global-scope config", async () => {
      const generated = await CopilotcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        global: true,
        rulesyncPermissions: createRulesyncPermissions({
          webfetch: { "https://docs.example.com/*": "allow", "https://evil.example.com/*": "deny" },
        }),
      });
      await writeSettings({
        testDir,
        relativeDirPath: GLOBAL_DIR,
        settings: JSON.parse(generated.getFileContent()),
      });

      const reloaded = await CopilotcliPermissions.fromFile({ outputRoot: testDir, global: true });
      const json = JSON.parse(reloaded.toRulesyncPermissions().getFileContent());

      expect(json.permission.webfetch).toEqual({
        "https://docs.example.com/*": "allow",
        "https://evil.example.com/*": "deny",
      });
    });

    it("round-trips a project-scope deny config", async () => {
      const generated = await CopilotcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          webfetch: { "https://evil.example.com/*": "deny" },
        }),
      });
      await writeSettings({
        testDir,
        relativeDirPath: PROJECT_DIR,
        settings: JSON.parse(generated.getFileContent()),
      });

      const reloaded = await CopilotcliPermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(reloaded.toRulesyncPermissions().getFileContent());

      expect(json.permission.webfetch).toEqual({ "https://evil.example.com/*": "deny" });
    });

    it("returns an empty permission block when no URL list is present", async () => {
      await writeSettings({
        testDir,
        relativeDirPath: PROJECT_DIR,
        settings: { model: "claude-sonnet-4.5" },
      });

      const permissions = await CopilotcliPermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(permissions.toRulesyncPermissions().getFileContent());

      expect(json.permission).toEqual({});
    });

    it("throws on a settings file that cannot be parsed", async () => {
      const dir = join(testDir, PROJECT_DIR);
      await ensureDir(dir);
      await writeFileContent(join(dir, SETTINGS_FILE), "{ not json");

      const permissions = await CopilotcliPermissions.fromFile({ outputRoot: testDir });

      expect(() => permissions.toRulesyncPermissions()).toThrow(
        /Failed to parse Copilot CLI settings/,
      );
    });
  });
});

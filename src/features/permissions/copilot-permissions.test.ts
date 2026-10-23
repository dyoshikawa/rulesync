import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CopilotPermissions } from "./copilot-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

const AUTO_APPROVE_KEY = "chat.tools.terminal.autoApprove";
const EDITS_KEY = "chat.tools.edits.autoApprove";
const URLS_KEY = "chat.tools.urls.autoApprove";
const DEFAULT_PERMISSION_MODE_KEY = "chat.permissions.default";
const SANDBOX_ENABLED_KEY = "chat.agent.sandbox.enabled";
const SANDBOX_ALLOW_NETWORK_KEY = "chat.agent.sandbox.network.allowNetwork";
const SANDBOX_USER_PATHS_KEY = "chat.agent.sandbox.fileSystem.userConfiguredPaths";

function createRulesyncPermissionsWithCopilot(copilot: Record<string, unknown>) {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify({ permission: {}, copilot }),
    validate: true,
  }).forTarget({ toolTarget: "copilot" });
}

function createRulesyncPermissions(permission: Record<string, Record<string, string>>) {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify({ permission }),
    validate: true,
  });
}

describe("CopilotPermissions", () => {
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
    it("returns the workspace .vscode/settings.json path", () => {
      const paths = CopilotPermissions.getSettablePaths();
      expect(paths.relativeDirPath).toBe(".vscode");
      expect(paths.relativeFilePath).toBe("settings.json");
    });
  });

  describe("isDeletable", () => {
    it("is not deletable (shared workspace settings file)", () => {
      const permissions = CopilotPermissions.forDeletion({
        relativeDirPath: ".vscode",
        relativeFilePath: "settings.json",
      });
      expect(permissions.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("maps bash allow onto true and deny/ask onto false in chat.tools.terminal.autoApprove", async () => {
      const rulesyncPermissions = createRulesyncPermissions({
        bash: { "git *": "allow", "rm *": "deny", "npm *": "ask" },
      });

      const permissions = await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json[AUTO_APPROVE_KEY]).toEqual({ "git *": true, "rm *": false, "npm *": false });
    });

    it("writes an ask beside a broader allow as false so the allow cannot auto-approve it", async () => {
      const rulesyncPermissions = createRulesyncPermissions({
        bash: { git: "allow", "git push": "ask" },
        edit: { "**/*": "allow", "src/**": "ask" },
        webfetch: { "*": "allow", "internal.example": "ask" },
      });

      const permissions = await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json[AUTO_APPROVE_KEY]).toEqual({ git: true, "git push": false });
      expect(json[EDITS_KEY]).toEqual({ "**/*": true, "src/**": false });
      expect(json[URLS_KEY]).toEqual({ "internal.example": false, "*": true });
    });

    it("orders false entries where VS Code lets them win: last for edits, first for urls", async () => {
      const permissions = await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          edit: { "src/**": "ask", "**/.env": "deny", "**/*": "allow" },
          webfetch: { "*": "allow", "https://internal.example.com/*": "ask" },
        }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(Object.entries(json[EDITS_KEY])).toEqual([
        ["**/*", true],
        ["src/**", false],
        ["**/.env", false],
      ]);
      expect(Object.entries(json[URLS_KEY])).toEqual([
        ["https://internal.example.com/*", false],
        ["*", true],
      ]);
    });

    it("maps bash, edit and webfetch and ignores categories VS Code cannot express", async () => {
      const rulesyncPermissions = createRulesyncPermissions({
        bash: { "git *": "allow" },
        edit: { "src/**": "allow", "**/.env": "deny" },
        webfetch: { "https://*.example.com/*": "allow" },
        read: { ".env": "deny" },
        write: { "dist/**": "allow" },
      });

      const permissions = await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json[AUTO_APPROVE_KEY]).toEqual({ "git *": true });
      expect(json[EDITS_KEY]).toEqual({ "src/**": true, "**/.env": false });
      expect(json[URLS_KEY]).toEqual({ "https://*.example.com/*": true });
      // `read` has no approval surface, and `write` is deliberately not folded
      // into the edits map so it stays distinguishable from `edit` on import.
      expect(Object.keys(json)).toEqual([AUTO_APPROVE_KEY, EDITS_KEY, URLS_KEY]);
    });

    it("leaves a hand-written map alone when its canonical category is absent", async () => {
      await writeFileContent(
        join(testDir, ".vscode", "settings.json"),
        JSON.stringify({
          "editor.tabSize": 2,
          [EDITS_KEY]: { "**/.env": false, "src/**": true },
          [URLS_KEY]: { "https://x.example": { approveRequest: true } },
        }),
      );

      // The canonical config states `bash` only, so adopting rulesync must not
      // disturb the edits/urls maps the user wrote by hand.
      const permissions = await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ bash: { "git *": "allow" } }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json[EDITS_KEY]).toEqual({ "**/.env": false, "src/**": true });
      expect(json[URLS_KEY]).toEqual({ "https://x.example": { approveRequest: true } });
      expect(json[AUTO_APPROVE_KEY]).toEqual({ "git *": true });
      expect(json["editor.tabSize"]).toBe(2);
    });

    it("still retracts a key whose category is stated but yields nothing", async () => {
      await writeFileContent(
        join(testDir, ".vscode", "settings.json"),
        JSON.stringify({ [EDITS_KEY]: { "src/**": true } }),
      );

      const permissions = await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ edit: {} }),
      });

      expect(JSON.parse(permissions.getFileContent())).not.toHaveProperty(EDITS_KEY);
    });

    it("replaces a hand-written true with false for a stated ask", async () => {
      await writeFileContent(
        join(testDir, ".vscode", "settings.json"),
        JSON.stringify({ [EDITS_KEY]: { "src/**": true } }),
      );

      const permissions = await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ edit: { "src/**": "ask" } }),
      });

      expect(JSON.parse(permissions.getFileContent())[EDITS_KEY]).toEqual({ "src/**": false });
    });

    it("imports all three maps back into their canonical categories", () => {
      const permissions = new CopilotPermissions({
        outputRoot: testDir,
        relativeDirPath: ".vscode",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          "editor.tabSize": 2,
          [AUTO_APPROVE_KEY]: { "git *": true },
          [EDITS_KEY]: { "src/**": true, "**/.env": false },
          // The object form has no canonical action, so it is skipped.
          [URLS_KEY]: { "https://ok.example": true, "https://x.example": { approveRequest: true } },
        }),
      });

      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.permission.bash).toEqual({ "git *": "allow" });
      expect(json.permission.edit).toEqual({ "src/**": "allow", "**/.env": "deny" });
      expect(json.permission.webfetch).toEqual({ "https://ok.example": "allow" });
    });

    it("preserves unrelated VS Code settings when merging", async () => {
      await writeFileContent(
        join(testDir, ".vscode", "settings.json"),
        JSON.stringify({
          "editor.tabSize": 2,
          "chat.tools.terminal.autoApprove": { "old *": true },
        }),
      );

      const rulesyncPermissions = createRulesyncPermissions({
        bash: { "git *": "allow" },
      });

      const permissions = await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json["editor.tabSize"]).toBe(2);
      // The managed key is replaced wholesale (not merged into the old value).
      expect(json[AUTO_APPROVE_KEY]).toEqual({ "git *": true });
    });

    it("omits the managed key entirely when the stated category has no rules", async () => {
      await writeFileContent(
        join(testDir, ".vscode", "settings.json"),
        JSON.stringify({ "editor.tabSize": 2 }),
      );

      const rulesyncPermissions = createRulesyncPermissions({
        bash: {},
      });

      const permissions = await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json).not.toHaveProperty(AUTO_APPROVE_KEY);
      expect(json["editor.tabSize"]).toBe(2);
    });

    it("consumes the copilot tool-scoped permission override", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "git *": "allow" } },
          copilot: { permission: { bash: { "rm *": "deny" } } },
        }),
        validate: true,
      });

      const permissions = await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions.forTarget({ toolTarget: "copilot" }),
      });

      const json = JSON.parse(permissions.getFileContent());
      // The tool-scoped `bash` category replaces the shared one wholesale.
      expect(json[AUTO_APPROVE_KEY]).toEqual({ "rm *": false });
    });

    it("writes copilot.defaultPermissionMode to chat.permissions.default", async () => {
      await writeFileContent(
        join(testDir, ".vscode", "settings.json"),
        JSON.stringify({ "editor.tabSize": 2, [DEFAULT_PERMISSION_MODE_KEY]: "default" }),
      );
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "git *": "allow" } },
          copilot: { defaultPermissionMode: "autopilot" },
        }),
        validate: true,
      });

      const permissions = await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions.forTarget({ toolTarget: "copilot" }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json[DEFAULT_PERMISSION_MODE_KEY]).toBe("autopilot");
      expect(json[AUTO_APPROVE_KEY]).toEqual({ "git *": true });
      expect(json["editor.tabSize"]).toBe(2);
    });

    it("leaves a hand-written chat.permissions.default alone without the override", async () => {
      await writeFileContent(
        join(testDir, ".vscode", "settings.json"),
        JSON.stringify({ [DEFAULT_PERMISSION_MODE_KEY]: "autoApprove" }),
      );

      const permissions = await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ bash: { "git *": "allow" } }),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json[DEFAULT_PERMISSION_MODE_KEY]).toBe("autoApprove");
    });

    it("rejects a defaultPermissionMode value VS Code does not accept", () => {
      expect(
        () =>
          new RulesyncPermissions({
            relativeDirPath: ".rulesync",
            relativeFilePath: "permissions.json",
            fileContent: JSON.stringify({
              permission: {},
              copilot: { defaultPermissionMode: "yolo" },
            }),
            validate: true,
          }),
      ).toThrow();
    });

    it("writes copilot.sandbox leaves to the flat chat.agent.sandbox.* settings", async () => {
      const logger = createMockLogger();
      const permissions = await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissionsWithCopilot({
          sandbox: {
            enabled: "on",
            network: { allowNetwork: false },
            mcpServers: true,
            credentials: { authenticategh: false },
            fileSystem: { userConfiguredPaths: { deniedPaths: ["/secrets"] } },
          },
        }),
        logger,
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json).toEqual({
        [SANDBOX_ENABLED_KEY]: "on",
        [SANDBOX_ALLOW_NETWORK_KEY]: false,
        "chat.agent.sandbox.mcpServers": true,
        "chat.agent.sandbox.credentials.authenticategh": false,
        [SANDBOX_USER_PATHS_KEY]: { deniedPaths: ["/secrets"] },
      });
      // Every value written here tightens the sandbox, so nothing is reported.
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("leaves sandbox keys the override does not state as the file has them", async () => {
      await writeFileContent(
        join(testDir, ".vscode", "settings.json"),
        JSON.stringify({
          [SANDBOX_ENABLED_KEY]: "on",
          [SANDBOX_USER_PATHS_KEY]: { deniedPaths: ["/secrets"], readonlyPaths: ["/old"] },
        }),
      );

      const permissions = await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissionsWithCopilot({
          sandbox: {
            network: { allowNetwork: false },
            fileSystem: { userConfiguredPaths: { readonlyPaths: ["/shared"] } },
          },
        }),
        logger: createMockLogger(),
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json[SANDBOX_ENABLED_KEY]).toBe("on");
      expect(json[SANDBOX_ALLOW_NETWORK_KEY]).toBe(false);
      // The paths object merges per list: a hand-written deniedPaths survives.
      expect(json[SANDBOX_USER_PATHS_KEY]).toEqual({
        deniedPaths: ["/secrets"],
        readonlyPaths: ["/shared"],
      });
    });

    it("leaves every sandbox key alone without the override", async () => {
      await writeFileContent(
        join(testDir, ".vscode", "settings.json"),
        JSON.stringify({ [SANDBOX_ENABLED_KEY]: "on" }),
      );

      const permissions = await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ bash: { "git *": "allow" } }),
      });

      expect(JSON.parse(permissions.getFileContent())[SANDBOX_ENABLED_KEY]).toBe("on");
    });

    it("warns once about every sandbox value that loosens the sandbox", async () => {
      const logger = createMockLogger();
      await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissionsWithCopilot({
          sandbox: {
            enabled: "off",
            network: { allowLocalNetwork: true },
            lspServers: false,
            fileSystem: { userConfiguredPaths: { readwritePaths: ["/build"] } },
          },
        }),
        logger,
      });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      const message = String(vi.mocked(logger.warn).mock.calls[0]?.[0]);
      expect(message).toContain("'sandbox.enabled'");
      expect(message).toContain("'sandbox.network.allowLocalNetwork'");
      expect(message).toContain("'sandbox.lspServers'");
      expect(message).toContain("'sandbox.fileSystem.userConfiguredPaths.readwritePaths'");
    });

    it("rejects a sandbox key VS Code does not register", () => {
      expect(() =>
        createRulesyncPermissionsWithCopilot({ sandbox: { allowNetwork: true } }),
      ).toThrow();
    });
  });

  describe("toRulesyncPermissions", () => {
    it("maps true/false back to allow/deny under the bash category", () => {
      const permissions = new CopilotPermissions({
        relativeDirPath: ".vscode",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          "editor.tabSize": 2,
          [AUTO_APPROVE_KEY]: { "git *": true, "rm *": false },
        }),
        validate: false,
      });

      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.permission.bash).toEqual({ "git *": "allow", "rm *": "deny" });
    });

    it("tolerates JSONC (comments) in the settings file", () => {
      const permissions = new CopilotPermissions({
        relativeDirPath: ".vscode",
        relativeFilePath: "settings.json",
        fileContent: `{
  // workspace terminal auto-approvals
  "${AUTO_APPROVE_KEY}": { "git *": true }
}`,
        validate: false,
      });

      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.permission.bash).toEqual({ "git *": "allow" });
    });

    it("yields an empty permission block when the key is absent", () => {
      const permissions = new CopilotPermissions({
        relativeDirPath: ".vscode",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ "editor.tabSize": 2 }),
        validate: false,
      });

      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.permission).toEqual({});
    });

    it("imports chat.permissions.default as copilot.defaultPermissionMode", () => {
      const permissions = new CopilotPermissions({
        relativeDirPath: ".vscode",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ [DEFAULT_PERMISSION_MODE_KEY]: "autoApprove" }),
        validate: false,
      });

      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.copilot).toEqual({ defaultPermissionMode: "autoApprove" });
    });

    it("skips a chat.permissions.default value it does not recognize", () => {
      const permissions = new CopilotPermissions({
        relativeDirPath: ".vscode",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ [DEFAULT_PERMISSION_MODE_KEY]: "assisted" }),
        validate: false,
      });

      const json = permissions.toRulesyncPermissions().getJson();
      expect(json).not.toHaveProperty("copilot");
    });

    it("imports chat.agent.sandbox.* settings as a nested copilot.sandbox", () => {
      const permissions = new CopilotPermissions({
        relativeDirPath: ".vscode",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          [SANDBOX_ENABLED_KEY]: "on",
          [SANDBOX_ALLOW_NETWORK_KEY]: false,
          "chat.agent.sandbox.fileSystem.allowDevToolAccess": false,
          [SANDBOX_USER_PATHS_KEY]: { deniedPaths: ["/secrets"] },
          // Deprecated 1.138 shape: not modeled, so not imported.
          "chat.agent.sandbox.allowNetwork": true,
        }),
        validate: false,
      });

      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.copilot).toEqual({
        sandbox: {
          enabled: "on",
          network: { allowNetwork: false },
          fileSystem: {
            allowDevToolAccess: false,
            userConfiguredPaths: { deniedPaths: ["/secrets"] },
          },
        },
      });
    });

    it.each([
      { value: true, expected: "on" },
      { value: false, expected: "off" },
    ])(
      "imports the legacy boolean chat.agent.sandbox.enabled $value as $expected",
      ({ value, expected }) => {
        const permissions = new CopilotPermissions({
          relativeDirPath: ".vscode",
          relativeFilePath: "settings.json",
          fileContent: JSON.stringify({ [SANDBOX_ENABLED_KEY]: value }),
          validate: false,
        });

        const json = permissions.toRulesyncPermissions().getJson();
        expect(json.copilot).toEqual({ sandbox: { enabled: expected } });
      },
    );

    it("skips a sandbox value whose shape VS Code would reject", () => {
      const permissions = new CopilotPermissions({
        relativeDirPath: ".vscode",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          [SANDBOX_ENABLED_KEY]: "allowNetwork",
          [SANDBOX_ALLOW_NETWORK_KEY]: "yes",
        }),
        validate: false,
      });

      const json = permissions.toRulesyncPermissions().getJson();
      expect(json).not.toHaveProperty("copilot");
    });
  });

  describe("round-trip", () => {
    it("preserves allow/deny bash rules through generate then import", async () => {
      const rulesyncPermissions = createRulesyncPermissions({
        bash: { "git *": "allow", "rm *": "deny" },
      });

      const generated = await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const reimported = new CopilotPermissions({
        relativeDirPath: ".vscode",
        relativeFilePath: "settings.json",
        fileContent: generated.getFileContent(),
        validate: false,
      });

      const json = reimported.toRulesyncPermissions().getJson();
      expect(json.permission.bash).toEqual({ "git *": "allow", "rm *": "deny" });
    });

    it("preserves copilot.defaultPermissionMode through generate then import", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: {},
          copilot: { defaultPermissionMode: "autopilot" },
        }),
        validate: true,
      });

      const generated = await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions.forTarget({ toolTarget: "copilot" }),
      });
      const reimported = new CopilotPermissions({
        relativeDirPath: ".vscode",
        relativeFilePath: "settings.json",
        fileContent: generated.getFileContent(),
        validate: false,
      });

      const json = reimported.toRulesyncPermissions().getJson();
      expect(json.copilot).toEqual({ defaultPermissionMode: "autopilot" });
    });

    it("preserves copilot.sandbox through generate then import", async () => {
      const sandbox = {
        enabled: "on",
        network: { allowNetwork: false, allowLocalNetwork: false },
        credentials: { authenticategit: false },
        fileSystem: { userConfiguredPaths: { readonlyPaths: ["/shared"], deniedPaths: ["/x"] } },
      };
      const generated = await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissionsWithCopilot({ sandbox }),
        logger: createMockLogger(),
      });
      const reimported = new CopilotPermissions({
        relativeDirPath: ".vscode",
        relativeFilePath: "settings.json",
        fileContent: generated.getFileContent(),
        validate: false,
      });

      expect(reimported.toRulesyncPermissions().getJson().copilot).toEqual({ sandbox });
    });
  });
});

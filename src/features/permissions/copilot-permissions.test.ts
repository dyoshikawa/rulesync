import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CopilotPermissions } from "./copilot-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

const AUTO_APPROVE_KEY = "chat.tools.terminal.autoApprove";

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
    it("maps bash allow/deny onto chat.tools.terminal.autoApprove and omits ask", async () => {
      const rulesyncPermissions = createRulesyncPermissions({
        bash: { "git *": "allow", "rm *": "deny", "npm *": "ask" },
      });

      const permissions = await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json[AUTO_APPROVE_KEY]).toEqual({ "git *": true, "rm *": false });
      // `ask` is represented by omitting the entry.
      expect(json[AUTO_APPROVE_KEY]).not.toHaveProperty("npm *");
    });

    it("maps only the bash category and ignores non-terminal categories", async () => {
      const rulesyncPermissions = createRulesyncPermissions({
        bash: { "git *": "allow" },
        read: { ".env": "deny" },
        edit: { "src/**": "allow" },
      });

      const permissions = await CopilotPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(permissions.getFileContent());
      expect(json[AUTO_APPROVE_KEY]).toEqual({ "git *": true });
      // read/edit have no terminal-command representation and are not emitted.
      expect(Object.keys(json)).toEqual([AUTO_APPROVE_KEY]);
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

    it("omits the managed key entirely when there is nothing to auto-approve", async () => {
      await writeFileContent(
        join(testDir, ".vscode", "settings.json"),
        JSON.stringify({ "editor.tabSize": 2 }),
      );

      // Only `ask` rules — nothing to allow or deny.
      const rulesyncPermissions = createRulesyncPermissions({
        bash: { "git *": "ask" },
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
  });
});

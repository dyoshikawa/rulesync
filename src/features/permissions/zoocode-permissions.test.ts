import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import { ZoocodePermissions } from "./zoocode-permissions.js";

const ALLOWED_KEY = "zoo-code.allowedCommands";
const DENIED_KEY = "zoo-code.deniedCommands";

function createRulesyncPermissions(permission: Record<string, Record<string, string>>) {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify({ permission }),
    validate: true,
  });
}

async function writeSettings(testDir: string, settings: Record<string, unknown>): Promise<void> {
  await ensureDir(join(testDir, ".vscode"));
  await writeFileContent(join(testDir, ".vscode", "settings.json"), JSON.stringify(settings));
}

describe("ZoocodePermissions", () => {
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
      const paths = ZoocodePermissions.getSettablePaths();
      expect(paths.relativeDirPath).toBe(".vscode");
      expect(paths.relativeFilePath).toBe("settings.json");
    });
  });

  describe("isDeletable", () => {
    it("is not deletable (shared workspace settings file)", () => {
      const permissions = ZoocodePermissions.forDeletion({
        relativeDirPath: ".vscode",
        relativeFilePath: "settings.json",
      });
      expect(permissions.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("splits bash allow/deny into the two command lists and omits ask", async () => {
      const permissions = await ZoocodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          bash: { "git ": "allow", "rm -rf": "deny", "npm ": "ask" },
        }),
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual({
        [ALLOWED_KEY]: ["git "],
        [DENIED_KEY]: ["rm -rf"],
      });
    });

    it("retracts a list that would be empty rather than writing []", async () => {
      await writeSettings(testDir, { [ALLOWED_KEY]: ["git "], [DENIED_KEY]: ["rm -rf"] });

      const permissions = await ZoocodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ bash: { "npm ": "ask" } }),
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual({});
    });

    it("preserves unrelated editor settings and the Copilot keys sharing the file", async () => {
      await writeSettings(testDir, {
        "editor.tabSize": 2,
        "chat.tools.terminal.autoApprove": { "git status": true },
      });

      const permissions = await ZoocodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ bash: { "git ": "allow" } }),
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual({
        "editor.tabSize": 2,
        "chat.tools.terminal.autoApprove": { "git status": true },
        [ALLOWED_KEY]: ["git "],
      });
    });

    it("leaves hand-authored command lists untouched when no bash category is stated", async () => {
      await writeSettings(testDir, { [ALLOWED_KEY]: ["git "], "editor.tabSize": 2 });

      const permissions = await ZoocodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ read: { "src/**": "allow" } }),
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual({
        [ALLOWED_KEY]: ["git "],
        "editor.tabSize": 2,
      });
    });
  });

  describe("toRulesyncPermissions", () => {
    it("imports both lists into the bash category", async () => {
      await writeSettings(testDir, {
        "editor.tabSize": 2,
        [ALLOWED_KEY]: ["git ", "npm run "],
        [DENIED_KEY]: ["rm -rf"],
      });

      const permissions = await ZoocodePermissions.fromFile({ outputRoot: testDir });

      expect(JSON.parse(permissions.toRulesyncPermissions().getFileContent())).toEqual({
        permission: {
          bash: { "git ": "allow", "npm run ": "allow", "rm -rf": "deny" },
        },
      });
    });

    it("imports a pattern present in both lists as deny", async () => {
      await writeSettings(testDir, {
        [ALLOWED_KEY]: ["git "],
        [DENIED_KEY]: ["git "],
      });

      const permissions = await ZoocodePermissions.fromFile({ outputRoot: testDir });

      expect(JSON.parse(permissions.toRulesyncPermissions().getFileContent())).toEqual({
        permission: { bash: { "git ": "deny" } },
      });
    });

    it("ignores non-string entries and a missing file", async () => {
      await writeSettings(testDir, { [ALLOWED_KEY]: ["git ", 42, null] });

      const permissions = await ZoocodePermissions.fromFile({ outputRoot: testDir });

      expect(JSON.parse(permissions.toRulesyncPermissions().getFileContent())).toEqual({
        permission: { bash: { "git ": "allow" } },
      });

      const empty = await ZoocodePermissions.fromFile({ outputRoot: join(testDir, "absent") });
      expect(JSON.parse(empty.toRulesyncPermissions().getFileContent())).toEqual({
        permission: {},
      });
    });

    it("fails closed on a settings file it cannot parse", async () => {
      await ensureDir(join(testDir, ".vscode"));
      await writeFileContent(join(testDir, ".vscode", "settings.json"), "{ not json");

      const permissions = await ZoocodePermissions.fromFile({ outputRoot: testDir });

      expect(() => permissions.toRulesyncPermissions()).toThrow(
        /Failed to parse Zoo Code VS Code settings/,
      );
    });
  });

  describe("round trip", () => {
    it("reproduces the generated lists on import", async () => {
      const generated = await ZoocodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          bash: { "git ": "allow", "rm -rf": "deny" },
        }),
      });
      await writeSettings(testDir, JSON.parse(generated.getFileContent()));

      const reimported = await ZoocodePermissions.fromFile({ outputRoot: testDir });

      expect(JSON.parse(reimported.toRulesyncPermissions().getFileContent())).toEqual({
        permission: { bash: { "git ": "allow", "rm -rf": "deny" } },
      });
    });
  });
});

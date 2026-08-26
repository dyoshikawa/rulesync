import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RooPermissions } from "./roo-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

const ALLOWED_KEY = "roo-cline.allowedCommands";
const DENIED_KEY = "roo-cline.deniedCommands";

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

describe("RooPermissions", () => {
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
      const paths = RooPermissions.getSettablePaths();
      expect(paths.relativeDirPath).toBe(".vscode");
      expect(paths.relativeFilePath).toBe("settings.json");
    });
  });

  describe("isDeletable", () => {
    it("is not deletable (shared workspace settings file)", () => {
      const permissions = RooPermissions.forDeletion({
        relativeDirPath: ".vscode",
        relativeFilePath: "settings.json",
      });
      expect(permissions.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("splits bash allow/deny into the two command lists and omits ask", async () => {
      const permissions = await RooPermissions.fromRulesyncPermissions({
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

      const permissions = await RooPermissions.fromRulesyncPermissions({
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

      const permissions = await RooPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ bash: { "git ": "allow" } }),
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual({
        "editor.tabSize": 2,
        "chat.tools.terminal.autoApprove": { "git status": true },
        [ALLOWED_KEY]: ["git "],
      });
    });

    // The two lineages spell the same setting differently and both adapters
    // write `.vscode/settings.json`, so a project that enables both targets ends
    // up with all four keys. Neither adapter may treat the other's pair as
    // stale rulesync output.
    it("leaves the Zoo Code lineage's own command keys alone", async () => {
      await writeSettings(testDir, {
        "zoo-code.allowedCommands": ["npm run "],
        "zoo-code.deniedCommands": ["curl "],
      });

      const permissions = await RooPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          bash: { "git ": "allow", "rm -rf": "deny" },
        }),
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual({
        "zoo-code.allowedCommands": ["npm run "],
        "zoo-code.deniedCommands": ["curl "],
        [ALLOWED_KEY]: ["git "],
        [DENIED_KEY]: ["rm -rf"],
      });
    });

    it("leaves hand-authored command lists untouched when no bash category is stated", async () => {
      await writeSettings(testDir, { [ALLOWED_KEY]: ["git "], "editor.tabSize": 2 });

      const permissions = await RooPermissions.fromRulesyncPermissions({
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
    it("imports both lists into the bash category, ignoring the Zoo Code keys", async () => {
      await writeSettings(testDir, {
        "editor.tabSize": 2,
        "zoo-code.allowedCommands": ["curl "],
        [ALLOWED_KEY]: ["git ", "npm run "],
        [DENIED_KEY]: ["rm -rf"],
      });

      const permissions = await RooPermissions.fromFile({ outputRoot: testDir });

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

      const permissions = await RooPermissions.fromFile({ outputRoot: testDir });

      expect(JSON.parse(permissions.toRulesyncPermissions().getFileContent())).toEqual({
        permission: { bash: { "git ": "deny" } },
      });
    });

    it("ignores non-string entries and a missing file", async () => {
      await writeSettings(testDir, { [ALLOWED_KEY]: ["git ", 42, null] });

      const permissions = await RooPermissions.fromFile({ outputRoot: testDir });

      expect(JSON.parse(permissions.toRulesyncPermissions().getFileContent())).toEqual({
        permission: { bash: { "git ": "allow" } },
      });

      const empty = await RooPermissions.fromFile({ outputRoot: join(testDir, "absent") });
      expect(JSON.parse(empty.toRulesyncPermissions().getFileContent())).toEqual({
        permission: {},
      });
    });

    it("fails closed on a settings file it cannot parse", async () => {
      await ensureDir(join(testDir, ".vscode"));
      await writeFileContent(join(testDir, ".vscode", "settings.json"), "{ not json");

      const permissions = await RooPermissions.fromFile({ outputRoot: testDir });

      expect(() => permissions.toRulesyncPermissions()).toThrow(
        /Failed to parse Roo Code VS Code settings/,
      );
    });
  });

  describe("round trip", () => {
    it("reproduces the generated lists on import", async () => {
      const generated = await RooPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          bash: { "git ": "allow", "rm -rf": "deny" },
        }),
      });
      await writeSettings(testDir, JSON.parse(generated.getFileContent()));

      const reimported = await RooPermissions.fromFile({ outputRoot: testDir });

      expect(JSON.parse(reimported.toRulesyncPermissions().getFileContent())).toEqual({
        permission: { bash: { "git ": "allow", "rm -rf": "deny" } },
      });
    });
  });
});

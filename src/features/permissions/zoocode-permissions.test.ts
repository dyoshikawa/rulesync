import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import { ZoocodePermissions } from "./zoocode-permissions.js";

const ALLOWED_KEY = "zoo-code.allowedCommands";
const DENIED_KEY = "zoo-code.deniedCommands";
const ROO_ALLOWED_KEY = "roo-cline.allowedCommands";
const ROO_DENIED_KEY = "roo-cline.deniedCommands";

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

/**
 * `ZoocodePermissions` extends `RooPermissions` and changes nothing but the two
 * setting keys and the tool label, because the fork changed nothing else. The
 * shared behavior — prefix semantics, empty-list writes, glob warnings, JSONC
 * merging, fail-closed parsing — is covered once in `roo-permissions.test.ts`;
 * what is asserted here is the part that must NOT be inherited: the namespace.
 */
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
    it("writes the zoo-code keys, not the archived lineage's roo-cline pair", async () => {
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

    // The mirror of the roo adapter's case. `ownedKeys` for
    // `.vscode/settings.json` is the union of every target's permissions keys,
    // and the gateway's guard is per-file-per-feature rather than per-target,
    // so nothing but this assertion stops one lineage from clobbering the
    // other's lists in a project that enables both.
    it("leaves the Roo lineage's own command keys alone", async () => {
      await writeSettings(testDir, {
        [ROO_ALLOWED_KEY]: ["npm run "],
        [ROO_DENIED_KEY]: ["curl "],
      });

      const permissions = await ZoocodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          bash: { "git ": "allow", "rm -rf": "deny" },
        }),
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual({
        [ROO_ALLOWED_KEY]: ["npm run "],
        [ROO_DENIED_KEY]: ["curl "],
        [ALLOWED_KEY]: ["git "],
        [DENIED_KEY]: ["rm -rf"],
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
    it("imports the zoo-code keys and ignores the roo-cline pair", async () => {
      await writeSettings(testDir, {
        "editor.tabSize": 2,
        [ROO_ALLOWED_KEY]: ["curl "],
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

    it("names Zoo Code, not Roo Code, when the settings file cannot be parsed", async () => {
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

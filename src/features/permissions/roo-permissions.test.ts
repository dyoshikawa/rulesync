import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
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

    // The two empty lists are treated differently because their contributed
    // defaults are. Retracting the allow key would not be a no-op: Roo Code
    // reads the *effective* configuration value, and `roo-cline.allowedCommands`
    // is contributed with the default ["git log", "git diff", "git show"], so an
    // absent key re-grants those three auto-approvals. Writing `[]` for the deny
    // key would not be a no-op either: VS Code resolves array settings by scope
    // precedence rather than by merging, so it would erase a deny list the user
    // hand-authored in their user-scope settings.json.
    it("writes an empty allow list but retracts an empty deny list", async () => {
      await writeSettings(testDir, { [ALLOWED_KEY]: ["git "], [DENIED_KEY]: ["rm -rf"] });

      const permissions = await RooPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ bash: { "npm ": "ask" } }),
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual({
        [ALLOWED_KEY]: [],
      });
    });

    // `[]` is what cancels the contributed allow defaults, so it is a payload
    // worth materializing even though every managed value looks empty. Without
    // the override the shared "don't conjure a shared config file" rule would
    // skip creation and make the outcome depend on whether the workspace
    // happened to already have a .vscode/settings.json.
    it("still creates the settings file when the stated category grants nothing", async () => {
      const permissions = await RooPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ bash: { "npm ": "ask" } }),
      });

      expect(permissions.shouldSkipCreationWhenPayloadEmpty()).toBe(false);
      expect(JSON.parse(permissions.getFileContent())).toEqual({ [ALLOWED_KEY]: [] });
    });

    it("does not conjure a settings file when no bash category is stated", async () => {
      const permissions = await RooPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ read: { "src/**": "allow" } }),
      });

      expect(permissions.shouldSkipCreationWhenPayloadEmpty()).toBe(true);
      expect(JSON.parse(permissions.getFileContent())).toEqual({});
    });

    // Without the empty allow list, Roo Code's contributed default would make
    // `git log` auto-approve despite the explicit `git ` deny, because the
    // default entry "git log" is a longer prefix match than "git ".
    it("does not let the contributed git defaults survive a deny-only category", async () => {
      const permissions = await RooPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ bash: { "git ": "deny" } }),
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual({
        [ALLOWED_KEY]: [],
        [DENIED_KEY]: ["git "],
      });
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

    // The canonical `bash` category is glob-shaped for most targets
    // (claudecode writes `Bash(rm -rf *)`), but Roo Code compares entries with
    // `startsWith` and only treats a bare "*" as a wildcard. Left verbatim,
    // `rm -rf *` would not match `rm -rf /` while the bare `*` allow still
    // would, so the file would auto-approve the very command it names.
    it("rewrites a glob-shaped deny to the literal prefix it pins down", async () => {
      const logger = createMockLogger();

      const permissions = await RooPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          bash: { "*": "allow", "rm -rf *": "deny", "/^curl /": "deny" },
        }),
        logger,
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual({
        [ALLOWED_KEY]: ["*"],
        [DENIED_KEY]: ["rm -rf ", "curl "],
      });
      const warning = logger.warn.mock.calls.map(([message]) => String(message)).join("\n");
      expect(warning).toContain("Roo Code");
      expect(warning).toContain('"rm -rf *" → "rm -rf "');
      expect(warning).toContain('"/^curl /" → "curl "');
    });

    // Truncating this one would leave the empty prefix, which `startsWith`
    // matches for every command — a deny-everything setting the author never
    // asked for. It is kept verbatim and reported as unmatchable instead.
    it("keeps a deny that pins down no prefix and says it cannot match", async () => {
      const logger = createMockLogger();

      const permissions = await RooPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({ bash: { "*.sh": "deny" } }),
        logger,
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual({
        [ALLOWED_KEY]: [],
        [DENIED_KEY]: ["*.sh"],
      });
      const warning = String(logger.warn.mock.calls[0]?.[0]);
      expect(warning).toContain('deny pattern "*.sh"');
      expect(warning).toContain("will never");
    });

    // Narrowing an allow is the safe direction, so this one is passed through:
    // the commands it fails to match reach the approval prompt.
    it("warns about a glob-shaped allow without rewriting it or flagging a bare wildcard", async () => {
      const logger = createMockLogger();

      const permissions = await RooPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          bash: { "*": "allow", "npm run test:*": "allow" },
        }),
        logger,
      });

      expect(JSON.parse(permissions.getFileContent())).toEqual({
        [ALLOWED_KEY]: ["*", "npm run test:*"],
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const warning = String(logger.warn.mock.calls[0]?.[0]);
      expect(warning).toContain('allow pattern "npm run test:*"');
      expect(warning).not.toContain('"*",');
    });

    it("does not warn about literal prefixes", async () => {
      const logger = createMockLogger();

      await RooPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions({
          bash: { "git ": "allow", "*": "allow", "rm -rf ": "deny" },
        }),
        logger,
      });

      expect(logger.warn).not.toHaveBeenCalled();
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

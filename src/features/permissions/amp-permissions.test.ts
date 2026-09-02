import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { AmpPermissions } from "./amp-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

const makeRulesyncPermissions = (testDir: string, permission: unknown): RulesyncPermissions =>
  new RulesyncPermissions({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
    fileContent: JSON.stringify({ permission }),
  });

const makeRulesyncPermissionsJson = (testDir: string, json: unknown): RulesyncPermissions =>
  new RulesyncPermissions({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
    fileContent: JSON.stringify(json),
  });

describe("AmpPermissions", () => {
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
    it("resolves project and global settings.json paths", () => {
      expect(AmpPermissions.getSettablePaths()).toEqual({
        relativeDirPath: ".amp",
        relativeFilePath: "settings.json",
      });
      expect(AmpPermissions.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".config", "amp"),
        relativeFilePath: "settings.json",
      });
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("keeps whole-tool deny in amp.tools.disable and emits allow/ask as amp.permissions", async () => {
      const rulesyncPermissions = makeRulesyncPermissions(testDir, {
        edit_file: { "*": "deny" },
        read_file: { "*": "allow" },
        web: { "*": "ask" },
      });

      const instance = await AmpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });
      const json = JSON.parse(instance.getFileContent());

      // Whole-tool deny stays on the legacy disable surface.
      expect(json["amp.tools.disable"]).toEqual(["edit_file"]);
      // allow/ask are no longer dropped: they become amp.permissions entries.
      // Ordering is globally fail-closed (ask before allow).
      expect(json["amp.permissions"]).toEqual([
        { tool: "web", action: "ask" },
        { tool: "read_file", action: "allow" },
      ]);
    });

    it("emits an argument-specific deny as a reject entry with matches.cmd", async () => {
      const rulesyncPermissions = makeRulesyncPermissions(testDir, {
        bash: { "*": "deny", "git *": "deny" },
      });

      const instance = await AmpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });
      const json = JSON.parse(instance.getFileContent());

      // The whole-tool deny stays in disable; the argument-specific deny becomes reject.
      expect(json["amp.tools.disable"]).toEqual(["bash"]);
      expect(json["amp.permissions"]).toEqual([
        { tool: "bash", action: "reject", matches: { cmd: "git *" } },
      ]);
    });

    it("orders amp.permissions specific-before-catch-all and reject<ask<allow per tool", async () => {
      const rulesyncPermissions = makeRulesyncPermissions(testDir, {
        bash: {
          "*": "allow",
          "rm *": "deny",
          "sudo *": "ask",
          "git *": "allow",
        },
      });

      const instance = await AmpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });
      const json = JSON.parse(instance.getFileContent());

      expect(json["amp.tools.disable"]).toEqual([]);
      // Entries with matches.cmd come first (sorted reject<ask<allow then cmd),
      // and the catch-all allow comes last.
      expect(json["amp.permissions"]).toEqual([
        { tool: "bash", action: "reject", matches: { cmd: "rm *" } },
        { tool: "bash", action: "ask", matches: { cmd: "sudo *" } },
        { tool: "bash", action: "allow", matches: { cmd: "git *" } },
        { tool: "bash", action: "allow" },
      ]);
    });

    it("emits every reject before any allow so a glob-tool allow cannot shadow a specific reject", async () => {
      // `mcp__*` is a glob tool whose catch-all allow would, under Amp's
      // first-match-wins, shadow the specific `mcp__github` reject if emitted
      // first. Global fail-closed ordering puts all rejects ahead.
      const rulesyncPermissions = makeRulesyncPermissions(testDir, {
        "mcp__*": { "*": "allow" },
        mcp__github: { "deploy *": "deny" },
      });

      const instance = await AmpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });
      const json = JSON.parse(instance.getFileContent());

      expect(json["amp.permissions"]).toEqual([
        { tool: "mcp__github", action: "reject", matches: { cmd: "deploy *" } },
        { tool: "mcp__*", action: "allow" },
      ]);
    });

    it("preserves builtin: prefixes and the * glob verbatim, sorted and deduped", async () => {
      const rulesyncPermissions = makeRulesyncPermissions(testDir, {
        edit_file: { "*": "deny" },
        "builtin:Bash": { "*": "deny" },
        "*": { "*": "deny" },
      });

      const instance = await AmpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });
      const json = JSON.parse(instance.getFileContent());

      expect(json["amp.tools.disable"]).toEqual(["*", "builtin:Bash", "edit_file"]);
    });

    it("merges into an existing settings file, preserving other keys", async () => {
      await writeFileContent(
        join(testDir, ".amp", "settings.json"),
        JSON.stringify({ "amp.mcpServers": { srv: { command: "x" } } }),
      );
      const rulesyncPermissions = makeRulesyncPermissions(testDir, {
        edit_file: { "*": "deny" },
      });

      const instance = await AmpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });
      const json = JSON.parse(instance.getFileContent());

      expect(json["amp.mcpServers"]).toEqual({ srv: { command: "x" } });
      expect(json["amp.tools.disable"]).toEqual(["edit_file"]);
    });

    it("prefers an existing settings.jsonc file", async () => {
      await writeFileContent(join(testDir, ".amp", "settings.jsonc"), "{}");
      const rulesyncPermissions = makeRulesyncPermissions(testDir, {
        edit_file: { "*": "deny" },
      });

      const instance = await AmpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      expect(instance.getRelativeFilePath()).toBe("settings.jsonc");
    });

    it("preserves a pre-existing delegate entry, placing it after generated entries", async () => {
      await writeFileContent(
        join(testDir, ".amp", "settings.json"),
        JSON.stringify({
          "amp.permissions": [
            { tool: "bash", action: "delegate", matches: { cmd: "deploy *" } },
            // A user-authored allow that rulesync owns and should regenerate (wholesale-replace).
            { tool: "bash", action: "allow", matches: { cmd: "stale *" } },
          ],
        }),
      );
      const rulesyncPermissions = makeRulesyncPermissions(testDir, {
        bash: { "git *": "allow" },
      });

      const instance = await AmpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });
      const json = JSON.parse(instance.getFileContent());

      expect(json["amp.permissions"]).toEqual([
        // Regenerated rulesync entry first.
        { tool: "bash", action: "allow", matches: { cmd: "git *" } },
        // Pre-existing delegate survives, placed after generated entries.
        { tool: "bash", action: "delegate", matches: { cmd: "deploy *" } },
      ]);
    });

    it("removes amp.permissions when nothing is generated and no delegate is preserved", async () => {
      await writeFileContent(
        join(testDir, ".amp", "settings.json"),
        JSON.stringify({
          "amp.permissions": [{ tool: "bash", action: "allow", matches: { cmd: "old *" } }],
        }),
      );
      const rulesyncPermissions = makeRulesyncPermissions(testDir, {
        edit_file: { "*": "deny" },
      });

      const instance = await AmpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });
      const json = JSON.parse(instance.getFileContent());

      expect(json["amp.tools.disable"]).toEqual(["edit_file"]);
      expect("amp.permissions" in json).toBe(false);
    });
  });

  describe("fromFile", () => {
    it("initializes amp.tools.disable when absent", async () => {
      await writeFileContent(join(testDir, ".amp", "settings.json"), JSON.stringify({ other: 1 }));

      const instance = await AmpPermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(instance.getFileContent());

      expect(json["amp.tools.disable"]).toEqual([]);
      expect(json.other).toBe(1);
    });

    it("strips a root `__proto__` and keeps the rest of the settings", async () => {
      // Sanitizing runs before the plain-object check, so this no longer fails
      // with "Amp settings must be a JSON object" the way it did when the raw
      // prototype swap reached that check. Dropping the one poisoned key is the
      // point: the user's unrelated settings survive.
      await writeFileContent(
        join(testDir, ".amp", "settings.json"),
        '{"__proto__":{"amp.tools.disable":["bash"]},"amp.tools.disable":["web"]}',
      );

      const instance = await AmpPermissions.fromFile({ outputRoot: testDir });
      const settings = JSON.parse(instance.getFileContent());

      expect(settings["amp.tools.disable"]).toEqual(["web"]);
      expect(Object.hasOwn(settings, "__proto__")).toBe(false);
    });

    it("reports the offset when the settings file is malformed", async () => {
      await writeFileContent(join(testDir, ".amp", "settings.json"), "{ not json");

      await expect(AmpPermissions.fromFile({ outputRoot: testDir })).rejects.toThrow(
        /Failed to parse Amp settings: SyntaxError: Failed to parse JSONC content: .* at offset \d+/,
      );
      await expect(AmpPermissions.fromFile({ outputRoot: testDir })).rejects.toMatchObject({
        cause: expect.any(SyntaxError),
      });
    });
  });

  describe("toRulesyncPermissions", () => {
    it("maps each disabled tool name to a category with { '*': 'deny' }", async () => {
      await writeFileContent(
        join(testDir, ".amp", "settings.json"),
        JSON.stringify({ "amp.tools.disable": ["edit_file", "builtin:Bash", "*"] }),
      );

      const instance = await AmpPermissions.fromFile({ outputRoot: testDir });
      const rulesync = instance.toRulesyncPermissions();
      const config = JSON.parse(rulesync.getFileContent());

      expect(config.permission.edit_file).toEqual({ "*": "deny" });
      expect(config.permission["builtin:Bash"]).toEqual({ "*": "deny" });
      expect(config.permission["*"]).toEqual({ "*": "deny" });
    });

    it("imports amp.permissions entries back into canonical actions", async () => {
      await writeFileContent(
        join(testDir, ".amp", "settings.json"),
        JSON.stringify({
          "amp.permissions": [
            { tool: "read_file", action: "allow" },
            { tool: "web", action: "ask" },
            { tool: "bash", action: "reject", matches: { cmd: "rm *" } },
            { tool: "bash", action: "allow", matches: { cmd: "git *" } },
          ],
        }),
      );

      const instance = await AmpPermissions.fromFile({ outputRoot: testDir });
      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());

      expect(config.permission.read_file).toEqual({ "*": "allow" });
      expect(config.permission.web).toEqual({ "*": "ask" });
      expect(config.permission.bash).toEqual({ "rm *": "deny", "git *": "allow" });
    });

    it("strips prototype-pollution keys recursively while retaining valid permissions", async () => {
      await writeFileContent(
        join(testDir, ".amp", "settings.json"),
        '{"constructor":{"polluted":true},"amp.permissions":[{"tool":"bash","action":"allow","metadata":{"prototype":{"polluted":true},"safe":"value"}}]}',
      );

      const instance = await AmpPermissions.fromFile({ outputRoot: testDir });
      const settings = JSON.parse(instance.getFileContent());
      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());

      expect(Object.hasOwn(settings, "constructor")).toBe(false);
      expect(settings["amp.permissions"][0].metadata).toEqual({ safe: "value" });
      expect(config.permission.bash).toEqual({ "*": "allow" });
    });

    it("ignores a permission entry reachable only through `__proto__`", async () => {
      // The PoC from #2855, and the case a naive filter cannot defend against:
      // `constructor` and `prototype` arrive as own keys and are easy to skip,
      // while `__proto__` never becomes one -- the engine swaps the object's
      // prototype instead, so the entry is readable without appearing in
      // `Object.keys`.
      await writeFileContent(
        join(testDir, ".amp", "settings.json"),
        '{"amp.permissions":[{"__proto__":{"tool":"bash","action":"allow"},"matches":{}}]}',
      );

      const instance = await AmpPermissions.fromFile({ outputRoot: testDir });
      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());

      expect(config.permission.bash).toBeUndefined();
      expect(Object.prototype).not.toHaveProperty("tool");
    });

    it("routes delegate entries into the amp override on import (no canonical equivalent)", async () => {
      await writeFileContent(
        join(testDir, ".amp", "settings.json"),
        JSON.stringify({
          "amp.permissions": [
            { tool: "bash", action: "delegate", matches: { cmd: "deploy *" }, to: "approve.sh" },
            { tool: "bash", action: "allow", matches: { cmd: "git *" } },
          ],
        }),
      );

      const instance = await AmpPermissions.fromFile({ outputRoot: testDir });
      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());

      // Canonical entry drives the shared permission block.
      expect(config.permission.bash).toEqual({ "git *": "allow" });
      // The delegate entry is preserved verbatim in the amp override, not dropped.
      expect(config.amp.permissions).toEqual([
        { tool: "bash", action: "delegate", matches: { cmd: "deploy *" }, to: "approve.sh" },
      ]);
    });

    it("merges both sources and lets deny/reject win on conflict (fail-closed)", async () => {
      await writeFileContent(
        join(testDir, ".amp", "settings.json"),
        JSON.stringify({
          "amp.tools.disable": ["bash"],
          // amp.permissions has a catch-all allow for the same tool+pattern.
          "amp.permissions": [{ tool: "bash", action: "allow" }],
        }),
      );

      const instance = await AmpPermissions.fromFile({ outputRoot: testDir });
      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());

      // disable → bash:{"*":"deny"}; the allow on the same key loses to deny.
      expect(config.permission.bash).toEqual({ "*": "deny" });
    });
  });

  describe("amp override (non-cmd matchers / guardedFiles / dangerouslyAllowAll / mcpPermissions)", () => {
    it("authors sibling settings and appends override permissions after generated entries", async () => {
      const rulesyncPermissions = makeRulesyncPermissionsJson(testDir, {
        permission: { bash: { "git *": "allow" } },
        amp: {
          dangerouslyAllowAll: false,
          guardedFiles: { allowlist: ["docs/**", "README.md"] },
          mcpPermissions: [{ matches: { command: "playwright" }, action: "allow" }],
          permissions: [
            { tool: "Bash", action: "delegate", to: "approve.sh", matches: { path: "/etc/**" } },
            { tool: "Read", action: "reject", message: "blocked", context: "subagent" },
          ],
        },
      });

      const instance = await AmpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });
      const json = JSON.parse(instance.getFileContent());

      expect(json["amp.dangerouslyAllowAll"]).toBe(false);
      expect(json["amp.guardedFiles.allowlist"]).toEqual(["docs/**", "README.md"]);
      expect(json["amp.mcpPermissions"]).toEqual([
        { matches: { command: "playwright" }, action: "allow" },
      ]);
      // Fail-closed merge: the authored reject leads (so it can't be shadowed by
      // the generated catch-all allow), then the generated allow, then delegate
      // as the final fallback.
      expect(json["amp.permissions"]).toEqual([
        { tool: "Read", action: "reject", message: "blocked", context: "subagent" },
        { tool: "bash", action: "allow", matches: { cmd: "git *" } },
        { tool: "Bash", action: "delegate", to: "approve.sh", matches: { path: "/etc/**" } },
      ]);
    });

    it("orders an authored reject before a generated catch-all allow on the same tool (fail-closed)", async () => {
      const rulesyncPermissions = makeRulesyncPermissionsJson(testDir, {
        permission: { bash: { "*": "allow" } },
        amp: {
          permissions: [{ tool: "bash", action: "reject", matches: { path: "/etc/**" } }],
        },
      });

      const instance = await AmpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });
      const entries = JSON.parse(instance.getFileContent())["amp.permissions"];

      // The authored reject must precede the generated catch-all allow, or Amp's
      // first-match-wins would let the allow shadow it.
      expect(entries).toEqual([
        { tool: "bash", action: "reject", matches: { path: "/etc/**" } },
        { tool: "bash", action: "allow" },
      ]);
    });

    it("round-trips the override through import", async () => {
      await writeFileContent(
        join(testDir, ".amp", "settings.json"),
        JSON.stringify({
          "amp.permissions": [
            { tool: "bash", action: "allow", matches: { cmd: "git *" } },
            { tool: "Read", action: "reject", message: "blocked", context: "subagent" },
          ],
          "amp.guardedFiles.allowlist": ["docs/**"],
          "amp.dangerouslyAllowAll": true,
          "amp.mcpPermissions": [{ matches: { url: "https://x" }, action: "reject" }],
        }),
      );

      const instance = await AmpPermissions.fromFile({ outputRoot: testDir });
      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());

      // The cmd entry is canonical; the message/context entry goes to the override.
      expect(config.permission.bash).toEqual({ "git *": "allow" });
      expect(config.amp).toEqual({
        permissions: [{ tool: "Read", action: "reject", message: "blocked", context: "subagent" }],
        mcpPermissions: [{ matches: { url: "https://x" }, action: "reject" }],
        guardedFiles: { allowlist: ["docs/**"] },
        dangerouslyAllowAll: true,
      });
    });

    it("omits the amp override when no non-canonical settings exist", async () => {
      await writeFileContent(
        join(testDir, ".amp", "settings.json"),
        JSON.stringify({
          "amp.permissions": [{ tool: "bash", action: "allow", matches: { cmd: "git *" } }],
        }),
      );

      const instance = await AmpPermissions.fromFile({ outputRoot: testDir });
      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());
      expect(config.amp).toBeUndefined();
    });
  });

  describe("round-trip", () => {
    it("round-trips allow/ask/reject and whole-tool deny through Amp and back", async () => {
      const original = {
        bash: { "*": "deny", "git *": "allow", "rm *": "deny", "sudo *": "ask" },
        read_file: { "*": "allow" },
        web: { "*": "ask" },
      };
      const rulesyncPermissions = makeRulesyncPermissions(testDir, original);

      const exported = await AmpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });
      // Re-read the generated settings file shape into a fresh instance.
      await writeFileContent(join(testDir, ".amp", "settings.json"), exported.getFileContent());
      const reimported = await AmpPermissions.fromFile({ outputRoot: testDir });
      const config = JSON.parse(reimported.toRulesyncPermissions().getFileContent());

      expect(config.permission.bash).toEqual({
        "*": "deny",
        "git *": "allow",
        "rm *": "deny",
        "sudo *": "ask",
      });
      expect(config.permission.read_file).toEqual({ "*": "allow" });
      expect(config.permission.web).toEqual({ "*": "ask" });
    });
  });

  describe("isDeletable", () => {
    it("is never deletable because the settings file is shared", () => {
      const instance = new AmpPermissions({
        outputRoot: testDir,
        relativeDirPath: ".amp",
        relativeFilePath: "settings.json",
        fileContent: "{}",
      });
      expect(instance.isDeletable()).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("produces an empty amp.tools.disable list", () => {
      const instance = AmpPermissions.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".amp",
        relativeFilePath: "settings.json",
      });
      const json = JSON.parse(instance.getFileContent());
      expect(json["amp.tools.disable"]).toEqual([]);
    });
  });

  describe("validate", () => {
    it("rejects a non-array amp.tools.disable", () => {
      const instance = new AmpPermissions({
        outputRoot: testDir,
        relativeDirPath: ".amp",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ "amp.tools.disable": "nope" }),
      });
      expect(instance.validate().success).toBe(false);
    });

    it("accepts a valid array", () => {
      const instance = new AmpPermissions({
        outputRoot: testDir,
        relativeDirPath: ".amp",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ "amp.tools.disable": ["edit_file"] }),
      });
      expect(instance.validate().success).toBe(true);
    });

    it("rejects a non-array amp.permissions", () => {
      const instance = new AmpPermissions({
        outputRoot: testDir,
        relativeDirPath: ".amp",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ "amp.permissions": "nope" }),
      });
      expect(instance.validate().success).toBe(false);
    });

    it("accepts a valid amp.permissions array", () => {
      const instance = new AmpPermissions({
        outputRoot: testDir,
        relativeDirPath: ".amp",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          "amp.permissions": [{ tool: "bash", action: "allow" }],
        }),
      });
      expect(instance.validate().success).toBe(true);
    });
  });
});

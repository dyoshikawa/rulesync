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

    it("skips delegate entries on import (no canonical equivalent)", async () => {
      await writeFileContent(
        join(testDir, ".amp", "settings.json"),
        JSON.stringify({
          "amp.permissions": [
            { tool: "bash", action: "delegate", matches: { cmd: "deploy *" } },
            { tool: "bash", action: "allow", matches: { cmd: "git *" } },
          ],
        }),
      );

      const instance = await AmpPermissions.fromFile({ outputRoot: testDir });
      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());

      expect(config.permission.bash).toEqual({ "git *": "allow" });
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

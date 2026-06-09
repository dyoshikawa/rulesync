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
    it("maps deny rules to amp.tools.disable, skipping allow/ask", async () => {
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

      expect(json["amp.tools.disable"]).toEqual(["edit_file"]);
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
  });
});

import { join } from "node:path";

import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import { TaktPermissions } from "./takt-permissions.js";

const makeRulesyncPermissions = (permission: Record<string, Record<string, string>>) =>
  new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify({ permission }),
  });

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const readMode = (content: string, provider: string): unknown => {
  const parsed = toRecord(load(content));
  const profiles = toRecord(parsed.provider_profiles);
  const profile = toRecord(profiles[provider]);
  return profile.default_permission_mode;
};

describe("TaktPermissions", () => {
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
    it("writes to .takt/config.yaml", () => {
      expect(TaktPermissions.getSettablePaths()).toEqual({
        relativeDirPath: ".takt",
        relativeFilePath: "config.yaml",
      });
    });
  });

  describe("fromRulesyncPermissions (generate)", () => {
    it("derives readonly when any rule is deny", async () => {
      const permissions = await TaktPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          bash: { "*": "allow", "rm *": "deny" },
        }),
      });

      expect(readMode(permissions.getFileContent(), "claude")).toBe("readonly");
    });

    it("derives edit when an edit/write category has an allow rule", async () => {
      const permissions = await TaktPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          edit: { "*": "allow" },
          bash: { "*": "allow" },
        }),
      });

      expect(readMode(permissions.getFileContent(), "claude")).toBe("edit");
    });

    it("derives full when only a bash category has an allow rule", async () => {
      const permissions = await TaktPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          bash: { "*": "allow" },
        }),
      });

      expect(readMode(permissions.getFileContent(), "claude")).toBe("full");
    });

    it("defaults an empty config to readonly", async () => {
      const permissions = await TaktPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({}),
      });

      expect(readMode(permissions.getFileContent(), "claude")).toBe("readonly");
    });

    it("defaults to the claude provider when no provider key exists", async () => {
      const permissions = await TaktPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({ bash: { "*": "allow" } }),
      });

      const parsed = toRecord(load(permissions.getFileContent()));
      const profiles = toRecord(parsed.provider_profiles);
      expect(Object.keys(profiles)).toEqual(["claude"]);
    });

    it("writes under the active provider and preserves other top-level keys + step overrides", async () => {
      await writeFileContent(
        join(testDir, ".takt", "config.yaml"),
        [
          "provider: codex",
          "model: gpt-5",
          "provider_profiles:",
          "  codex:",
          "    default_permission_mode: readonly",
          "    step_permission_overrides:",
          "      review: full",
          "  claude:",
          "    default_permission_mode: edit",
        ].join("\n"),
      );

      const permissions = await TaktPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({ bash: { "*": "allow" } }),
      });

      const parsed = toRecord(load(permissions.getFileContent()));
      // Other top-level keys preserved.
      expect(parsed.provider).toBe("codex");
      expect(parsed.model).toBe("gpt-5");

      const profiles = toRecord(parsed.provider_profiles);
      const codex = toRecord(profiles.codex);
      // Active provider's mode updated, step overrides preserved.
      expect(codex.default_permission_mode).toBe("full");
      expect(toRecord(codex.step_permission_overrides).review).toBe("full");
      // Other provider profile preserved untouched.
      expect(toRecord(profiles.claude).default_permission_mode).toBe("edit");
    });
  });

  describe("toRulesyncPermissions (import)", () => {
    const importMode = async (yaml: string) => {
      await writeFileContent(join(testDir, ".takt", "config.yaml"), yaml);
      const tool = await TaktPermissions.fromFile({ outputRoot: testDir });
      return JSON.parse(tool.toRulesyncPermissions().getFileContent());
    };

    it("maps full to bash allow", async () => {
      const json = await importMode(
        [
          "provider: claude",
          "provider_profiles:",
          "  claude:",
          "    default_permission_mode: full",
        ].join("\n"),
      );
      expect(json.permission.bash["*"]).toBe("allow");
    });

    it("maps edit to edit allow", async () => {
      const json = await importMode(
        [
          "provider: claude",
          "provider_profiles:",
          "  claude:",
          "    default_permission_mode: edit",
        ].join("\n"),
      );
      expect(json.permission.edit["*"]).toBe("allow");
    });

    it("maps readonly to bash deny", async () => {
      const json = await importMode(
        [
          "provider: claude",
          "provider_profiles:",
          "  claude:",
          "    default_permission_mode: readonly",
        ].join("\n"),
      );
      expect(json.permission.bash["*"]).toBe("deny");
    });

    it("maps an unset/unknown mode to bash deny", async () => {
      const json = await importMode("provider: claude\n");
      expect(json.permission.bash["*"]).toBe("deny");
    });

    it("resolves the active provider from the sole profile when no provider key exists", async () => {
      const json = await importMode(
        ["provider_profiles:", "  codex:", "    default_permission_mode: full"].join("\n"),
      );
      expect(json.permission.bash["*"]).toBe("allow");
    });
  });

  describe("round-trip", () => {
    it("export then import preserves each mode", async () => {
      const cases: { permission: Record<string, Record<string, string>>; expected: unknown }[] = [
        { permission: { bash: { "*": "allow" } }, expected: { bash: { "*": "allow" } } },
        { permission: { edit: { "*": "allow" } }, expected: { edit: { "*": "allow" } } },
        { permission: { bash: { "rm *": "deny" } }, expected: { bash: { "*": "deny" } } },
      ];

      for (const { permission, expected } of cases) {
        const exported = await TaktPermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions: makeRulesyncPermissions(permission),
        });
        const reimported = new TaktPermissions({
          outputRoot: testDir,
          relativeDirPath: ".takt",
          relativeFilePath: "config.yaml",
          fileContent: exported.getFileContent(),
        });
        const json = JSON.parse(reimported.toRulesyncPermissions().getFileContent());
        expect(json.permission).toEqual(expected);
      }
    });
  });

  describe("fromFile", () => {
    it("returns an empty config when the file is missing", async () => {
      const tool = await TaktPermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(tool.toRulesyncPermissions().getFileContent());
      // No mode set -> safe readonly projection.
      expect(json.permission.bash["*"]).toBe("deny");
    });
  });

  describe("isDeletable", () => {
    it("never deletes the shared config", () => {
      const tool = TaktPermissions.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".takt",
        relativeFilePath: "config.yaml",
      });
      expect(tool.isDeletable()).toBe(false);
    });
  });
});

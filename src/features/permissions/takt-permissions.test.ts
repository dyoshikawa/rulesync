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

const makeRulesyncPermissionsJson = (json: Record<string, unknown>) =>
  new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify(json),
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

  describe("takt override (step_permission_overrides + provider_options)", () => {
    it("authors step_permission_overrides into the active provider profile", async () => {
      const permissions = await TaktPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissionsJson({
          permission: { bash: { "*": "allow" } },
          takt: { step_permission_overrides: { ai_review: "readonly", build: "full" } },
        }),
      });

      const parsed = toRecord(load(permissions.getFileContent()));
      const claude = toRecord(toRecord(parsed.provider_profiles).claude);
      // Derived coarse mode and per-step overrides coexist in the profile.
      expect(claude.default_permission_mode).toBe("full");
      expect(toRecord(claude.step_permission_overrides)).toEqual({
        ai_review: "readonly",
        build: "full",
      });
    });

    it("authors provider_options as a top-level table and preserves existing entries", async () => {
      await writeFileContent(
        join(testDir, ".takt", "config.yaml"),
        [
          "provider: codex",
          "provider_options:",
          "  claude:",
          "    reasoning_effort: high",
          "  codex:",
          "    base_url: http://127.0.0.1:8080",
        ].join("\n"),
      );

      const permissions = await TaktPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissionsJson({
          permission: { bash: { "*": "allow" } },
          takt: { provider_options: { codex: { network_access: true } } },
        }),
      });

      const parsed = toRecord(load(permissions.getFileContent()));
      const providerOptions = toRecord(parsed.provider_options);
      // Authored key merged into the same provider without dropping its sibling keys.
      expect(toRecord(providerOptions.codex).network_access).toBe(true);
      expect(toRecord(providerOptions.codex).base_url).toBe("http://127.0.0.1:8080");
      // Untouched provider preserved.
      expect(toRecord(providerOptions.claude).reasoning_effort).toBe("high");
    });

    it("round-trips the override through export then import", async () => {
      const generated = await TaktPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissionsJson({
          permission: { bash: { "*": "allow" } },
          takt: {
            step_permission_overrides: { ai_review: "readonly" },
            provider_options: { codex: { network_access: true } },
          },
        }),
      });
      await writeFileContent(join(testDir, ".takt", "config.yaml"), generated.getFileContent());

      const reimported = await TaktPermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(reimported.toRulesyncPermissions().getFileContent());

      expect(json.takt.step_permission_overrides).toEqual({ ai_review: "readonly" });
      expect(json.takt.provider_options).toEqual({ codex: { network_access: true } });
    });

    it("omits the takt override when the config has neither surface", async () => {
      await writeFileContent(
        join(testDir, ".takt", "config.yaml"),
        [
          "provider: codex",
          "provider_profiles:",
          "  codex:",
          "    default_permission_mode: full",
        ].join("\n"),
      );

      const tool = await TaktPermissions.fromFile({ outputRoot: testDir });
      const json = JSON.parse(tool.toRulesyncPermissions().getFileContent());
      expect(json.takt).toBeUndefined();
    });
  });

  describe("workflow security policies", () => {
    it("writes the default-deny toggles the takt override authors", async () => {
      const permissions = await TaktPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissionsJson({
          permission: {},
          takt: {
            workflow_arpeggio: { custom_merge_files: true, custom_merge_inline_js: false },
            workflow_runtime_prepare: { custom_scripts: true },
            workflow_command_gates: { custom_scripts: true },
            sync_conflict_resolver: { auto_approve_tools: false },
            allow_git_hooks: true,
            allow_git_filters: false,
          },
        }),
      });

      const parsed = toRecord(load(permissions.getFileContent()));
      expect(parsed.workflow_arpeggio).toEqual({
        custom_merge_files: true,
        custom_merge_inline_js: false,
      });
      expect(parsed.workflow_runtime_prepare).toEqual({ custom_scripts: true });
      expect(parsed.workflow_command_gates).toEqual({ custom_scripts: true });
      expect(parsed.sync_conflict_resolver).toEqual({ auto_approve_tools: false });
      expect(parsed.allow_git_hooks).toBe(true);
      expect(parsed.allow_git_filters).toBe(false);
    });

    it("drops a value whose shape Takt would reject", async () => {
      // Takt's loader hard-rejects unknown top-level keys and wrong types, so a
      // non-boolean flag must not reach config.yaml.
      const permissions = await TaktPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissionsJson({
          permission: {},
          takt: {
            allow_git_hooks: "yes",
            workflow_arpeggio: { custom_merge_files: "true", custom_merge_inline_js: true },
          },
        }),
      });

      const parsed = toRecord(load(permissions.getFileContent()));
      expect(parsed.allow_git_hooks).toBeUndefined();
      expect(parsed.workflow_arpeggio).toEqual({ custom_merge_inline_js: true });
    });

    it("removes a toggle the source no longer states", async () => {
      // A default-deny capability must not stay switched on after the user
      // revokes it; deep-merging the key would leave the old `true` behind.
      await writeFileContent(
        join(testDir, ".takt", "config.yaml"),
        [
          "provider: claude",
          "allow_git_hooks: true",
          "workflow_arpeggio:",
          "  custom_merge_files: true",
          "",
        ].join("\n"),
      );

      const permissions = await TaktPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissionsJson({ permission: {}, takt: {} }),
      });

      const parsed = toRecord(load(permissions.getFileContent()));
      expect(parsed.allow_git_hooks).toBeUndefined();
      expect(parsed.workflow_arpeggio).toBeUndefined();
      expect(parsed.provider).toBe("claude");
    });

    it("replaces a policy table rather than merging into the old one", async () => {
      await writeFileContent(
        join(testDir, ".takt", "config.yaml"),
        ["workflow_arpeggio:", "  custom_merge_files: true", ""].join("\n"),
      );

      const permissions = await TaktPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissionsJson({
          permission: {},
          takt: { workflow_arpeggio: { custom_data_source_modules: true } },
        }),
      });

      const parsed = toRecord(load(permissions.getFileContent()));
      expect(parsed.workflow_arpeggio).toEqual({ custom_data_source_modules: true });
    });

    it("drops a sub-key Takt's strict schema does not declare", async () => {
      // Takt rejects the whole config.yaml on an unknown key, so a typo here
      // must not reach the file.
      const permissions = await TaktPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissionsJson({
          permission: {},
          takt: { workflow_arpeggio: { custom_merge_file: true, custom_merge_files: true } },
        }),
      });

      const parsed = toRecord(load(permissions.getFileContent()));
      expect(parsed.workflow_arpeggio).toEqual({ custom_merge_files: true });
    });

    it("round-trips the toggles back into the takt override on import", async () => {
      const permissions = new TaktPermissions({
        outputRoot: testDir,
        relativeDirPath: ".takt",
        relativeFilePath: "config.yaml",
        fileContent: [
          "provider: claude",
          "allow_git_hooks: true",
          "workflow_runtime_prepare:",
          "  custom_scripts: true",
          "",
        ].join("\n"),
      });

      const imported = JSON.parse(permissions.toRulesyncPermissions().getFileContent());
      expect(imported.takt).toEqual({
        allow_git_hooks: true,
        workflow_runtime_prepare: { custom_scripts: true },
      });
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

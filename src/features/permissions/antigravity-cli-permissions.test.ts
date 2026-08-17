import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { fallbackLogger } from "../../utils/logger.js";
import { AntigravityCliPermissions } from "./antigravity-cli-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

type SettingsJson = {
  permissions?: {
    allow?: string[];
    ask?: string[];
    deny?: string[];
  };
  [key: string]: unknown;
};

describe("AntigravityCliPermissions", () => {
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

  it("should expose the global settings.json path under .gemini/antigravity-cli", () => {
    const paths = AntigravityCliPermissions.getSettablePaths();
    expect(paths.relativeDirPath).toBe(join(".gemini", "antigravity-cli"));
    expect(paths.relativeFilePath).toBe("settings.json");
  });

  it("should not be deletable because settings.json holds other CLI settings", () => {
    const permissions = AntigravityCliPermissions.forDeletion({
      outputRoot: testDir,
      relativeDirPath: join(".gemini", "antigravity-cli"),
      relativeFilePath: "settings.json",
    });

    expect(permissions.isDeletable()).toBe(false);
  });

  it("should report validation success", () => {
    const permissions = new AntigravityCliPermissions({
      outputRoot: testDir,
      relativeDirPath: join(".gemini", "antigravity-cli"),
      relativeFilePath: "settings.json",
      fileContent: JSON.stringify({ permissions: {} }),
      global: true,
    });

    expect(permissions.validate()).toEqual({ success: true, error: null });
  });

  it("should convert rulesync bash rules into Claude-Code-style command entries", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: { "git status *": "allow", "rm -rf *": "deny" },
        },
      }),
    });

    const permissions = await AntigravityCliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const settings = JSON.parse(permissions.getFileContent()) as SettingsJson;
    expect(settings.permissions?.allow).toContain("command(git status *)");
    expect(settings.permissions?.deny).toContain("command(rm -rf *)");
  });

  it("should map an ask action and emit a bare tool name for a match-all pattern", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: { "*": "ask" },
        },
      }),
    });

    const permissions = await AntigravityCliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const settings = JSON.parse(permissions.getFileContent()) as SettingsJson;
    // A "*" pattern collapses to just the tool name (no parentheses).
    expect(settings.permissions?.ask).toContain("command");
    expect(settings.permissions?.ask).not.toContain("command(*)");
  });

  it("should pass non-bash categories through unchanged as the tool name", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          mcp__server__tool: { "*": "allow" },
        },
      }),
    });

    const permissions = await AntigravityCliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const settings = JSON.parse(permissions.getFileContent()) as SettingsJson;
    expect(settings.permissions?.allow).toContain("mcp__server__tool");
  });

  it("should map read/write/edit/webfetch to the engine action vocabulary", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: { "src/**": "allow" },
          write: { "dist/**": "deny" },
          edit: { "config/**": "ask" },
          webfetch: { "https://example.com/*": "allow" },
        },
      }),
    });

    const permissions = await AntigravityCliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const settings = JSON.parse(permissions.getFileContent()) as SettingsJson;
    expect(settings.permissions?.allow).toContain("read_file(src/**)");
    expect(settings.permissions?.deny).toContain("write_file(dist/**)");
    // edit collapses onto write_file as well.
    expect(settings.permissions?.ask).toContain("write_file(config/**)");
    expect(settings.permissions?.allow).toContain("read_url(https://example.com/*)");
  });

  it("should round-trip read_file/write_file/read_url back into canonical categories", () => {
    const permissions = new AntigravityCliPermissions({
      outputRoot: testDir,
      relativeDirPath: join(".gemini", "antigravity-cli"),
      relativeFilePath: "settings.json",
      fileContent: JSON.stringify({
        permissions: {
          allow: ["read_file(src/**)", "read_url(https://example.com/*)"],
          deny: ["write_file(dist/**)"],
        },
      }),
      global: true,
    });

    const json = permissions.toRulesyncPermissions().getJson();
    expect(json.permission.read?.["src/**"]).toBe("allow");
    // write_file collapses to canonical `write` (edit/write are a documented, lossy merge).
    expect(json.permission.write?.["dist/**"]).toBe("deny");
    expect(json.permission.webfetch?.["https://example.com/*"]).toBe("allow");
  });

  it("should sort and de-duplicate merged allow entries", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: { "npm run *": "allow", "git status *": "allow" },
        },
      }),
    });

    const permissions = await AntigravityCliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const settings = JSON.parse(permissions.getFileContent()) as SettingsJson;
    const allow = settings.permissions?.allow ?? [];
    expect(allow).toEqual([...allow].toSorted());
    expect(new Set(allow).size).toBe(allow.length);
  });

  it("should preserve existing entries for tools that are not managed by the config", async () => {
    const dir = join(testDir, ".gemini", "antigravity-cli");
    await ensureDir(dir);
    await writeFileContent(
      join(dir, "settings.json"),
      JSON.stringify({
        someOtherSetting: true,
        // `execute_url` is an engine action with no canonical equivalent, so it
        // is never managed by a rulesync config and must survive untouched.
        permissions: { allow: ["execute_url(https://deploy.example.com)"] },
      }),
    );

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: { "git status *": "allow" },
        },
      }),
    });

    const permissions = await AntigravityCliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const settings = JSON.parse(permissions.getFileContent()) as SettingsJson;
    expect(settings.permissions?.allow).toContain("execute_url(https://deploy.example.com)");
    expect(settings.permissions?.allow).toContain("command(git status *)");
    // Unrelated top-level settings are also preserved.
    expect(settings.someOtherSetting).toBe(true);
  });

  it("should replace existing read_file entries when the read category is managed", async () => {
    const dir = join(testDir, ".gemini", "antigravity-cli");
    await ensureDir(dir);
    await writeFileContent(
      join(dir, "settings.json"),
      JSON.stringify({
        permissions: { allow: ["read_file(old/**)"] },
      }),
    );

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: { "src/**": "allow" },
        },
      }),
    });

    const permissions = await AntigravityCliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const settings = JSON.parse(permissions.getFileContent()) as SettingsJson;
    // `read` maps to the managed `read_file` action, so the stale entry is dropped.
    expect(settings.permissions?.allow).not.toContain("read_file(old/**)");
    expect(settings.permissions?.allow).toContain("read_file(src/**)");
  });

  it("should replace existing entries for managed tools instead of accumulating them", async () => {
    const dir = join(testDir, ".gemini", "antigravity-cli");
    await ensureDir(dir);
    await writeFileContent(
      join(dir, "settings.json"),
      JSON.stringify({
        permissions: { allow: ["command(old command *)"] },
      }),
    );

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: { "git status *": "allow" },
        },
      }),
    });

    const permissions = await AntigravityCliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const settings = JSON.parse(permissions.getFileContent()) as SettingsJson;
    // The previous "command(...)" entry is managed, so it is dropped and replaced.
    expect(settings.permissions?.allow).not.toContain("command(old command *)");
    expect(settings.permissions?.allow).toContain("command(git status *)");
  });

  it("should parse settings.json command entries back into canonical bash rules", () => {
    const permissions = new AntigravityCliPermissions({
      outputRoot: testDir,
      relativeDirPath: join(".gemini", "antigravity-cli"),
      relativeFilePath: "settings.json",
      fileContent: JSON.stringify({
        permissions: {
          allow: ["command(git status *)"],
          deny: ["command(rm -rf *)"],
        },
      }),
      global: true,
    });

    const json = permissions.toRulesyncPermissions().getJson();
    expect(json.permission.bash?.["git status *"]).toBe("allow");
    expect(json.permission.bash?.["rm -rf *"]).toBe("deny");
  });

  it("should treat a parenthesis-less entry as a match-all pattern when parsing", () => {
    const permissions = new AntigravityCliPermissions({
      outputRoot: testDir,
      relativeDirPath: join(".gemini", "antigravity-cli"),
      relativeFilePath: "settings.json",
      fileContent: JSON.stringify({
        permissions: {
          ask: ["command"],
        },
      }),
      global: true,
    });

    const json = permissions.toRulesyncPermissions().getJson();
    expect(json.permission.bash?.["*"]).toBe("ask");
  });

  it("should round-trip bash rules from rulesync through antigravity-cli back to rulesync", async () => {
    const source = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: { "git status *": "allow", "rm -rf *": "deny" },
        },
      }),
    });

    const emitted = await AntigravityCliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: source,
    });

    const reloaded = new AntigravityCliPermissions({
      outputRoot: testDir,
      relativeDirPath: join(".gemini", "antigravity-cli"),
      relativeFilePath: "settings.json",
      fileContent: emitted.getFileContent(),
      global: true,
    });

    const json = reloaded.toRulesyncPermissions().getJson();
    expect(json.permission.bash?.["git status *"]).toBe("allow");
    expect(json.permission.bash?.["rm -rf *"]).toBe("deny");
  });

  it("should load an existing settings.json from disk via fromFile", async () => {
    const dir = join(testDir, ".gemini", "antigravity-cli");
    await ensureDir(dir);
    await writeFileContent(
      join(dir, "settings.json"),
      JSON.stringify({ permissions: { allow: ["command(git status *)"] } }),
    );

    const loaded = await AntigravityCliPermissions.fromFile({ outputRoot: testDir });
    expect(loaded).toBeInstanceOf(AntigravityCliPermissions);
    const json = loaded.toRulesyncPermissions().getJson();
    expect(json.permission.bash?.["git status *"]).toBe("allow");
  });

  it("should yield empty permissions when settings.json is missing", async () => {
    const loaded = await AntigravityCliPermissions.fromFile({ outputRoot: testDir });
    const json = loaded.toRulesyncPermissions().getJson();
    expect(json.permission).toEqual({});
  });

  describe("antigravity-cli override (toolPermission / enableTerminalSandbox)", () => {
    it("authors the autonomy/sandbox knobs as top-level siblings of permissions", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "git *": "allow" } },
          "antigravity-cli": { toolPermission: "strict", enableTerminalSandbox: true },
        }),
      });

      const permissions = await AntigravityCliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const settings = JSON.parse(permissions.getFileContent()) as SettingsJson & {
        toolPermission?: string;
        enableTerminalSandbox?: boolean;
      };
      expect(settings.toolPermission).toBe("strict");
      expect(settings.enableTerminalSandbox).toBe(true);
      // The permissions arrays are unaffected.
      expect(settings.permissions?.allow).toContain("command(git *)");
    });

    it("round-trips the override through import", async () => {
      const dir = join(testDir, ".gemini", "antigravity-cli");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "settings.json"),
        JSON.stringify({
          toolPermission: "always-proceed",
          enableTerminalSandbox: false,
          permissions: { deny: ["command(rm -rf *)"] },
        }),
      );

      const loaded = await AntigravityCliPermissions.fromFile({ outputRoot: testDir });
      const json = loaded.toRulesyncPermissions().getJson() as {
        permission: Record<string, unknown>;
        "antigravity-cli"?: { toolPermission?: string; enableTerminalSandbox?: boolean };
      };

      expect(json["antigravity-cli"]).toEqual({
        toolPermission: "always-proceed",
        enableTerminalSandbox: false,
      });
      expect((json.permission.bash as Record<string, string>)["rm -rf *"]).toBe("deny");
    });

    it("authors and round-trips artifactReviewPolicy / allowNonWorkspaceAccess", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: {},
          "antigravity-cli": {
            artifactReviewPolicy: "agent-decides",
            allowNonWorkspaceAccess: false,
          },
        }),
      });

      const permissions = await AntigravityCliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const settings = JSON.parse(permissions.getFileContent()) as SettingsJson & {
        artifactReviewPolicy?: string;
        allowNonWorkspaceAccess?: boolean;
      };
      expect(settings.artifactReviewPolicy).toBe("agent-decides");
      expect(settings.allowNonWorkspaceAccess).toBe(false);

      const dir = join(testDir, ".gemini", "antigravity-cli");
      await ensureDir(dir);
      await writeFileContent(join(dir, "settings.json"), permissions.getFileContent());
      const loaded = await AntigravityCliPermissions.fromFile({ outputRoot: testDir });
      const json = loaded.toRulesyncPermissions().getJson() as {
        "antigravity-cli"?: Record<string, unknown>;
      };
      expect(json["antigravity-cli"]).toEqual({
        artifactReviewPolicy: "agent-decides",
        allowNonWorkspaceAccess: false,
      });
    });

    it("authors and round-trips agentMode (issue #2509)", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: {},
          "antigravity-cli": { agentMode: "accept-edits" },
        }),
      });

      const permissions = await AntigravityCliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const settings = JSON.parse(permissions.getFileContent()) as SettingsJson & {
        agentMode?: string;
      };
      expect(settings.agentMode).toBe("accept-edits");

      const dir = join(testDir, ".gemini", "antigravity-cli");
      await ensureDir(dir);
      await writeFileContent(join(dir, "settings.json"), permissions.getFileContent());
      const loaded = await AntigravityCliPermissions.fromFile({ outputRoot: testDir });
      const json = loaded.toRulesyncPermissions().getJson() as {
        "antigravity-cli"?: Record<string, unknown>;
      };
      expect(json["antigravity-cli"]).toEqual({ agentMode: "accept-edits" });
    });

    it("drops an agentMode value outside the documented enum on import", async () => {
      const dir = join(testDir, ".gemini", "antigravity-cli");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "settings.json"),
        JSON.stringify({ permissions: {}, agentMode: "turbo" }),
      );

      const loaded = await AntigravityCliPermissions.fromFile({ outputRoot: testDir });
      const json = loaded.toRulesyncPermissions().getJson() as {
        "antigravity-cli"?: Record<string, unknown>;
      };
      // Carrying an unknown value through would make the whole imported permissions file
      // fail the override schema's enum, so the key is dropped instead.
      expect(json["antigravity-cli"]).toBeUndefined();
    });

    it("drops toolPermission and artifactReviewPolicy values outside their enums on import (issue #2704)", async () => {
      const dir = join(testDir, ".gemini", "antigravity-cli");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "settings.json"),
        JSON.stringify({
          permissions: {},
          // A preset a newer Antigravity release could add, plus a typo.
          toolPermission: "yolo",
          artifactReviewPolicy: "asks-for-reviews",
          enableTerminalSandbox: true,
        }),
      );

      const warnSpy = vi.spyOn(fallbackLogger, "warn");
      const loaded = await AntigravityCliPermissions.fromFile({ outputRoot: testDir });
      const json = loaded.toRulesyncPermissions().getJson() as {
        "antigravity-cli"?: Record<string, unknown>;
      };
      // Both keys are `z.enum` in the override schema, so an unrecognized value
      // carried through would fail validation of the whole permissions file.
      expect(json["antigravity-cli"]).toEqual({ enableTerminalSandbox: true });
      // A preset rulesync does not know about yet must be visible, not silently
      // missing from the imported config.
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("'toolPermission: yolo'"));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("'artifactReviewPolicy: asks-for-reviews'"),
      );
      warnSpy.mockRestore();
    });

    it("omits the override when neither knob is present", async () => {
      const dir = join(testDir, ".gemini", "antigravity-cli");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "settings.json"),
        JSON.stringify({ permissions: { allow: ["command(git *)"] } }),
      );

      const loaded = await AntigravityCliPermissions.fromFile({ outputRoot: testDir });
      const json = loaded.toRulesyncPermissions().getJson() as {
        "antigravity-cli"?: unknown;
      };
      expect(json["antigravity-cli"]).toBeUndefined();
    });
  });
});

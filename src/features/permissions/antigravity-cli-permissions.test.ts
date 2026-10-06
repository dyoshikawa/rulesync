import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
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

  it("should turn a trailing ' *' into the literal command prefix Antigravity matches", async () => {
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
    // Antigravity reads a plain command target as a literal token prefix, so a
    // `*` copied into it would be a literal character and never match.
    expect(settings.permissions?.allow).toEqual(["command(git status)"]);
    expect(settings.permissions?.deny).toEqual(["command(rm -rf)"]);
  });

  it("should write globs inside words as per-word regex rules", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: {
            "git status": "allow",
            "npm install*": "ask",
            "docker * *": "deny",
            "rm -rf /tmp/?": "deny",
          },
        },
      }),
    });

    const permissions = await AntigravityCliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const settings = JSON.parse(permissions.getFileContent()) as SettingsJson;
    // Antigravity matches word by word and lets extra words follow, so an exact
    // command can only be written as its prefix.
    expect(settings.permissions?.allow).toEqual(["command(git status)"]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"git status": "allow"'));
    expect(settings.permissions?.ask).toEqual(["command(regex:^npm$ ^install.*$)"]);
    // Each regex word matches one word, so `docker * *` needs two more.
    expect(settings.permissions?.deny).toEqual([
      "command(regex:^docker$ ^.*$ ^.*$)",
      "command(regex:^rm$ ^-rf$ ^/tmp/.$)",
    ]);
  });

  it("should skip a `*` with a word after it and warn that the deny is not enforced", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: {
            "git push * --force": "deny",
            "git commit-* --amend": "deny",
            "git push *": "deny",
          },
        },
      }),
    });

    const permissions = await AntigravityCliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const settings = JSON.parse(permissions.getFileContent()) as SettingsJson;
    // `*` there can stand for several words; a regex word matches only one.
    expect(settings.permissions?.deny).toEqual(["command(git push)"]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('"git push * --force": "deny"'),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('"git commit-* --amend": "deny"'),
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("NOT enforced"));
  });

  it("should escape regex metacharacters and keep glob classes", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: {
            "cat ./a[bc].txt": "allow",
            "git status[!x]": "deny",
            "git[ ]status": "deny",
            "git[!x]status": "deny",
            "git?status": "deny",
            "regex:^ls$ ^-(la|l)$": "allow",
          },
        },
      }),
    });

    const permissions = await AntigravityCliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const settings = JSON.parse(permissions.getFileContent()) as SettingsJson;
    expect(settings.permissions?.allow).toEqual([
      "command(regex:^cat$ ^\\./a[bc]\\.txt$)",
      // A rule that is already an Antigravity regex passes through.
      "command(regex:^ls$ ^-(la|l)$)",
    ]);
    // At the very end, a step that can match a space only adds a trailing one.
    expect(settings.permissions?.deny).toEqual(["command(regex:^git$ ^status[^x]$)"]);
    // Anywhere else it would join two words, so the rule is skipped.
    for (const pattern of ["git[ ]status", "git[!x]status", "git?status"]) {
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(`"${pattern}": "deny"`));
    }
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
    // File targets are paths: a directory covers everything inside it.
    expect(settings.permissions?.allow).toContain("read_file(src)");
    expect(settings.permissions?.deny).toContain("write_file(dist)");
    // edit collapses onto write_file as well.
    expect(settings.permissions?.ask).toContain("write_file(config)");
    // URL targets are domains.
    expect(settings.permissions?.allow).toContain("read_url(example.com)");
  });

  it("should skip a file glob Antigravity cannot express and warn that the deny is not enforced", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: { read: { "**/*.env": "deny", "secrets/**": "deny" } },
      }),
    });

    const permissions = await AntigravityCliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const settings = JSON.parse(permissions.getFileContent()) as SettingsJson;
    // read_file(**/*.env) would be a literal path that matches nothing.
    expect(settings.permissions?.deny).toEqual(["read_file(secrets)"]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"**/*.env": "deny"'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("NOT enforced"));
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
    expect(settings.permissions?.allow).toContain("command(git status)");
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
    expect(settings.permissions?.allow).toContain("read_file(src)");
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
    expect(settings.permissions?.allow).toContain("command(git status)");
  });

  it("should parse settings.json command entries back into canonical bash rules", () => {
    const permissions = new AntigravityCliPermissions({
      outputRoot: testDir,
      relativeDirPath: join(".gemini", "antigravity-cli"),
      relativeFilePath: "settings.json",
      fileContent: JSON.stringify({
        permissions: {
          allow: ["command(git status)", "command(regex:^git$ ^log$ ^.*$ ^--oneline$)"],
          ask: ["command(regex:^cat$ ^\\./a\\.txt$)", "command(regex:^npm$ ^install.*$)"],
          deny: [
            "command(rm -rf)",
            "command(regex:echo rx .*)",
            "command(regex:^ls$ ^-(la|l)$)",
            "command(regex:^rm$ ^/tmp/.$)",
            "command(regex:^echo$ ^\\{yes,no\\}$)",
            "command(regex:^rm$ ^.*\\.env$)",
            "command(regex:^git$ ^.*status.*$)",
            "command(regex:^echo$ ^a\\\\b$)",
            "command(npm run [build])",
            "command(git status *)",
            "command(cat a\\b)",
          ],
        },
      }),
      global: true,
    });

    const json = permissions.toRulesyncPermissions().getJson();
    // A plain target is a prefix, which the canonical form spells `<prefix> *`.
    expect(json.permission.bash?.["git status *"]).toBe("allow");
    expect(json.permission.bash?.["rm -rf *"]).toBe("deny");
    // A per-word regex that only uses `.*`, `.` and escapes reads back as a
    // glob. Extra words still match, so it ends in `*`.
    expect(json.permission.bash?.["cat ./a.txt *"]).toBe("ask");
    expect(json.permission.bash?.["npm install*"]).toBe("ask");
    // Antigravity anchors each word, so `^` and `$` are optional.
    // The `.*` word takes one word, and a glob's `*` already covers the rest.
    expect(json.permission.bash?.["echo rx *"]).toBe("deny");
    // A `.*` word followed by a literal one matches exactly one word, which no
    // glob can say, so it is kept as written. So is any other regex.
    expect(json.permission.bash?.["regex:^git$ ^log$ ^.*$ ^--oneline$"]).toBe("allow");
    expect(json.permission.bash?.["regex:^ls$ ^-(la|l)$"]).toBe("deny");
    // `?` and `{a,b}` mean more in a glob than `.` and `\{a,b\}` do here.
    expect(json.permission.bash?.["regex:^rm$ ^/tmp/.$"]).toBe("deny");
    expect(json.permission.bash?.["regex:^echo$ ^\\{yes,no\\}$"]).toBe("deny");
    // As a glob, `rm *.env *` would also match `rm a b.env`.
    expect(json.permission.bash?.["regex:^rm$ ^.*\\.env$"]).toBe("deny");
    expect(json.permission.bash?.["regex:^git$ ^.*status.*$"]).toBe("deny");
    expect(json.permission.bash?.["regex:^echo$ ^a\\\\b$"]).toBe("deny");
    // A plain target is literal, so glob characters in it import as a regex.
    expect(json.permission.bash?.["regex:^npm$ ^run$ ^\\[build\\]$"]).toBe("deny");
    expect(json.permission.bash?.["regex:^git$ ^status$ ^\\*$"]).toBe("deny");
    // In a glob `\b` is an escaped `b`, so a plain `a\b` imports as a regex too.
    expect(json.permission.bash?.["regex:^cat$ ^a\\\\b$"]).toBe("deny");
    expect(json.permission.bash?.["cat a\\b *"]).toBeUndefined();
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
          bash: {
            "git status *": "allow",
            "rm -rf *": "deny",
            "npm install*": "ask",
            "docker * *": "deny",
            "regex:^ls$ ^-(la|l)$": "ask",
          },
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
    expect(json.permission.bash).toEqual({
      "git status *": "allow",
      "rm -rf *": "deny",
      "npm install*": "ask",
      "docker * *": "deny",
      "regex:^ls$ ^-(la|l)$": "ask",
    });
  });

  it("should load an existing settings.json from disk via fromFile", async () => {
    const dir = join(testDir, ".gemini", "antigravity-cli");
    await ensureDir(dir);
    await writeFileContent(
      join(dir, "settings.json"),
      JSON.stringify({ permissions: { allow: ["command(git status)"] } }),
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
      expect(settings.permissions?.allow).toContain("command(git)");
    });

    it("round-trips the override through import", async () => {
      const dir = join(testDir, ".gemini", "antigravity-cli");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "settings.json"),
        JSON.stringify({
          toolPermission: "always-proceed",
          enableTerminalSandbox: false,
          permissions: { deny: ["command(rm -rf)"] },
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

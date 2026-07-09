import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { KiroPermissions } from "./kiro-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

describe("KiroPermissions", () => {
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

  it("should convert rulesync permissions to Kiro default agent permissions", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: { "git *": "allow", "rm *": "deny" },
          read: { "src/**": "allow", ".env": "deny" },
          write: { "docs/**": "allow" },
          webfetch: { "*": "allow" },
        },
      }),
    });

    const kiroPermissions = await KiroPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const content = JSON.parse(kiroPermissions.getFileContent());
    expect(content.toolsSettings.shell.allowedCommands).toContain("git *");
    expect(content.toolsSettings.shell.deniedCommands).toContain("rm *");
    expect(content.toolsSettings.read.allowedPaths).toContain("src/**");
    expect(content.toolsSettings.read.deniedPaths).toContain(".env");
    expect(content.toolsSettings.write.allowedPaths).toContain("docs/**");
    expect(content.allowedTools).toContain("web_fetch");
  });

  it("should convert Kiro default agent permissions to rulesync format", () => {
    const kiroPermissions = new KiroPermissions({
      outputRoot: testDir,
      relativeDirPath: join(".kiro", "agents"),
      relativeFilePath: "default.json",
      fileContent: JSON.stringify({
        allowedTools: ["web_fetch"],
        toolsSettings: {
          shell: {
            allowedCommands: ["git *"],
            deniedCommands: ["rm *"],
          },
          read: {
            allowedPaths: ["src/**"],
            deniedPaths: [".env"],
          },
          write: {
            allowedPaths: ["docs/**"],
            deniedPaths: ["secrets/**"],
          },
        },
      }),
    });

    const rulesyncPermissions = kiroPermissions.toRulesyncPermissions();
    const json = rulesyncPermissions.getJson();

    expect(json.permission.bash?.["git *"]).toBe("allow");
    expect(json.permission.bash?.["rm *"]).toBe("deny");
    expect(json.permission.read?.["src/**"]).toBe("allow");
    expect(json.permission.read?.[".env"]).toBe("deny");
    expect(json.permission.write?.["docs/**"]).toBe("allow");
    expect(json.permission.write?.["secrets/**"]).toBe("deny");
    expect(json.permission.webfetch?.["*"]).toBe("allow");
  });

  it("should map grep/glob categories to Kiro toolsSettings", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          grep: { "src/**": "allow", "secrets/**": "deny" },
          glob: { "**/*.ts": "allow" },
        },
      }),
    });

    const kiroPermissions = await KiroPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const content = JSON.parse(kiroPermissions.getFileContent());
    expect(content.toolsSettings.grep.allowedPaths).toEqual(["src/**"]);
    expect(content.toolsSettings.grep.deniedPaths).toEqual(["secrets/**"]);
    expect(content.toolsSettings.glob.allowedPaths).toEqual(["**/*.ts"]);
  });

  it("should not emit empty grep/glob tables when unused", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({ permission: { bash: { "git *": "allow" } } }),
    });

    const kiroPermissions = await KiroPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const content = JSON.parse(kiroPermissions.getFileContent());
    expect(content.toolsSettings.grep).toBeUndefined();
    expect(content.toolsSettings.glob).toBeUndefined();
  });

  it("should round-trip grep/glob from Kiro toolsSettings", () => {
    const kiroPermissions = new KiroPermissions({
      outputRoot: testDir,
      relativeDirPath: join(".kiro", "agents"),
      relativeFilePath: "default.json",
      fileContent: JSON.stringify({
        toolsSettings: {
          grep: { allowedPaths: ["src/**"], deniedPaths: ["secrets/**"] },
          glob: { allowedPaths: ["**/*.ts"], deniedPaths: [] },
        },
      }),
    });

    const json = kiroPermissions.toRulesyncPermissions().getJson();
    expect(json.permission.grep).toEqual({ "src/**": "allow", "secrets/**": "deny" });
    expect(json.permission.glob).toEqual({ "**/*.ts": "allow" });
  });

  it("should load existing .kiro/agents/default.json", async () => {
    const kiroDir = join(testDir, ".kiro", "agents");
    await ensureDir(kiroDir);
    await writeFileContent(join(kiroDir, "default.json"), JSON.stringify({ model: "x" }));

    const loaded = await KiroPermissions.fromFile({ outputRoot: testDir });
    expect(loaded).toBeInstanceOf(KiroPermissions);
    expect(JSON.parse(loaded.getFileContent()).model).toBe("x");
  });

  it("should author kiro-scoped toolsSettings (shell flags, aws, web_fetch) from the override", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: { bash: { "git *": "allow" } },
        kiro: {
          toolsSettings: {
            shell: { autoAllowReadonly: true, denyByDefault: false },
            aws: { allowedServices: ["s3"], deniedServices: ["eks"] },
            web_fetch: { trusted: [".*github\\.com.*"], blocked: [".*blocked\\.example\\.com.*"] },
          },
        },
      }),
    });

    const kiroPermissions = await KiroPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const content = JSON.parse(kiroPermissions.getFileContent());
    // The override's shell flags merge WITH the canonical-generated command list.
    expect(content.toolsSettings.shell.allowedCommands).toContain("git *");
    expect(content.toolsSettings.shell.autoAllowReadonly).toBe(true);
    expect(content.toolsSettings.shell.denyByDefault).toBe(false);
    expect(content.toolsSettings.aws).toEqual({
      allowedServices: ["s3"],
      deniedServices: ["eks"],
    });
    expect(content.toolsSettings.web_fetch).toEqual({
      trusted: [".*github\\.com.*"],
      blocked: [".*blocked\\.example\\.com.*"],
    });
  });

  it("must NOT let the kiro override clobber canonical deny lists", async () => {
    // Guard: the override is for non-canonical knobs only. An attempt to author
    // shell.deniedCommands / read.deniedPaths through the override must be ignored so a
    // canonical-generated deny cannot be silently weakened.
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: { "rm *": "deny" },
          read: { ".env": "deny" },
        },
        kiro: {
          toolsSettings: {
            shell: { deniedCommands: [], autoAllowReadonly: true },
            read: { deniedPaths: [] },
          },
        },
      }),
    });

    const kiroPermissions = await KiroPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const content = JSON.parse(kiroPermissions.getFileContent());
    // Canonical denies survive; the override's clobbering leaves/keys are ignored.
    expect(content.toolsSettings.shell.deniedCommands).toEqual(["rm *"]);
    expect(content.toolsSettings.read.deniedPaths).toEqual([".env"]);
    // ...but the legitimate non-canonical shell flag still applies.
    expect(content.toolsSettings.shell.autoAllowReadonly).toBe(true);
  });

  it("should extract kiro-specific toolsSettings into the kiro override on import", () => {
    const kiroPermissions = new KiroPermissions({
      outputRoot: testDir,
      relativeDirPath: join(".kiro", "agents"),
      relativeFilePath: "default.json",
      fileContent: JSON.stringify({
        toolsSettings: {
          shell: {
            allowedCommands: ["git *"],
            deniedCommands: ["rm *"],
            autoAllowReadonly: true,
            denyByDefault: true,
          },
          aws: { allowedServices: ["s3"], deniedServices: ["eks"] },
          web_fetch: { trusted: [".*github\\.com.*"] },
        },
      }),
    });

    const json = kiroPermissions.toRulesyncPermissions().getJson();
    // Canonical command lists still drive the bash category.
    expect(json.permission.bash).toEqual({ "git *": "allow", "rm *": "deny" });
    // Non-canonical shell flags + aws + web_fetch round-trip through the override.
    expect(json.kiro?.toolsSettings).toEqual({
      shell: { autoAllowReadonly: true, denyByDefault: true },
      aws: { allowedServices: ["s3"], deniedServices: ["eks"] },
      web_fetch: { trusted: [".*github\\.com.*"] },
    });
  });

  it("should omit the kiro override when no kiro-specific toolsSettings are present", () => {
    const kiroPermissions = new KiroPermissions({
      outputRoot: testDir,
      relativeDirPath: join(".kiro", "agents"),
      relativeFilePath: "default.json",
      fileContent: JSON.stringify({
        toolsSettings: { shell: { allowedCommands: ["git *"] } },
      }),
    });

    const json = kiroPermissions.toRulesyncPermissions().getJson();
    expect(json.permission.bash).toEqual({ "git *": "allow" });
    expect(json.kiro).toBeUndefined();
  });

  it("should preserve existing shell auto-trust flags across regenerate without an override", async () => {
    const kiroDir = join(testDir, ".kiro", "agents");
    await ensureDir(kiroDir);
    await writeFileContent(
      join(kiroDir, "default.json"),
      JSON.stringify({
        toolsSettings: { shell: { allowedCommands: ["old"], autoAllowReadonly: true } },
      }),
    );

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({ permission: { bash: { "git *": "allow" } } }),
    });

    const kiroPermissions = await KiroPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const content = JSON.parse(kiroPermissions.getFileContent());
    // The canonical list is regenerated, but the hand-set flag is not dropped.
    expect(content.toolsSettings.shell.allowedCommands).toEqual(["git *"]);
    expect(content.toolsSettings.shell.autoAllowReadonly).toBe(true);
  });

  it("should round-trip kiro override: import then re-generate keeps the specific surfaces", async () => {
    const source = new KiroPermissions({
      outputRoot: testDir,
      relativeDirPath: join(".kiro", "agents"),
      relativeFilePath: "default.json",
      fileContent: JSON.stringify({
        toolsSettings: {
          shell: { allowedCommands: ["git *"], denyByDefault: true },
          aws: { deniedServices: ["eks"] },
        },
      }),
    });
    const imported = source.toRulesyncPermissions().getJson();

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify(imported),
    });
    const regenerated = await KiroPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const content = JSON.parse(regenerated.getFileContent());
    expect(content.toolsSettings.shell.allowedCommands).toEqual(["git *"]);
    expect(content.toolsSettings.shell.denyByDefault).toBe(true);
    expect(content.toolsSettings.aws).toEqual({ deniedServices: ["eks"] });
  });

  it("should remove web tools from allowedTools when denied", async () => {
    const kiroDir = join(testDir, ".kiro", "agents");
    await ensureDir(kiroDir);
    await writeFileContent(
      join(kiroDir, "default.json"),
      JSON.stringify({
        allowedTools: ["web_fetch", "web_search", "read"],
      }),
    );

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          webfetch: { "*": "deny" },
          websearch: { "*": "deny" },
        },
      }),
    });

    const kiroPermissions = await KiroPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const content = JSON.parse(kiroPermissions.getFileContent());
    expect(content.allowedTools).toEqual(["read"]);
  });
});

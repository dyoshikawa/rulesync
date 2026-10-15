import { join } from "node:path";

import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { KiroCapabilityPermissions, KiroScopedPermissions } from "./kiro-capability-permissions.js";
import { KiroPermissions } from "./kiro-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

function rulesyncPermissions(config: Record<string, unknown>): RulesyncPermissions {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify(config),
  });
}

describe("KiroCapabilityPermissions", () => {
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

  const permissionsPath = (): string => join(testDir, ".kiro", "settings", "permissions.yaml");

  it("targets ~/.kiro/settings/permissions.yaml", () => {
    expect(KiroCapabilityPermissions.getSettablePaths()).toEqual({
      relativeDirPath: join(".kiro", "settings"),
      relativeFilePath: "permissions.yaml",
    });
  });

  it("is never deletable and is not created for an empty payload", () => {
    const perms = KiroCapabilityPermissions.forDeletion({
      relativeDirPath: join(".kiro", "settings"),
      relativeFilePath: "permissions.yaml",
    });
    expect(perms.isDeletable()).toBe(false);
    expect(perms.shouldSkipCreationWhenPayloadEmpty()).toBe(true);
  });

  it("maps canonical categories to capability rules, keeping ask", async () => {
    const logger = createMockLogger();
    const perms = await KiroCapabilityPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: rulesyncPermissions({
        permission: {
          bash: { "*": "ask", "git status *": "allow", "rm *": "deny" },
          edit: { "src/**": "allow" },
          write: { "src/**": "allow", "**/*.pem": "deny" },
          read: { "*": "allow" },
          webfetch: { "*": "deny" },
          websearch: { "*": "allow" },
          grep: { "*": "allow" },
        },
      }),
    });

    expect(load(perms.getFileContent())).toEqual({
      rules: [
        { capability: "shell", effect: "ask" },
        { capability: "shell", match: ["git status *"], effect: "allow" },
        { capability: "shell", match: ["rm *"], effect: "deny" },
        { capability: "fs_write", match: ["src/**"], effect: "allow" },
        { capability: "fs_write", match: ["**/*.pem"], effect: "deny" },
        { capability: "fs_read", effect: "allow" },
        { capability: "web_fetch", effect: "deny" },
        { capability: "web_search", effect: "allow" },
      ],
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Kiro permissions.yaml has no capability for category: grep. Skipping.",
    );
  });

  it("groups patterns sharing a capability and effect into one match list", async () => {
    const perms = await KiroCapabilityPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissions({
        permission: { bash: { "git *": "allow", "npm *": "allow" } },
      }),
    });
    expect(load(perms.getFileContent())).toEqual({
      rules: [{ capability: "shell", match: ["git *", "npm *"], effect: "allow" }],
    });
  });

  it("keeps rules rulesync does not emit and replaces only re-emitted patterns", async () => {
    await writeFileContent(
      permissionsPath(),
      [
        "version: 1",
        "rules:",
        "  - capability: shell",
        "    match: ['rm -rf *']",
        "    effect: deny",
        "  - capability: shell",
        "    match: ['ls *', 'git *']",
        "    effect: ask",
        "  - capability: fs_read",
        "    effect: allow",
        "  - capability: web_fetch",
        "    match: ['https://example.com/*']",
        "    effect: allow",
        "  - capability: shell",
        "    match: ['npm *']",
        "    exclude: ['npm publish*']",
        "    effect: allow",
        "  - capability: mcp",
        "    match: ['github/*']",
        "    effect: deny",
        "",
      ].join("\n"),
    );

    const generate = async (): Promise<KiroCapabilityPermissions> => {
      const perms = await KiroCapabilityPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ permission: { bash: { "git *": "allow" } } }),
      });
      await writeFileContent(permissionsPath(), perms.getFileContent());
      return perms;
    };

    const first = await generate();
    expect(load(first.getFileContent())).toEqual({
      version: 1,
      rules: [
        { capability: "shell", match: ["rm -rf *"], effect: "deny" },
        { capability: "shell", match: ["ls *"], effect: "ask" },
        { capability: "fs_read", effect: "allow" },
        { capability: "web_fetch", match: ["https://example.com/*"], effect: "allow" },
        { capability: "shell", match: ["npm *"], exclude: ["npm publish*"], effect: "allow" },
        { capability: "mcp", match: ["github/*"], effect: "deny" },
        { capability: "shell", match: ["git *"], effect: "allow" },
      ],
    });

    // Rerunning generate is idempotent.
    const second = await generate();
    expect(load(second.getFileContent())).toEqual(load(first.getFileContent()));
  });

  it("keeps every existing rule when rulesync has no Kiro-mapped rules", async () => {
    const existing = [
      "rules:",
      "  - capability: shell",
      "    match: ['rm -rf *']",
      "    effect: deny",
      "  - capability: shell",
      "    effect: allow",
      "",
    ].join("\n");
    await writeFileContent(permissionsPath(), existing);

    const perms = await KiroCapabilityPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissions({ permission: { grep: { "*": "allow" } } }),
    });
    expect(load(perms.getFileContent())).toEqual(load(existing));
  });

  it("replaces a match-less rule only when rulesync emits the catch-all", async () => {
    await writeFileContent(permissionsPath(), "rules:\n  - capability: fs_read\n    effect: ask\n");
    const perms = await KiroCapabilityPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissions({ permission: { read: { "*": "allow" } } }),
    });
    expect(load(perms.getFileContent())).toEqual({
      rules: [{ capability: "fs_read", effect: "allow" }],
    });
  });

  it("warns on workspace-relative filesystem patterns", async () => {
    const logger = createMockLogger();
    await KiroCapabilityPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: rulesyncPermissions({
        permission: {
          read: { "*": "allow", "/etc/**": "deny", "~/.ssh/**": "deny", "**/*.pem": "deny" },
          edit: { "src/**": "allow" },
          bash: { "git *": "allow" },
        },
      }),
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('edit pattern "src/**"'));
  });

  it("writes nothing when there is no file and no rule maps", async () => {
    const perms = await KiroCapabilityPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissions({ permission: {} }),
    });
    expect(perms.getFileContent()).toBe("");
  });

  it("warns that the kiro toolsSettings override does not apply", async () => {
    const logger = createMockLogger();
    await KiroCapabilityPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: rulesyncPermissions({
        permission: {},
        kiro: { toolsSettings: { shell: { autoAllowReadonly: true } } },
      }),
    });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("kiro.toolsSettings"));
  });

  it("rejects an existing file whose rules is not a list", async () => {
    await writeFileContent(permissionsPath(), "rules: nope\n");
    await expect(
      KiroCapabilityPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ permission: {} }),
      }),
    ).rejects.toThrow("'rules' is not a list");
  });

  it("imports managed rules, keeping the stricter effect on overlap", async () => {
    await writeFileContent(
      permissionsPath(),
      [
        "rules:",
        "  - capability: shell",
        "    match: ['git *', 'rm *']",
        "    effect: allow",
        "  - capability: shell",
        "    match: ['rm *']",
        "    effect: deny",
        "  - capability: fs_read",
        "    effect: ask",
        "  - capability: fs_write",
        "    match: ['src/**']",
        "    effect: allow",
        "  - capability: web_fetch",
        "    effect: allow",
        "  - capability: web_search",
        "    effect: deny",
        "  - capability: shell",
        "    match: ['npm *']",
        "    exclude: ['npm publish*']",
        "    effect: allow",
        "  - capability: mcp",
        "    effect: allow",
        "  - capability: shell",
        "    effect: bogus",
        "",
      ].join("\n"),
    );

    const perms = await KiroCapabilityPermissions.fromFile({ outputRoot: testDir });
    expect(perms.toRulesyncPermissions().getJson().permission).toEqual({
      bash: { "git *": "allow", "rm *": "deny" },
      read: { "*": "ask" },
      write: { "src/**": "allow" },
      webfetch: { "*": "allow" },
      websearch: { "*": "deny" },
    });
  });

  it("imports an empty permission block from a missing file", async () => {
    const perms = await KiroCapabilityPermissions.fromFile({ outputRoot: testDir });
    expect(perms.toRulesyncPermissions().getJson().permission).toEqual({});
  });
});

describe("KiroScopedPermissions", () => {
  it("uses the agent config in project scope and permissions.yaml in global scope", () => {
    expect(KiroScopedPermissions.getSettablePaths()).toEqual(KiroPermissions.getSettablePaths());
    expect(KiroScopedPermissions.getSettablePaths({ global: true })).toEqual(
      KiroCapabilityPermissions.getSettablePaths(),
    );
    expect(
      KiroScopedPermissions.forDeletion({
        relativeDirPath: join(".kiro", "settings"),
        relativeFilePath: "permissions.yaml",
        global: true,
      }),
    ).toBeInstanceOf(KiroCapabilityPermissions);
    expect(
      KiroScopedPermissions.forDeletion({
        relativeDirPath: join(".kiro", "agents"),
        relativeFilePath: "default.json",
      }),
    ).toBeInstanceOf(KiroPermissions);
  });
});

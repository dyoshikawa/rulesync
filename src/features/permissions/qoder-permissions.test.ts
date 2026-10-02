import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { QoderPermissions } from "./qoder-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

const SETTINGS_DIR = ".qoder";
const SETTINGS_FILE = "settings.json";

function createRulesyncPermissions(permission: Record<string, Record<string, string>>) {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify({ permission }),
    validate: true,
  });
}

async function writeSettings(testDir: string, settings: unknown): Promise<void> {
  await ensureDir(join(testDir, SETTINGS_DIR));
  await writeFileContent(
    join(testDir, SETTINGS_DIR, SETTINGS_FILE),
    typeof settings === "string" ? settings : JSON.stringify(settings, null, 2),
  );
}

async function generate(
  testDir: string,
  permission: Record<string, Record<string, string>>,
  logger = createMockLogger(),
): Promise<Record<string, unknown>> {
  const permissions = await QoderPermissions.fromRulesyncPermissions({
    outputRoot: testDir,
    rulesyncPermissions: createRulesyncPermissions(permission),
    logger,
  });
  return JSON.parse(permissions.getFileContent());
}

function importFrom(testDir: string, settings: unknown) {
  return new QoderPermissions({
    outputRoot: testDir,
    relativeDirPath: SETTINGS_DIR,
    relativeFilePath: SETTINGS_FILE,
    fileContent: JSON.stringify(settings),
  })
    .toRulesyncPermissions()
    .getJson().permission;
}

describe("QoderPermissions", () => {
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

  it("uses .qoder/settings.json for both scopes", () => {
    const expected = { relativeDirPath: SETTINGS_DIR, relativeFilePath: SETTINGS_FILE };
    expect(QoderPermissions.getSettablePaths()).toEqual(expected);
    expect(QoderPermissions.getSettablePaths({ global: true })).toEqual(expected);
  });

  it("is never deletable", () => {
    expect(
      QoderPermissions.forDeletion({
        outputRoot: testDir,
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: SETTINGS_FILE,
      }).isDeletable(),
    ).toBe(false);
  });

  describe("fromRulesyncPermissions", () => {
    it("writes allow / ask / deny lists with Qoder tool names", async () => {
      const settings = await generate(testDir, {
        bash: { "git status": "allow", "npm run test:*": "allow", "git push *": "ask" },
        read: { "*": "allow", "*.pem": "deny" },
        edit: { "/src/**": "allow" },
        webfetch: { "*": "ask" },
        websearch: { "*": "deny" },
        agent: { explore: "allow", "code-review": "deny" },
      });

      expect(settings).toEqual({
        permissions: {
          allow: [
            "Bash(git status)",
            "Bash(npm run test:*)",
            "Read",
            "Edit(/src/**)",
            "Agent(explore)",
          ],
          ask: ["Bash(git push *)", "WebFetch"],
          deny: ["Read(*.pem)", "WebSearch", "Agent(code-review)"],
        },
      });
    });

    it("writes path-scoped write and glob rules in the Edit / Read form", async () => {
      const settings = await generate(testDir, {
        write: { "*": "allow", "/dist/**": "deny" },
        glob: { "*": "allow", "/secrets/**": "deny" },
        grep: { "*": "allow" },
      });

      expect(settings.permissions).toEqual({
        allow: ["Write", "Glob", "Grep"],
        deny: ["Edit(/dist/**)", "Read(/secrets/**)"],
      });
    });

    it("keeps the stricter action when two rules collapse onto one entry", async () => {
      const settings = await generate(testDir, {
        edit: { "/src/**": "allow" },
        write: { "/src/**": "deny" },
      });

      expect(settings.permissions).toEqual({ deny: ["Edit(/src/**)"] });
    });

    it("writes MCP tool names and the all-tools rule", async () => {
      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, "warn");
      const settings = await generate(
        testDir,
        {
          "*": { "*": "ask", "rm -rf *": "deny" },
          mcp__github__create_issue: { "*": "ask" },
          mcp__context7__: { "*": "allow" },
          "mcp__*": { "*": "deny", "some-arg": "allow" },
        },
        logger,
      );

      expect(settings.permissions).toEqual({
        allow: ["mcp__context7__"],
        ask: ["*", "mcp__github__create_issue"],
        deny: ["mcp__*"],
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("all-tools '*' rule 'rm -rf *'"),
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("'mcp__*' rule 'some-arg'"));
    });

    it("skips categories Qoder has no rule for", async () => {
      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, "warn");
      const settings = await generate(
        testDir,
        { bash: { "*": "allow" }, notebookedit: { "*": "deny" } },
        logger,
      );

      expect(settings.permissions).toEqual({ allow: ["Bash"] });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("'notebookedit' category"));
    });

    it("keeps unrelated settings, sibling permission keys and unmanaged entries", async () => {
      await writeSettings(testDir, {
        model: "auto",
        hooks: { Stop: [] },
        permissions: {
          additionalDirectories: ["../shared"],
          trustDirectories: ["~/work"],
          allow: ["Bash(old command)", "NotebookEdit", "mcp__github__list_issues", "Read"],
          deny: ["WebFetch"],
        },
      });

      const settings = await generate(testDir, {
        bash: { "npm test": "allow" },
        read: { "*": "deny" },
      });

      expect(settings).toEqual({
        model: "auto",
        hooks: { Stop: [] },
        permissions: {
          additionalDirectories: ["../shared"],
          trustDirectories: ["~/work"],
          allow: ["NotebookEdit", "mcp__github__list_issues", "Bash(npm test)"],
          deny: ["WebFetch", "Read"],
        },
      });
    });

    it("removes the permissions key when nothing is left", async () => {
      await writeSettings(testDir, { model: "auto", permissions: { allow: ["Bash(ls)"] } });

      const settings = await generate(testDir, { bash: {} });

      expect(settings).toEqual({ model: "auto" });
    });

    it("throws on an unparseable settings file", async () => {
      await writeSettings(testDir, "{ invalid");

      await expect(generate(testDir, { bash: { "*": "allow" } })).rejects.toThrow();
    });
  });

  describe("fromFile", () => {
    it("loads the settings file in global mode", async () => {
      await writeSettings(testDir, { permissions: { allow: ["Read"] } });

      const permissions = await QoderPermissions.fromFile({ outputRoot: testDir, global: true });

      expect(permissions.getRelativeDirPath()).toBe(SETTINGS_DIR);
      expect(JSON.parse(permissions.getFileContent())).toEqual({
        permissions: { allow: ["Read"] },
      });
    });

    it("falls back to an empty object when the file is missing", async () => {
      const permissions = await QoderPermissions.fromFile({ outputRoot: testDir });

      expect(permissions.getFileContent()).toBe("{}");
    });
  });

  describe("toRulesyncPermissions", () => {
    it("imports Qoder rules into canonical categories", () => {
      const permission = importFrom(testDir, {
        permissions: {
          additionalDirectories: ["../shared"],
          allow: [
            "Bash(git log:*)",
            "Read(/src/**)",
            "Edit(*)",
            "Agent(explore)",
            "mcp__context7__*",
            "NotebookEdit",
            "Unknown(",
          ],
          ask: ["WebFetch", "*"],
          deny: ["Bash(rm -rf:*)", "WebSearch", "mcp__github__create_issue"],
        },
      });

      expect(permission).toEqual({
        bash: { "git log:*": "allow", "rm -rf:*": "deny" },
        read: { "/src/**": "allow" },
        edit: { "*": "allow" },
        agent: { explore: "allow" },
        "mcp__context7__*": { "*": "allow" },
        webfetch: { "*": "ask" },
        "*": { "*": "ask" },
        websearch: { "*": "deny" },
        mcp__github__create_issue: { "*": "deny" },
      });
    });

    it("keeps the stricter action for a rule listed twice", () => {
      const permission = importFrom(testDir, {
        permissions: { allow: ["Bash(npm test)"], deny: ["Bash(npm test)"] },
      });

      expect(permission).toEqual({ bash: { "npm test": "deny" } });
    });

    it("round-trips generated rules", async () => {
      const source = {
        bash: { "git status": "allow", "rm -rf:*": "deny" },
        read: { "/src/**": "allow" },
        "mcp__github__*": { "*": "ask" },
      };
      await writeSettings(testDir, await generate(testDir, source));

      const permissions = await QoderPermissions.fromFile({ outputRoot: testDir });

      expect(permissions.toRulesyncPermissions().getJson().permission).toEqual(source);
    });
  });
});

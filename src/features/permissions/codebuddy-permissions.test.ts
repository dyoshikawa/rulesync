import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CodebuddyPermissions } from "./codebuddy-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

const SETTINGS_DIR = ".codebuddy";
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
  const permissions = await CodebuddyPermissions.fromRulesyncPermissions({
    outputRoot: testDir,
    rulesyncPermissions: createRulesyncPermissions(permission),
    logger,
  });
  return JSON.parse(permissions.getFileContent());
}

function importFrom(testDir: string, settings: unknown) {
  return new CodebuddyPermissions({
    outputRoot: testDir,
    relativeDirPath: SETTINGS_DIR,
    relativeFilePath: SETTINGS_FILE,
    fileContent: JSON.stringify(settings),
  })
    .toRulesyncPermissions()
    .getJson().permission;
}

describe("CodebuddyPermissions", () => {
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

  it("uses .codebuddy/settings.json for both scopes", () => {
    const expected = { relativeDirPath: SETTINGS_DIR, relativeFilePath: SETTINGS_FILE };
    expect(CodebuddyPermissions.getSettablePaths()).toEqual(expected);
    expect(CodebuddyPermissions.getSettablePaths({ global: true })).toEqual(expected);
  });

  it("is never deletable", () => {
    const permissions = CodebuddyPermissions.forDeletion({
      outputRoot: testDir,
      relativeDirPath: SETTINGS_DIR,
      relativeFilePath: SETTINGS_FILE,
    });
    expect(permissions.isDeletable()).toBe(false);
  });

  describe("fromRulesyncPermissions", () => {
    it("maps categories to Claude-style CodeBuddy rules", async () => {
      const settings = await generate(testDir, {
        bash: { "*": "ask", "git:*": "allow", "npm test": "allow", "rm *": "deny" },
        read: { "*": "allow", "./.env": "deny" },
        edit: { "src/**": "allow" },
        webfetch: { "domain:example.com": "allow" },
        agent: { Explore: "allow" },
        mcp__github: { "*": "allow" },
        TaskCreate: { "*": "deny" },
      });

      expect(settings).toEqual({
        permissions: {
          allow: [
            "Bash(git:*)",
            "Bash(npm test)",
            "Read",
            "Edit(src/**)",
            "WebFetch(domain:example.com)",
            "Agent(Explore)",
            "mcp__github",
          ],
          ask: ["Bash"],
          deny: ["Bash(rm *)", "Read(./.env)", "TaskCreate"],
        },
      });
    });

    it("maps the mcp category to mcp__ rules and never allows mcp__*", async () => {
      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, "warn");

      const denied = await generate(testDir, { mcp: { "*": "deny", github: "allow" } }, logger);
      expect(denied).toEqual({
        permissions: { allow: ["mcp__github"], deny: ["mcp__*"] },
      });

      const allowed = await generate(testDir, { mcp: { "*": "allow" } }, logger);
      expect(allowed).toEqual({});
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("'mcp__*'"));
    });

    it("skips specifiers on scoped MCP categories", async () => {
      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, "warn");

      const settings = await generate(testDir, { mcp__github: { "repo:*": "allow" } }, logger);

      expect(settings).toEqual({});
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("take no specifier"));
    });

    it("writes the all-tools catch-all as the standalone * rule", async () => {
      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, "warn");

      const settings = await generate(testDir, { "*": { "*": "ask", "rm -rf *": "deny" } }, logger);

      expect(settings).toEqual({ permissions: { ask: ["*"] } });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("'rm -rf *'"));
    });

    it("keeps the stricter action when two rules collapse onto one entry", async () => {
      const settings = await generate(testDir, {
        bash: { "*": "allow" },
        Bash: { "*": "deny" },
      });

      expect(settings).toEqual({ permissions: { deny: ["Bash"] } });
    });

    it("keeps unmanaged entries and sibling settings", async () => {
      await writeSettings(testDir, {
        model: "gpt-5",
        hooks: { Stop: [] },
        permissions: {
          defaultMode: "acceptEdits",
          additionalDirectories: ["../shared"],
          allow: ["Bash(old)", "WebSearch", "Grep("],
          deny: ["Read(./secrets/**)"],
        },
      });

      const settings = await generate(testDir, { bash: { "npm test": "allow" } });

      expect(settings).toEqual({
        model: "gpt-5",
        hooks: { Stop: [] },
        permissions: {
          defaultMode: "acceptEdits",
          additionalDirectories: ["../shared"],
          allow: ["WebSearch", "Grep(", "Bash(npm test)"],
          deny: ["Read(./secrets/**)"],
        },
      });
    });

    it("throws on an unparseable settings file", async () => {
      await writeSettings(testDir, "{ nope");

      await expect(generate(testDir, { bash: { "*": "allow" } })).rejects.toThrow(
        /Failed to parse/,
      );
    });
  });

  describe("toRulesyncPermissions", () => {
    it("maps CodeBuddy rules back to canonical categories", () => {
      const permission = importFrom(testDir, {
        permissions: {
          defaultMode: "plan",
          allow: ["Bash(git:*)", "Read", "WebFetch(domain:example.com)", "mcp__github", "*"],
          ask: ["Bash", "Skill(deploy)"],
          deny: ["Read(./.env)", "mcp__*", "Bash()", "Grep(", 42],
        },
      });

      expect(permission).toEqual({
        bash: { "git:*": "allow", "*": "ask" },
        read: { "*": "allow", "./.env": "deny" },
        webfetch: { "domain:example.com": "allow" },
        mcp__github: { "*": "allow" },
        "*": { "*": "allow" },
        skill: { deploy: "ask" },
        mcp: { "*": "deny" },
      });
    });

    it("keeps the stricter action for a rule listed twice", () => {
      const permission = importFrom(testDir, {
        permissions: { allow: ["Bash(rm:*)"], ask: ["Bash(rm:*)"], deny: ["Bash(rm:*)"] },
      });

      expect(permission).toEqual({ bash: { "rm:*": "deny" } });
    });

    it("returns an empty block for a file without permissions", () => {
      expect(importFrom(testDir, { model: "gpt-5" })).toEqual({});
    });

    it("round-trips through generate and import", async () => {
      const config = {
        bash: { "npm test": "allow", "rm *": "deny" },
        read: { "*": "allow" },
        mcp: { "*": "ask" },
        mcp__github: { "*": "allow" },
      };
      const settings = await generate(testDir, config);

      expect(importFrom(testDir, settings)).toEqual(config);
    });
  });
});

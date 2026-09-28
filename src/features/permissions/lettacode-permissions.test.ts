import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { LettacodePermissions } from "./lettacode-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

const SETTINGS_DIR = ".letta";
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
  const permissions = await LettacodePermissions.fromRulesyncPermissions({
    outputRoot: testDir,
    rulesyncPermissions: createRulesyncPermissions(permission),
    logger,
  });
  return JSON.parse(permissions.getFileContent());
}

describe("LettacodePermissions", () => {
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

  it("uses .letta/settings.json for both scopes", () => {
    const expected = { relativeDirPath: SETTINGS_DIR, relativeFilePath: SETTINGS_FILE };
    expect(LettacodePermissions.getSettablePaths()).toEqual(expected);
    expect(LettacodePermissions.getSettablePaths({ global: true })).toEqual(expected);
  });

  describe("fromRulesyncPermissions", () => {
    it("maps categories to Letta Code rules and ask to alwaysAsk", async () => {
      const settings = await generate(testDir, {
        bash: { "*": "ask", "git *": "allow", "npm test": "allow", "rm *": "deny" },
        read: { "*": "allow", ".env": "deny" },
        edit: { "src/**": "allow" },
        write: { "dist/**": "deny" },
        glob: { "*": "allow" },
        grep: { "*": "allow" },
      });

      expect(settings).toEqual({
        permissions: {
          allow: ["Bash(git:*)", "Bash(npm test)", "Read", "Edit(src/**)", "Glob", "Grep"],
          alwaysAsk: ["Bash"],
          deny: ["Bash(rm:*)", "Read(.env)", "Write(dist/**)"],
        },
      });
    });

    it("drops an allow with an inner '*' and widens a restriction to its prefix", async () => {
      const logger = createMockLogger();
      const settings = await generate(
        testDir,
        { bash: { "npm run * --watch": "allow", "git push * --force": "deny" } },
        logger,
      );

      expect(settings).toEqual({ permissions: { deny: ["Bash(git push:*)"] } });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("npm run * --watch"));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Bash(git push:*)"));
    });

    it("keeps the stricter action when two rules collapse onto one entry", async () => {
      const settings = await generate(testDir, { bash: { "git *": "allow", "git*": "deny" } });
      expect(settings).toEqual({ permissions: { deny: ["Bash(git:*)"] } });
    });

    it("skips categories Letta Code cannot express and honors '*' restrictions on Bash", async () => {
      const logger = createMockLogger();
      const settings = await generate(
        testDir,
        { webfetch: { "*": "allow" }, "*": { "sudo *": "deny" }, bash: { ls: "allow" } },
        logger,
      );

      expect(settings).toEqual({ permissions: { allow: ["Bash(ls)"], deny: ["Bash(sudo:*)"] } });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("'webfetch'"));
    });

    it("preserves sibling keys and entries for unmanaged tool families", async () => {
      await writeSettings(testDir, {
        model: "auto",
        permissions: {
          mode: "acceptEdits",
          additionalDirectories: ["../shared"],
          allow: ["Task", "Bash(old)", "Read(docs/**)", "shell(ls)"],
          ask: ["Bash(make)"],
          deny: ["ListDir(secret)"],
        },
      });

      const settings = await generate(testDir, { bash: { "npm test": "allow" } });

      expect(settings).toEqual({
        model: "auto",
        permissions: {
          mode: "acceptEdits",
          additionalDirectories: ["../shared"],
          allow: ["Task", "Read(docs/**)", "Bash(npm test)"],
          deny: ["ListDir(secret)"],
        },
      });
    });

    it("does not add a permissions key when nothing is generated", async () => {
      await writeSettings(testDir, { model: "auto" });
      expect(await generate(testDir, {})).toEqual({ model: "auto" });
    });

    it("refuses to overwrite an unparseable settings file", async () => {
      await writeSettings(testDir, "{ not json");
      await expect(generate(testDir, { bash: { ls: "allow" } })).rejects.toThrow(
        /Failed to parse Letta Code settings/,
      );
    });
  });

  describe("toRulesyncPermissions", () => {
    it("imports every list, reading aliases and prefix rules back", async () => {
      await writeSettings(testDir, {
        permissions: {
          mode: "default",
          allow: ["Bash(git:*)", "Read", "shell(ls)", "Task", "Edit(src/**)"],
          ask: ["Grep(secret/**)"],
          alwaysAsk: ["Bash"],
          deny: ["Bash(rm:*)", "Bash(git:*)", "Write()"],
        },
      });

      const permissions = await LettacodePermissions.fromFile({ outputRoot: testDir });
      expect(permissions.toRulesyncPermissions().getJson().permission).toEqual({
        bash: { "git *": "deny", ls: "allow", "*": "ask", "rm *": "deny" },
        read: { "*": "allow" },
        edit: { "src/**": "allow" },
        grep: { "secret/**": "ask" },
      });
    });

    it("round-trips generated rules", async () => {
      const source = {
        bash: { "*": "ask", "git *": "allow", "npm test": "allow" },
        read: { ".env": "deny" },
      };
      const generated = await LettacodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: createRulesyncPermissions(source),
      });
      expect(generated.toRulesyncPermissions().getJson().permission).toEqual(source);
    });
  });
});

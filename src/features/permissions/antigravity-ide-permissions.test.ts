import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AntigravityIdePermissions } from "./antigravity-ide-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

function rulesyncPermissions(
  permission: Record<string, Record<string, string>>,
): RulesyncPermissions {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify({ permission }),
  });
}

describe("AntigravityIdePermissions", () => {
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
    it("targets the workspace .antigravity/settings.json", () => {
      const paths = AntigravityIdePermissions.getSettablePaths();
      expect(paths.relativeDirPath).toBe(".antigravity");
      expect(paths.relativeFilePath).toBe("settings.json");
    });
  });

  describe("isDeletable", () => {
    it("is never deletable (shared workspace settings)", () => {
      const perms = new AntigravityIdePermissions({
        relativeDirPath: ".antigravity",
        relativeFilePath: "settings.json",
        fileContent: "{}",
        validate: false,
      });
      expect(perms.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("maps canonical categories to IDE action(target) entries", async () => {
      const perms = await AntigravityIdePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          read: { "src/**": "allow" },
          write: { "src/**": "allow" },
          bash: { "git *": "allow", "rm *": "deny", "*": "ask" },
          webfetch: { "example.com": "allow" },
          mcp: { "linter/*": "allow" },
        }),
      });

      const json = JSON.parse(perms.getFileContent());
      expect(json.permissions.allow).toEqual(
        expect.arrayContaining([
          "read_file(src/**)",
          "write_file(src/**)",
          "command(git *)",
          "read_url(example.com)",
          "mcp(linter/*)",
        ]),
      );
      expect(json.permissions.deny).toContain("command(rm *)");
      expect(json.permissions.ask).toContain("command");
    });

    it("uses a bare action name for the catch-all '*' pattern", async () => {
      const perms = await AntigravityIdePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "*": "ask" } }),
      });
      const json = JSON.parse(perms.getFileContent());
      expect(json.permissions.ask).toEqual(["command"]);
    });

    it("preserves existing entries for unmanaged actions and other settings", async () => {
      const dir = join(testDir, ".antigravity");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "settings.json"),
        JSON.stringify({
          "antigravity.someSetting": true,
          permissions: { allow: ["execute_url(localhost)"], deny: ["unsandboxed"] },
        }),
      );

      const perms = await AntigravityIdePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "git *": "allow" } }),
      });
      const json = JSON.parse(perms.getFileContent());

      expect(json["antigravity.someSetting"]).toBe(true);
      expect(json.permissions.allow).toContain("execute_url(localhost)");
      expect(json.permissions.allow).toContain("command(git *)");
      expect(json.permissions.deny).toContain("unsandboxed");
    });
  });

  describe("toRulesyncPermissions round-trip", () => {
    it("maps IDE actions back to canonical categories", () => {
      const perms = new AntigravityIdePermissions({
        outputRoot: testDir,
        relativeDirPath: ".antigravity",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          permissions: {
            allow: ["read_file(src/**)", "write_file(src/**)", "command(git *)", "read_url(x.com)"],
            deny: ["command(rm *)"],
            ask: ["mcp(server/*)"],
          },
        }),
      });

      const config = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(config.permission.read["src/**"]).toBe("allow");
      expect(config.permission.write["src/**"]).toBe("allow");
      expect(config.permission.bash["git *"]).toBe("allow");
      expect(config.permission.bash["rm *"]).toBe("deny");
      expect(config.permission.webfetch["x.com"]).toBe("allow");
      expect(config.permission.mcp["server/*"]).toBe("ask");
    });

    it("round-trips patterns containing parentheses", () => {
      const perms = new AntigravityIdePermissions({
        outputRoot: testDir,
        relativeDirPath: ".antigravity",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          permissions: { allow: ["command(npm run (build|test))"] },
        }),
      });
      const config = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(config.permission.bash["npm run (build|test)"]).toBe("allow");
    });
  });
});

import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { GrokcliPermissions } from "./grokcli-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

const makeRulesyncPermissions = (permission: Record<string, Record<string, string>>) =>
  new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify({ permission }),
  });

const readMode = (content: string): unknown => {
  const parsed = smolToml.parse(content);
  const ui = parsed.ui as Record<string, unknown> | undefined;
  return ui?.permission_mode;
};

describe("GrokcliPermissions", () => {
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
    it("writes to .grok/config.toml", () => {
      expect(GrokcliPermissions.getSettablePaths()).toEqual({
        relativeDirPath: ".grok",
        relativeFilePath: "config.toml",
      });
    });
  });

  describe("fromRulesyncPermissions (generate)", () => {
    it("collapses any deny/ask rule to permission_mode = ask", async () => {
      const permissions = await GrokcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          bash: { "*": "allow", "rm *": "deny" },
        }),
        global: true,
      });

      expect(readMode(permissions.getFileContent())).toBe("ask");
    });

    it("maps an all-allow config to permission_mode = always-approve", async () => {
      const permissions = await GrokcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({
          bash: { "*": "allow" },
          edit: { "*": "allow" },
        }),
        global: true,
      });

      expect(readMode(permissions.getFileContent())).toBe("always-approve");
    });

    it("defaults an empty config to permission_mode = ask", async () => {
      const permissions = await GrokcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({}),
        global: true,
      });

      expect(readMode(permissions.getFileContent())).toBe("ask");
    });

    it("preserves other config.toml keys (non-destructive merge)", async () => {
      await writeFileContent(
        join(testDir, ".grok", "config.toml"),
        ["[mcp_servers.example]", 'command = "echo"', "", "[ui]", 'theme = "dark"'].join("\n"),
      );

      const permissions = await GrokcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: makeRulesyncPermissions({ bash: { "*": "allow" } }),
        global: true,
      });

      const parsed = smolToml.parse(permissions.getFileContent());
      expect((parsed.ui as Record<string, unknown>).theme).toBe("dark");
      expect((parsed.ui as Record<string, unknown>).permission_mode).toBe("always-approve");
      expect(parsed.mcp_servers).toBeDefined();
    });

    it("throws when not in global mode", async () => {
      await expect(
        GrokcliPermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions: makeRulesyncPermissions({ bash: { "*": "allow" } }),
          global: false,
        }),
      ).rejects.toThrow(/global-only/);
    });
  });

  describe("toRulesyncPermissions (import)", () => {
    it("maps always-approve back to bash allow", async () => {
      await writeFileContent(
        join(testDir, ".grok", "config.toml"),
        ["[ui]", 'permission_mode = "always-approve"'].join("\n"),
      );
      const tool = await GrokcliPermissions.fromFile({ outputRoot: testDir, global: true });
      const json = JSON.parse(tool.toRulesyncPermissions().getFileContent());
      expect(json.permission.bash["*"]).toBe("allow");
    });

    it("maps ask (and missing mode) back to bash ask", async () => {
      await writeFileContent(
        join(testDir, ".grok", "config.toml"),
        ["[ui]", 'permission_mode = "ask"'].join("\n"),
      );
      const tool = await GrokcliPermissions.fromFile({ outputRoot: testDir, global: true });
      const json = JSON.parse(tool.toRulesyncPermissions().getFileContent());
      expect(json.permission.bash["*"]).toBe("ask");
    });
  });

  describe("fromFile", () => {
    it("throws when not in global mode", async () => {
      await expect(
        GrokcliPermissions.fromFile({ outputRoot: testDir, global: false }),
      ).rejects.toThrow(/global-only/);
    });
  });
});

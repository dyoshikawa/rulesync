import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CodewhalePermissions } from "./codewhale-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

function rulesyncPermissions(json: Record<string, unknown>): RulesyncPermissions {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify(json),
  });
}

function parseRules(perms: CodewhalePermissions): unknown[] {
  const content = perms.getFileContent();
  if (content === "") return [];
  const parsed = smolToml.parse(content);
  return Array.isArray(parsed.rules) ? parsed.rules : [];
}

describe("CodewhalePermissions", () => {
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

  const permissionsPath = (): string => join(testDir, ".codewhale", "permissions.toml");

  const writePermissions = async (content: string): Promise<void> => {
    await ensureDir(join(testDir, ".codewhale"));
    await writeFileContent(permissionsPath(), content);
  };

  const generate = (json: Record<string, unknown>, logger = createMockLogger()) =>
    CodewhalePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissions(json),
      logger,
      global: true,
    });

  const fromContent = (fileContent: string): CodewhalePermissions =>
    new CodewhalePermissions({
      outputRoot: testDir,
      relativeDirPath: ".codewhale",
      relativeFilePath: "permissions.toml",
      fileContent,
      global: true,
    });

  describe("getSettablePaths", () => {
    it("targets ~/.codewhale/permissions.toml", () => {
      expect(CodewhalePermissions.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: ".codewhale",
        relativeFilePath: "permissions.toml",
      });
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("converts bash patterns to exec_shell rules, sorted deny > ask > allow", async () => {
      const perms = await generate({
        permission: {
          bash: {
            "git status": "allow",
            "npm *": "allow",
            "git push *": "ask",
            "rm -rf": "deny",
          },
        },
      });

      expect(parseRules(perms)).toEqual([
        { tool: "exec_shell", command: "rm -rf", action: "deny" },
        { tool: "exec_shell", command: "git push", action: "ask" },
        { tool: "exec_shell", command: "git status", command_exact: true, action: "allow" },
        { tool: "exec_shell", command: "npm", action: "allow" },
      ]);
    });

    it("turns a catch-all bash pattern into a tool-wide rule", async () => {
      const perms = await generate({ permission: { bash: { "*": "ask" } } });

      expect(parseRules(perms)).toEqual([{ tool: "exec_shell", action: "ask" }]);
    });

    it("broadens a restricting wildcard pattern to its literal prefix and skips an allow", async () => {
      const logger = createMockLogger();
      const perms = await generate(
        {
          permission: {
            bash: {
              "git push* --force": "deny",
              "*sudo*": "deny",
              "npm run *:dev": "allow",
            },
          },
        },
        logger,
      );

      expect(parseRules(perms)).toEqual([{ tool: "exec_shell", command: "git", action: "deny" }]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('broadening bash deny "git push* --force"'),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('skipping bash deny "*sudo*"'),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('skipping bash allow "npm run *:dev"'),
      );
    });

    it("maps path categories to file tools, fanning edit and write restrictions out to apply_patch", async () => {
      const perms = await generate({
        permission: {
          read: { "*": "allow", ".env": "deny" },
          edit: { "**": "ask" },
          write: { "secrets/key.pem": "deny" },
          grep: { "*": "allow" },
          glob: { "*": "allow" },
          list: { "*": "allow" },
        },
      });

      expect(parseRules(perms)).toEqual([
        { tool: "apply_patch", path: "secrets/key.pem", action: "deny" },
        { tool: "read_file", path: ".env", action: "deny" },
        { tool: "write_file", path: "secrets/key.pem", action: "deny" },
        { tool: "apply_patch", action: "ask" },
        { tool: "edit_file", action: "ask" },
        { tool: "file_search", action: "allow" },
        { tool: "grep_files", action: "allow" },
        { tool: "list_dir", action: "allow" },
        { tool: "read_file", action: "allow" },
      ]);
    });

    it("skips path globs and unsupported categories with a warning", async () => {
      const logger = createMockLogger();
      const perms = await generate(
        {
          permission: {
            read: { "src/**/*.ts": "allow" },
            webfetch: { "*": "allow" },
            mcp: { "*": "ask" },
          },
        },
        logger,
      );

      expect(perms.getFileContent()).toBe("");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('skipping read allow "src/**/*.ts"'),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('unsupported category "webfetch"'),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('unsupported category "mcp"'),
      );
    });

    it("withholds a tool's allow rules when a restriction for it cannot be written", async () => {
      const logger = createMockLogger();
      const perms = await generate(
        {
          permission: {
            bash: { "*": "allow", "* --force*": "deny", "git status": "deny" },
            read: { "*": "allow", "secrets/**": "deny" },
            list: { "*": "allow" },
          },
        },
        logger,
      );

      expect(parseRules(perms)).toEqual([
        { tool: "exec_shell", command: "git status", action: "deny" },
        { tool: "list_dir", action: "allow" },
      ]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('withholding exec_shell allow "*"'),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('withholding read_file allow "*"'),
      );
    });

    it("writes a write restriction for apply_patch but not a write allow", async () => {
      const perms = await generate({
        permission: { write: { "*": "deny" }, edit: { "*": "allow" } },
      });

      expect(parseRules(perms)).toEqual([
        { tool: "apply_patch", action: "deny" },
        { tool: "write_file", action: "deny" },
        { tool: "apply_patch", action: "allow" },
        { tool: "edit_file", action: "allow" },
      ]);
    });

    it("writes all-tools restrictions for shell commands and every file tool", async () => {
      const logger = createMockLogger();
      const perms = await generate(
        {
          permission: {
            "*": { ".env": "deny", "*": "ask", "git *": "allow" },
          },
        },
        logger,
      );

      expect(parseRules(perms)).toEqual([
        { tool: "apply_patch", path: ".env", action: "deny" },
        { tool: "edit_file", path: ".env", action: "deny" },
        { tool: "exec_shell", command: ".env", action: "deny" },
        { tool: "file_search", path: ".env", action: "deny" },
        { tool: "grep_files", path: ".env", action: "deny" },
        { tool: "list_dir", path: ".env", action: "deny" },
        { tool: "read_file", path: ".env", action: "deny" },
        { tool: "write_file", path: ".env", action: "deny" },
        { tool: "apply_patch", action: "ask" },
        { tool: "edit_file", action: "ask" },
        { tool: "exec_shell", action: "ask" },
        { tool: "file_search", action: "ask" },
        { tool: "grep_files", action: "ask" },
        { tool: "list_dir", action: "ask" },
        { tool: "read_file", action: "ask" },
        { tool: "write_file", action: "ask" },
      ]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('skipping all-tools allow rule(s) "git *"'),
      );
    });

    it("withholds every file tool's allow rules for an all-tools glob restriction", async () => {
      const logger = createMockLogger();
      const perms = await generate(
        {
          permission: {
            "*": { "secrets/**": "deny" },
            read: { "*": "allow" },
            bash: { "rm *": "deny" },
          },
        },
        logger,
      );

      expect(parseRules(perms)).toEqual([{ tool: "exec_shell", command: "rm", action: "deny" }]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('all-tools deny "secrets/**" cannot be written'),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('withholding read_file allow "*"'),
      );
    });

    it("withholds only the allow rules a restriction that cannot be written overlaps", async () => {
      const logger = createMockLogger();
      const perms = await generate(
        {
          permission: {
            "*": { "**/.env": "deny", "git push *": "deny" },
            bash: { "git status": "allow", "Git  Log *": "allow", "*.env*": "ask" },
            read: { "src/a.ts": "allow", "./secrets/a.txt": "allow", "secrets/*": "deny" },
            list: { "*": "allow" },
          },
        },
        logger,
      );

      expect(parseRules(perms)).toEqual([
        { tool: "exec_shell", command: "git push", action: "deny" },
        { tool: "exec_shell", command: "git status", command_exact: true, action: "allow" },
        { tool: "read_file", path: "src/a.ts", action: "allow" },
      ]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('withholding exec_shell allow "Git  Log"'),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('withholding read_file allow "./secrets/a.txt"'),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('withholding list_dir allow "*"'),
      );
    });

    it("withholds an absolute allow path it cannot compare with a dropped restriction", async () => {
      const perms = await generate({
        permission: { read: { "/repo/src/a.ts": "allow", "secrets/**": "deny" } },
      });

      expect(parseRules(perms)).toEqual([]);
    });

    it("compares paths the way Codewhale normalizes them, widening ** segments and classes", async () => {
      const perms = await generate({
        permission: {
          read: {
            "**/*.pem": "deny",
            "secrets/key*": "deny",
            "dev.pem": "allow",
            "secrets//key1": "allow",
            "secrets/./key2": "allow",
            "src/a.ts": "allow",
          },
          grep: { "[!a-z]*": "ask", readme: "allow" },
          list: { "secrets/**": "deny", secrets: "allow", src: "allow" },
        },
      });

      expect(parseRules(perms)).toEqual([
        { tool: "list_dir", path: "src", action: "allow" },
        { tool: "read_file", path: "src/a.ts", action: "allow" },
      ]);
    });

    it("treats a [...] class in a bash pattern as a wildcard Codewhale cannot match", async () => {
      const logger = createMockLogger();
      const perms = await generate(
        {
          permission: {
            bash: { "[g]it push *": "deny", "git *": "allow", "test [ -f x ]": "allow" },
          },
        },
        logger,
      );

      expect(parseRules(perms)).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('skipping bash deny "[g]it push *"'),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('skipping bash allow "test [ -f x ]"'),
      );
    });

    it("compares a literal [ in a workspace grant as a single character", async () => {
      const grant = {
        tool: "exec_shell",
        command: "test [ -f x ]",
        command_exact: true,
        workspace: "/home/me/project",
        action: "allow",
      };
      await writePermissions(smolToml.stringify({ rules: [grant] }));

      const perms = await generate({ permission: { bash: { "* -f *": "deny" } } });

      expect(parseRules(perms)).toEqual([]);
    });

    it("withholds a directory-rooted allow when a dropped restriction lies under it", async () => {
      const perms = await generate({
        permission: {
          grep: { ".": "allow", "secrets/**": "deny" },
          list: { src: "allow", docs: "allow", "src/**/*.pem": "deny" },
          read: { "secrets/{a,{b,c}}": "deny", "secrets/b": "allow" },
        },
      });

      expect(parseRules(perms)).toEqual([{ tool: "list_dir", path: "docs", action: "allow" }]);
    });

    it("turns a ** bash or all-tools restriction into a tool-wide rule", async () => {
      const perms = await generate({
        permission: { "*": { "**": "deny" }, bash: { "git status": "allow" } },
      });

      expect(parseRules(perms)).toEqual([
        { tool: "apply_patch", action: "deny" },
        { tool: "edit_file", action: "deny" },
        { tool: "exec_shell", action: "deny" },
        { tool: "file_search", action: "deny" },
        { tool: "grep_files", action: "deny" },
        { tool: "list_dir", action: "deny" },
        { tool: "read_file", action: "deny" },
        { tool: "write_file", action: "deny" },
        { tool: "exec_shell", command: "git status", command_exact: true, action: "allow" },
      ]);
    });

    it("prepends codewhale.rules verbatim, defaulting their action to ask", async () => {
      const perms = await generate({
        permission: { bash: { "git *": "allow" } },
        codewhale: {
          rules: [{ tool: "exec_shell", command: "cargo publish", command_exact: true }],
        },
      });

      expect(parseRules(perms)).toEqual([
        { tool: "exec_shell", command: "cargo publish", command_exact: true, action: "ask" },
        { tool: "exec_shell", command: "git", action: "allow" },
      ]);
    });

    it("applies the codewhale.permission block over the shared permission record", async () => {
      const processed = rulesyncPermissions({
        permission: { bash: { "git *": "allow" } },
        codewhale: { permission: { bash: { "git *": "ask" } } },
      }).forTarget({ toolTarget: "codewhale" });
      const perms = await CodewhalePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: processed,
        global: true,
      });

      expect(parseRules(perms)).toEqual([{ tool: "exec_shell", command: "git", action: "ask" }]);
    });

    it("keeps workspace-scoped grants from the existing file and replaces everything else", async () => {
      await writePermissions(
        smolToml.stringify({
          rules: [
            { tool: "exec_shell", command: "old", action: "ask" },
            {
              tool: "exec_shell",
              command: "cargo test",
              command_exact: true,
              workspace: "/home/me/project",
              action: "allow",
            },
          ],
        }),
      );

      const perms = await generate({ permission: { bash: { "rm *": "deny" } } });

      expect(parseRules(perms)).toEqual([
        { tool: "exec_shell", command: "rm", action: "deny" },
        {
          tool: "exec_shell",
          command: "cargo test",
          command_exact: true,
          workspace: "/home/me/project",
          action: "allow",
        },
      ]);
    });

    it("withholds a workspace-scoped allow that a restriction which cannot be written overlaps", async () => {
      const prefixGrant = {
        tool: "exec_shell",
        command: "git push",
        workspace: "/home/me/project",
        action: "allow",
      };
      const exactGrant = { ...prefixGrant, command: "cargo test", command_exact: true };
      await writePermissions(smolToml.stringify({ rules: [prefixGrant, exactGrant] }));
      const logger = createMockLogger();

      const perms = await generate({ permission: { bash: { "* --force": "deny" } } }, logger);

      expect(parseRules(perms)).toEqual([exactGrant]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'withholding exec_shell allow "git push" (workspace /home/me/project)',
        ),
      );
    });

    it("drops an existing record Codewhale would reject instead of writing it back", async () => {
      const logger = createMockLogger();
      await writePermissions(
        smolToml.stringify({
          rules: [{ tool: "exec_shell", command: "ls", workspace: "/w", action: "allow", x: 1 }],
        }),
      );

      const perms = await generate({ permission: { bash: { "rm *": "deny" } } }, logger);

      expect(parseRules(perms)).toEqual([{ tool: "exec_shell", command: "rm", action: "deny" }]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("dropping 1 existing rule record(s)"),
      );
    });

    it("warns when CODEWHALE_HOME moves the file Codewhale reads", async () => {
      vi.stubEnv("CODEWHALE_HOME", "/elsewhere");
      const logger = createMockLogger();
      try {
        await generate({ permission: { bash: { "rm *": "deny" } } }, logger);
      } finally {
        vi.unstubAllEnvs();
      }

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("CODEWHALE_HOME is set"));
    });

    it("throws when the existing file is malformed TOML", async () => {
      await writePermissions("rules = [");

      await expect(generate({ permission: { bash: { "*": "ask" } } })).rejects.toThrow(
        "Failed to parse existing Codewhale permissions",
      );
    });

    it("is never deletable and skips creation for an empty payload", async () => {
      const perms = await generate({ permission: {} });

      expect(perms.getFileContent()).toBe("");
      expect(perms.isDeletable()).toBe(false);
      expect(perms.shouldSkipCreationWhenPayloadEmpty()).toBe(true);
    });
  });

  describe("toRulesyncPermissions", () => {
    it("imports native rules into canonical categories", () => {
      const perms = fromContent(
        smolToml.stringify({
          rules: [
            { tool: "exec_shell", command: "rm -rf", action: "deny" },
            { tool: "exec_shell", command: "git", action: "allow" },
            { tool: "exec_shell", command: "git status", command_exact: true, action: "allow" },
            { tool: "exec_shell" },
            { tool: "read_file", path: ".env", action: "deny" },
            { tool: "edit_file", action: "ask" },
            { tool: "apply_patch", action: "ask" },
            { tool: "list_dir", action: "allow" },
          ],
        }),
      );

      expect(perms.toRulesyncPermissions().getJson()).toEqual({
        permission: {
          bash: { "rm -rf *": "deny", "*": "ask", "git *": "allow", "git status": "allow" },
          read: { ".env": "deny" },
          edit: { "*": "ask" },
          list: { "*": "allow" },
        },
      });
    });

    it("keeps rules it cannot express in the codewhale.rules passthrough", () => {
      const perms = fromContent(
        smolToml.stringify({
          rules: [
            { tool: "edit_file", path: "a.txt", action: "deny" },
            { tool: "exec_shell", command: "make", command_exact: true, action: "deny" },
            { tool: "exec_shell", command: "ls", workspace: "/w", action: "allow" },
            { tool: "fetch_url", action: "allow" },
            { tool: "read_file", path: "src/*.ts", action: "allow" },
          ],
        }),
      );

      expect(perms.toRulesyncPermissions().getJson()).toEqual({
        permission: {},
        codewhale: {
          rules: [
            { tool: "edit_file", path: "a.txt", action: "deny" },
            { tool: "exec_shell", command: "make", command_exact: true, action: "deny" },
            { tool: "exec_shell", command: "ls", workspace: "/w", action: "allow" },
            { tool: "fetch_url", action: "allow" },
            { tool: "read_file", path: "src/*.ts", action: "allow" },
          ],
        },
      });
    });

    it("lets the stronger action take the canonical slot and keeps the weaker one native", () => {
      const perms = fromContent(
        smolToml.stringify({
          rules: [
            { tool: "exec_shell", command: "git", action: "ask" },
            { tool: "exec_shell", command: "git", action: "deny" },
          ],
        }),
      );

      expect(perms.toRulesyncPermissions().getJson()).toEqual({
        permission: { bash: { "git *": "deny" } },
        codewhale: { rules: [{ tool: "exec_shell", command: "git", action: "ask" }] },
      });
    });

    it("drops records Codewhale itself would reject", () => {
      const perms = fromContent(
        smolToml.stringify({
          rules: [
            { tool: "exec_shell", command: "ls", action: "allow", unknown: true },
            { tool: "read_file", action: "allow" },
          ],
        }),
      );

      expect(perms.toRulesyncPermissions().getJson()).toEqual({
        permission: { read: { "*": "allow" } },
      });
    });

    it("keeps a workspace-scoped grant exactly once across generate, import and generate", async () => {
      const grant = {
        tool: "exec_shell",
        command: "cargo test",
        command_exact: true,
        workspace: "/home/me/project",
        action: "allow",
      };
      await writePermissions(smolToml.stringify({ rules: [grant] }));
      const first = await generate({ permission: { bash: { "rm *": "deny" } } });
      await writePermissions(first.getFileContent());

      const imported = fromContent(first.getFileContent()).toRulesyncPermissions().getJson();
      const second = await generate(imported);

      expect(parseRules(second)).toEqual([
        grant,
        { tool: "exec_shell", command: "rm", action: "deny" },
      ]);
    });

    it("imports a write restriction paired with apply_patch without a native leftover", () => {
      const perms = fromContent(
        smolToml.stringify({
          rules: [
            { tool: "apply_patch", path: "a.txt", action: "deny" },
            { tool: "write_file", path: "a.txt", action: "deny" },
            { tool: "edit_file", path: "a.txt", action: "deny" },
          ],
        }),
      );

      expect(perms.toRulesyncPermissions().getJson()).toEqual({
        permission: { edit: { "a.txt": "deny" }, write: { "a.txt": "deny" } },
      });
    });

    it("round-trips generated output through import and generate", async () => {
      const source = {
        permission: {
          bash: { "git status": "allow", "npm *": "allow", "rm -rf": "deny", "*": "ask" },
          edit: { "*": "ask", "README.md": "allow" },
          read: { ".env": "deny" },
          write: { dist: "deny", "*": "allow" },
        },
      };
      const first = await generate(source);
      const imported = fromContent(first.getFileContent()).toRulesyncPermissions().getJson();
      const second = await generate(imported);

      expect(second.getFileContent()).toBe(first.getFileContent());
    });
  });
});

import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { readFileContentOrNull, writeFileContent } from "../../utils/file.js";
import { parseJsonc } from "../../utils/jsonc.js";
import { GitlabduoPermissions, toGitlabduoCommandResource } from "./gitlabduo-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

function rulesyncPermissions(config: Record<string, unknown>): RulesyncPermissions {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify(config),
  });
}

const allow = (resource: string) => ({ action: "run_command", resource, effect: "allow" });

describe("GitlabduoPermissions", () => {
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

  const settingsPath = () => join(testDir, ".gitlab", "duo", "settings.json");

  const generate = async ({
    config,
    logger,
  }: {
    config: Record<string, unknown>;
    logger?: ReturnType<typeof createMockLogger>;
  }): Promise<string> => {
    const permissions = await GitlabduoPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissions(config),
      global: true,
      ...(logger !== undefined && { logger }),
    });
    return permissions.getFileContent();
  };

  const warnings = (logger: ReturnType<typeof createMockLogger>): string =>
    logger.warn.mock.calls.map((call) => String(call[0])).join("\n");

  describe("getSettablePaths", () => {
    it("points at the user settings file", () => {
      expect(GitlabduoPermissions.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".gitlab", "duo"),
        relativeFilePath: "settings.json",
      });
    });
  });

  describe("project scope", () => {
    it("refuses to generate or read outside --global", async () => {
      await expect(
        GitlabduoPermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions: rulesyncPermissions({ permission: {} }),
        }),
      ).rejects.toThrow("--global");
      await expect(GitlabduoPermissions.fromFile({ outputRoot: testDir })).rejects.toThrow(
        "--global",
      );
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("writes bash allow rules as run_command allow statements", async () => {
      const content = await generate({
        config: { permission: { bash: { "git status": "allow", "npm run *": "allow" } } },
      });
      expect(parseJsonc(content)).toEqual({
        permissions: [allow("git status"), allow("npm run *")],
      });
    });

    it("writes a trailing ':*' as one more argument", async () => {
      const content = await generate({ config: { permission: { bash: { "git:*": "allow" } } } });
      expect(parseJsonc(content)).toEqual({ permissions: [allow("git *")] });
    });

    it("never writes a deny or ask statement, and reports the deny as not enforced", async () => {
      const logger = createMockLogger();
      const content = await generate({
        config: {
          permission: { bash: { "git status": "allow", "rm *": "deny", "git push *": "ask" } },
        },
        logger,
      });
      expect(parseJsonc(content)).toEqual({ permissions: [allow("git status")] });
      expect(warnings(logger)).toContain("the deny rule(s) for rm * were not written");
    });

    it.each([
      { name: "a narrower deny", restriction: { "git push *": "deny" } },
      { name: "a narrower ask", restriction: { "git push *": "ask" } },
      { name: "a catch-all ask", restriction: { "*": "ask" } },
      { name: "a flag deny", restriction: { "* --force": "deny" } },
    ])("withholds an allow that overlaps $name", async ({ restriction }) => {
      const logger = createMockLogger();
      const content = await generate({
        config: { permission: { bash: { "git *": "allow", ...restriction } } },
        logger,
      });
      expect(parseJsonc(content)).toEqual({});
      expect(warnings(logger)).toContain("was not given the allow rule(s) for git *");
    });

    it("withholds an allow that an all-tools '*' deny overlaps", async () => {
      const content = await generate({
        config: { permission: { "*": { "rm *": "deny" }, bash: { "rm *": "allow", ls: "allow" } } },
      });
      expect(parseJsonc(content)).toEqual({ permissions: [allow("ls")] });
    });

    it.each(["*", "git **", "git status; rm -rf /", "echo $(id)", 'git commit -m "x"', "ls [ab]"])(
      "skips the allow pattern %j the server refuses or reads differently",
      async (pattern) => {
        const logger = createMockLogger();
        const content = await generate({
          config: { permission: { bash: { [pattern]: "allow" } } },
          logger,
        });
        expect(parseJsonc(content)).toEqual({});
        expect(warnings(logger)).toContain("were skipped");
      },
    );

    it("skips allow rules of other categories with a warning", async () => {
      const logger = createMockLogger();
      const content = await generate({
        config: { permission: { read: { "src/**": "allow" }, bash: { ls: "allow" } } },
        logger,
      });
      expect(parseJsonc(content)).toEqual({ permissions: [allow("ls")] });
      expect(warnings(logger)).toContain("the allow rules of 'read' were skipped");
    });

    it("keeps other keys, comments and other tools' statements, and replaces run_command ones", async () => {
      await writeFileContent(
        settingsPath(),
        [
          "{",
          "  // my settings",
          '  "defaultMode": "plan",',
          '  "permissions": [',
          '    { "action": "read_file", "resource": "*", "effect": "allow" },',
          '    { "action": "run_command", "resource": "make", "effect": "allow" }',
          "  ]",
          "}",
        ].join("\n"),
      );
      const content = await generate({ config: { permission: { bash: { ls: "allow" } } } });
      expect(content).toContain("// my settings");
      expect(parseJsonc(content)).toEqual({
        defaultMode: "plan",
        permissions: [{ action: "read_file", resource: "*", effect: "allow" }, allow("ls")],
      });
    });

    it("removes the key when nothing is left to write", async () => {
      await writeFileContent(
        settingsPath(),
        JSON.stringify({ defaultMode: "plan", permissions: [allow("make")] }),
      );
      const content = await generate({ config: { permission: {} } });
      expect(parseJsonc(content)).toEqual({ defaultMode: "plan" });
    });

    it("leaves a permissions value that is not an array untouched", async () => {
      const original = JSON.stringify({ permissions: "allow everything" });
      await writeFileContent(settingsPath(), original);
      const logger = createMockLogger();
      const content = await generate({
        config: { permission: { bash: { ls: "allow" } } },
        logger,
      });
      expect(content).toBe(original);
      expect(warnings(logger)).toContain("is not an array");
    });

    it("does not create the file on a run that reads a missing one", async () => {
      const content = await generate({ config: { permission: {} } });
      expect(content).toBe("{}");
      expect(await readFileContentOrNull(settingsPath())).toBeNull();
    });
  });

  describe("toRulesyncPermissions", () => {
    it("imports run_command statements under bash, skipping allows that hold a glob", async () => {
      await writeFileContent(
        settingsPath(),
        JSON.stringify({
          permissions: [
            allow("git status"),
            allow("git checkout *"),
            { action: "run_command", resource: "rm *", effect: "deny" },
            { action: "run_command", resource: "git status", effect: "ask" },
            { action: "read_file", resource: "*", effect: "allow" },
            { action: "run_command", resource: "x", effect: "maybe" },
          ],
        }),
      );
      const permissions = await GitlabduoPermissions.fromFile({
        outputRoot: testDir,
        global: true,
      });
      expect(permissions.toRulesyncPermissions().getJson()).toEqual({
        permission: { bash: { "git status": "ask", "rm *": "deny" } },
      });
    });
  });
});

describe("toGitlabduoCommandResource", () => {
  it.each([
    ["git status", "git status"],
    ["  git   status  ", "git status"],
    ["git checkout feature-*", "git checkout feature-*"],
    ["npm run:*", "npm run *"],
    ["* --version", "* --version"],
  ])("writes %j as %j", (pattern, expected) => {
    expect(toGitlabduoCommandResource(pattern)).toBe(expected);
  });

  it.each(["*", "", "git ** push", "a|b", "a\\b", "x".repeat(257)])("refuses %j", (pattern) => {
    expect(toGitlabduoCommandResource(pattern)).toBeNull();
  });
});

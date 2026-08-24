import { join } from "node:path";

import { dump, load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { isRecord } from "../../utils/type-guards.js";
import { RovodevPermissions } from "./rovodev-permissions.js";
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

function toolPermissionsOf(yamlContent: string): Record<string, unknown> {
  const parsed = load(yamlContent);
  if (!isRecord(parsed)) return {};
  return isRecord(parsed.toolPermissions) ? parsed.toolPermissions : {};
}

/** Per-tool levels live under `toolPermissions.tools`, not one level up. */
function toolLevelsOf(yamlContent: string): Record<string, unknown> {
  const toolPermissions = toolPermissionsOf(yamlContent);
  return isRecord(toolPermissions.tools) ? toolPermissions.tools : {};
}

describe("RovodevPermissions", () => {
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
    it("targets config.yml in the ~/.rovodev directory", () => {
      const paths = RovodevPermissions.getSettablePaths();
      expect(paths.relativeDirPath).toBe(".rovodev");
      expect(paths.relativeFilePath).toBe("config.yml");
    });
  });

  describe("isDeletable", () => {
    it("is never deletable (shared config.yml)", () => {
      const perms = new RovodevPermissions({
        relativeDirPath: ".rovodev",
        relativeFilePath: "config.yml",
        fileContent: "",
        validate: false,
      });
      expect(perms.isDeletable()).toBe(false);
    });
  });

  describe("project scope", () => {
    it("writes the repo-committed .rovodev/config.yml without --global", async () => {
      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "*": "ask" } }),
        global: false,
      });

      expect(perms.getRelativeDirPath()).toBe(".rovodev");
      expect(perms.getRelativeFilePath()).toBe("config.yml");
      const parsed = load(perms.getFileContent()) as any;
      expect(parsed.toolPermissions.bash.default).toBe("ask");
    });

    it("reads the project config.yml without --global", async () => {
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(
        join(testDir, ".rovodev", "config.yml"),
        ["toolPermissions:", "  bash:", "    default: deny"].join("\n"),
      );

      const perms = await RovodevPermissions.fromFile({ outputRoot: testDir, global: false });
      const config = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(config.permission.bash["*"]).toBe("deny");
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("maps bash catch-all to bash.default and patterns to bash.commands", async () => {
      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "*": "ask", "git status": "allow", "rm -rf .*": "deny" },
        }),
        global: true,
      });

      const tp = toolPermissionsOf(perms.getFileContent());
      const bash = isRecord(tp.bash) ? tp.bash : {};
      expect(bash.default).toBe("ask");
      expect(bash.commands).toEqual([
        { command: "git status", permission: "allow" },
        { command: "rm -rf .*", permission: "deny" },
      ]);
    });

    it("maps read/edit catch-alls to the matching per-tool keys", async () => {
      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          read: { "*": "allow" },
          edit: { "*": "deny" },
        }),
        global: true,
      });

      const tools = toolLevelsOf(perms.getFileContent());
      expect(tools.open_files).toBe("allow");
      expect(tools.grep).toBe("allow");
      expect(tools.expand_code_chunks).toBe("allow");
      expect(tools.expand_folder).toBe("allow");
      expect(tools.find_and_replace_code).toBe("deny");
      expect(tools.create_file).toBe("deny");
      expect(tools.delete_file).toBe("deny");
      expect(tools.move_file).toBe("deny");
    });

    it("routes non-catch-all allow paths to allowedExternalPaths", async () => {
      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          read: { "/tmp/shared": "allow", "/var/data": "allow" },
        }),
        global: true,
      });

      const tp = toolPermissionsOf(perms.getFileContent());
      expect(tp.allowedExternalPaths).toEqual(["/tmp/shared", "/var/data"]);
    });

    it("warns and skips categories without a clean Rovo Dev target", async () => {
      const mockLogger = createMockLogger();
      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          webfetch: { "github.com": "allow" },
        }),
        logger: mockLogger,
        global: true,
      });

      const tools = toolLevelsOf(perms.getFileContent());
      expect(tools.webfetch).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("webfetch"));
    });

    it.each([
      { name: "edit is stricter", permission: { write: { "*": "allow" }, edit: { "*": "deny" } } },
      { name: "write is stricter", permission: { write: { "*": "deny" }, edit: { "*": "allow" } } },
    ])(
      "warns and keeps the stricter level when edit and write conflict ($name)",
      async ({ permission }) => {
        // Both categories drive the same Rovo Dev tools, so one of the two
        // authored levels cannot be written at all; dropping the stricter one would
        // grant more than the author asked for.
        const mockLogger = createMockLogger();
        const perms = await RovodevPermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions: rulesyncPermissions(permission),
          logger: mockLogger,
          global: true,
        });

        const tools = toolLevelsOf(perms.getFileContent());
        expect(tools.create_file).toBe("deny");
        expect(tools.find_and_replace_code).toBe("deny");
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('The stricter of the two ("deny") is used'),
        );
      },
    );

    it("merges into config.yml preserving all other top-level keys", async () => {
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({
          agent: { model: "claude" },
          sessions: { retention: 30 },
          mcp: { someSetting: true },
          toolPermissions: { grep: "allow", customKey: "preserved" },
        }),
      );

      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "*": "ask" } }),
        global: true,
      });

      const parsed = load(perms.getFileContent());
      if (!isRecord(parsed)) throw new Error("expected object");
      // Unrelated top-level keys preserved.
      expect(parsed.agent).toEqual({ model: "claude" });
      expect(parsed.sessions).toEqual({ retention: 30 });
      expect(parsed.mcp).toEqual({ someSetting: true });
      // Managed block merged in; unmanaged keys inside it preserved.
      const tp = isRecord(parsed.toolPermissions) ? parsed.toolPermissions : {};
      expect(isRecord(tp.bash) ? tp.bash.default : undefined).toBe("ask");
      expect(tp.customKey).toBe("preserved");
    });
  });

  describe("round-trip", () => {
    it("maps rulesync -> rovodev -> rulesync preserving bash and per-tool levels", async () => {
      const original = rulesyncPermissions({
        bash: { "*": "ask", "git status": "allow" },
        read: { "*": "allow" },
        edit: { "*": "deny" },
      });

      const toolPerms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: original,
        global: true,
      });

      const roundTripped = toolPerms.toRulesyncPermissions();
      const json = JSON.parse(roundTripped.getFileContent());

      expect(json.permission.bash["*"]).toBe("ask");
      expect(json.permission.bash["git status"]).toBe("allow");
      expect(json.permission.read["*"]).toBe("allow");
      expect(json.permission.edit["*"]).toBe("deny");
    });
  });

  describe("fromFile", () => {
    it("reads an existing config.yml from the home-relative path", async () => {
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({ toolPermissions: { grep: "deny" } }),
      );

      const perms = await RovodevPermissions.fromFile({ outputRoot: testDir, global: true });
      // `fromFile` returns the file verbatim, so this reads the fixture's own
      // (legacy, flat) shape rather than the nested one generate now writes.
      const tp = toolPermissionsOf(perms.getFileContent());
      expect(tp.grep).toBe("deny");
    });
  });

  describe("toolPermissions.tools nesting", () => {
    it("imports a legacy flat block written by an earlier rulesync", () => {
      // Generate used to write per-tool levels one level too shallow. Those
      // files must still import rather than round-tripping to nothing.
      const perms = new RovodevPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "config.yml",
        fileContent: dump({ toolPermissions: { grep: "deny", create_file: "ask" } }),
        global: true,
      });

      const json = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(json.permission.read["*"]).toBe("deny");
      expect(json.permission.edit["*"]).toBe("ask");
    });

    it("prefers the nested block when both depths carry a value", () => {
      // Deliberately the direction where the nested value is the *looser* one,
      // so a regression to reading the legacy copy is visible here.
      const perms = new RovodevPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "config.yml",
        fileContent: dump({
          toolPermissions: {
            grep: "deny",
            open_files: "allow",
            expand_folder: "allow",
            expand_code_chunks: "allow",
            // Every key of the `read` category has to say `allow` for the
            // catch-all to be `allow`; a silent one counts as the implicit
            // level. Set them here so this test isolates the nested-vs-legacy
            // precedence question rather than re-testing that fallback.
            getJiraIssue: "allow",
            getConfluencePage: "allow",
            tools: { grep: "allow" },
          },
        }),
        global: true,
      });

      const json = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(json.permission.read["*"]).toBe("allow");
    });

    it("deletes the legacy flat copies so import cannot resurrect them", async () => {
      // The flat keys are dead weight in the file — Rovo Dev ignores them — but
      // this adapter still imports them, so leaving them behind would restore a
      // category the user has since deleted from .rulesync/permissions.*.
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({ toolPermissions: { grep: "allow", create_file: "allow", customKey: "kept" } }),
      );

      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ read: { "*": "deny" } }),
        global: true,
      });

      const tp = toolPermissionsOf(perms.getFileContent());
      expect(tp.grep).toBeUndefined();
      expect(tp.create_file).toBeUndefined();
      expect(tp.customKey).toBe("kept");

      const json = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(json.permission.read["*"]).toBe("deny");
      expect(json.permission.edit).toBeUndefined();
    });

    it("drops a per-tool level the rulesync source no longer sets", async () => {
      // The eight per-tool keys are rulesync-owned, so a revoked category must
      // disappear from the nested block instead of staying live.
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({ toolPermissions: { tools: { grep: "allow", create_file: "allow" } } }),
      );

      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "*": "deny" } }),
        global: true,
      });

      // Absent, not an empty map: an emptied block leaves no `tools: {}` behind.
      expect(toolPermissionsOf(perms.getFileContent()).tools).toBeUndefined();
    });

    it("warns when it removes an owned key the source no longer produces", async () => {
      // `/directories` writes to allowedExternalPaths from inside a session, so
      // its removal must not be silent.
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({ toolPermissions: { allowedExternalPaths: ["/srv/shared"] } }),
      );
      const mockLogger = createMockLogger();

      await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ read: { "*": "deny" } }),
        logger: mockLogger,
        global: true,
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('removing "allowedExternalPaths"'),
      );
    });

    it("drops bash and allowedExternalPaths the rulesync source no longer sets", async () => {
      // Same ownership as the per-tool keys: a revoked blanket allow, or a path
      // grant the user has withdrawn, must not stay live in config.yml.
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({
          toolPermissions: {
            bash: { default: "allow", commands: [{ command: "rm -rf .*", permission: "allow" }] },
            allowedExternalPaths: ["/srv/shared"],
            customKey: "kept",
          },
        }),
      );

      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ read: { "*": "deny" } }),
        global: true,
      });

      const tp = toolPermissionsOf(perms.getFileContent());
      expect(tp.bash).toBeUndefined();
      expect(tp.allowedExternalPaths).toBeUndefined();
      expect(tp.customKey).toBe("kept");
    });

    it("ignores the legacy value for a key the nested block already answers", () => {
      // Rovo Dev reads only the nested block, so a key present there settles the
      // level even when the value is unusable; importing the legacy copy would
      // record a level the tool is not actually applying.
      const perms = new RovodevPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "config.yml",
        fileContent: dump({
          toolPermissions: { grep: "deny", tools: { grep: "Nope" } },
        }),
        global: true,
      });

      const json = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      // Nothing is recorded: `grep` is the only key either depth mentions, and
      // the nested block — the one Rovo Dev reads — does not answer it usably.
      expect(json.permission.read).toBeUndefined();
    });

    it("collapses disagreeing tool keys onto the strictest level", () => {
      // Rovo Dev rewrites a single tool key when the user answers "always allow"
      // to one prompt, so the four keys of a category can disagree.
      const perms = new RovodevPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "config.yml",
        fileContent: dump({
          toolPermissions: {
            tools: {
              open_files: "deny",
              expand_code_chunks: "deny",
              expand_folder: "ask",
              grep: "allow",
            },
          },
        }),
        global: true,
      });

      const json = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(json.permission.read["*"]).toBe("deny");
    });

    it("does not let an allowedExternalPaths catch-all widen a denied category", () => {
      // Rovo Dev appends to this list itself whenever the user approves an
      // external path at runtime, so it must not overwrite an authored level.
      const perms = new RovodevPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "config.yml",
        fileContent: dump({
          toolPermissions: { tools: { grep: "deny" }, allowedExternalPaths: ["*", "/tmp/shared"] },
        }),
        global: true,
      });

      const json = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(json.permission.read["*"]).toBe("deny");
      expect(json.permission.read["/tmp/shared"]).toBe("allow");
    });

    it("leaves the block alone when nothing in the source maps to Rovo Dev", async () => {
      // Clearing the owned keys here would relax the user's levels back to Rovo
      // Dev's defaults without a single rule of our own to replace them with.
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({
          toolPermissions: {
            bash: { default: "deny" },
            tools: { create_file: "deny" },
          },
        }),
      );

      const mockLogger = createMockLogger();
      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ webfetch: { "*": "deny" } }),
        logger: mockLogger,
        global: true,
      });

      const tp = toolPermissionsOf(perms.getFileContent());
      expect(tp.bash).toEqual({ default: "deny" });
      expect(toolLevelsOf(perms.getFileContent())).toEqual({ create_file: "deny" });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("produced no rule Rovo Dev can express"),
      );
    });

    it("leaves the block alone when a mapped category has only patterns it cannot express", async () => {
      // The category maps, but Rovo Dev's per-tool keys hold no per-path rules,
      // so this run still has nothing to write in their place.
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({ toolPermissions: { tools: { create_file: "deny" } } }),
      );

      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ edit: { "src/**": "deny" } }),
        global: true,
      });

      expect(toolLevelsOf(perms.getFileContent())).toEqual({ create_file: "deny" });
    });

    it("strips the grants but keeps the restrictions when it has nothing to write", async () => {
      // Whatever the user revoked is among the grants a previous run left here,
      // and dropping an `allow` only falls back to Rovo Dev's stricter default.
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({
          toolPermissions: {
            bash: {
              default: "allow",
              commands: [
                { command: "git status", permission: "allow" },
                { command: "rm -rf .*", permission: "deny" },
              ],
            },
            allowedExternalPaths: ["/srv/shared"],
            tools: { create_file: "allow", delete_file: "deny" },
            // A legacy flat grant an older rulesync wrote one level up.
            grep: "allow",
            customKey: "kept",
          },
        }),
      );
      const mockLogger = createMockLogger();

      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ webfetch: { "*": "deny" } }),
        logger: mockLogger,
        global: true,
      });

      const tp = toolPermissionsOf(perms.getFileContent());
      expect(tp.bash).toEqual({ commands: [{ command: "rm -rf .*", permission: "deny" }] });
      expect(tp.allowedExternalPaths).toBeUndefined();
      expect(toolLevelsOf(perms.getFileContent())).toEqual({ delete_file: "deny" });
      expect(tp.grep).toBeUndefined();
      expect(tp.customKey).toBe("kept");
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('"tools.create_file"'));
    });

    it("leaves a config.yml without a toolPermissions block alone", async () => {
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(join(dirPath, "config.yml"), dump({ agent: { model: "claude" } }));

      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ webfetch: { "*": "deny" } }),
        global: true,
      });

      const parsed = load(perms.getFileContent());
      if (!isRecord(parsed)) throw new Error("expected object");
      // No empty `toolPermissions: {}` where the user had no block at all.
      expect(parsed.toolPermissions).toBeUndefined();
      expect(parsed.agent).toEqual({ model: "claude" });
    });

    it.each<{ name: string; permission: Record<string, Record<string, string>> }>([
      { name: "no category at all", permission: {} },
      { name: "a category with no rules", permission: { read: {} } },
    ])("clears the owned keys when the source states $name", async ({ permission }) => {
      // An empty source is a deliberate clean slate, unlike one whose rules
      // simply have no Rovo Dev counterpart.
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({
          toolPermissions: { bash: { default: "allow" }, tools: { create_file: "allow" } },
        }),
      );
      const mockLogger = createMockLogger();

      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions(permission),
        logger: mockLogger,
        global: true,
      });

      const tp = toolPermissionsOf(perms.getFileContent());
      expect(tp.bash).toBeUndefined();
      expect(tp.tools).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('"tools.create_file"'));
    });

    it("preserves a hand-written tool key rulesync has no category for", async () => {
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({ toolPermissions: { tools: { someFutureRovodevTool: "allow" } } }),
      );

      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ read: { "*": "deny" } }),
        global: true,
      });

      const tools = toolLevelsOf(perms.getFileContent());
      expect(tools.someFutureRovodevTool).toBe("allow");
      expect(tools.grep).toBe("deny");
    });
  });

  describe("toolPermissions.bash sub-keys", () => {
    /** `toolPermissions.bash` of the generated config, as a plain record. */
    function bashOf(yamlContent: string): Record<string, unknown> {
      const toolPermissions = toolPermissionsOf(yamlContent);
      return isRecord(toolPermissions.bash) ? toolPermissions.bash : {};
    }

    it("preserves bash sub-keys rulesync does not manage", async () => {
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({
          toolPermissions: {
            bash: {
              default: "allow",
              commands: [{ command: "^rm ", permission: "deny" }],
              // The documented secret passthrough for Bitbucket Pipelines, plus
              // the macOS sandbox toggle. Neither has a rulesync counterpart.
              env: { SNYK_TOKEN: "${SNYK_AUTH_TOKEN}" },
              runInSandbox: true,
            },
          },
        }),
      );

      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "*": "deny" } }),
      });

      const bash = bashOf(perms.getFileContent());
      expect(bash.env).toEqual({ SNYK_TOKEN: "${SNYK_AUTH_TOKEN}" });
      expect(bash.runInSandbox).toBe(true);
      // The managed leaves are still rewritten from the canonical source.
      expect(bash.default).toBe("deny");
      expect(bash.commands).toBeUndefined();
    });

    it("warns that a preserved runInSandbox: false is not reset by regenerating", async () => {
      const logger = createMockLogger();
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({ toolPermissions: { bash: { default: "allow", runInSandbox: false } } }),
      );

      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "*": "deny" } }),
        logger,
      });

      // Carried through, since rulesync never authors the key -- but a user
      // regenerating to tighten permissions is not told otherwise.
      expect(bashOf(perms.getFileContent()).runInSandbox).toBe(false);
      expect(
        logger.warn.mock.calls.some(([message]) =>
          String(message).includes("keeping toolPermissions.bash.runInSandbox: false"),
        ),
      ).toBe(true);
    });

    it("names the dropped bash leaves, and only those, in the warning", async () => {
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({
          toolPermissions: {
            bash: {
              default: "allow",
              commands: [{ command: "^ls ", permission: "allow" }],
              env: { SNYK_TOKEN: "${SNYK_AUTH_TOKEN}" },
            },
          },
        }),
      );
      const mockLogger = createMockLogger();

      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ read: { "*": "deny" } }),
        logger: mockLogger,
      });

      const bash = bashOf(perms.getFileContent());
      expect(bash.default).toBeUndefined();
      expect(bash.commands).toBeUndefined();
      expect(bash.env).toEqual({ SNYK_TOKEN: "${SNYK_AUTH_TOKEN}" });
      const warning = mockLogger.warn.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes("bash.default"));
      expect(warning).toContain('"bash.commands"');
      expect(warning).not.toContain("bash.env");
    });

    it("drops an emptied bash block instead of leaving an empty map", async () => {
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({ toolPermissions: { bash: { default: "allow" } } }),
      );

      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ read: { "*": "deny" } }),
      });

      expect(toolPermissionsOf(perms.getFileContent()).bash).toBeUndefined();
    });
  });

  describe("planning and Atlassian tool keys", () => {
    it("maps the read category onto the inspection tools of both surfaces", async () => {
      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ read: { "*": "deny" } }),
        global: true,
      });

      const tools = toolLevelsOf(perms.getFileContent());
      expect(tools.grep).toBe("deny");
      expect(tools.getJiraIssue).toBe("deny");
      expect(tools.getConfluencePage).toBe("deny");
    });

    it("maps the edit category onto the mutating tools of both surfaces", async () => {
      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ edit: { "*": "deny" } }),
        global: true,
      });

      const tools = toolLevelsOf(perms.getFileContent());
      expect(tools.create_file).toBe("deny");
      expect(tools.createTechnicalPlan).toBe("deny");
      expect(tools.createJiraIssue).toBe("deny");
      expect(tools.updateJiraIssue).toBe("deny");
      expect(tools.createConfluencePage).toBe("deny");
      expect(tools.updateConfluencePage).toBe("deny");
    });

    it("imports the new keys back into their canonical categories", async () => {
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({
          toolPermissions: {
            tools: { getJiraIssue: "deny", createConfluencePage: "ask" },
          },
        }),
      );

      const perms = await RovodevPermissions.fromFile({ outputRoot: testDir, global: true });
      const imported = JSON.parse(perms.toRulesyncPermissions().getFileContent());

      expect(imported.permission.read["*"]).toBe("deny");
      expect(imported.permission.edit["*"]).toBe("ask");
    });
  });

  describe("toolPermissions.default", () => {
    it("maps the all-tools catch-all onto the tool-wide default", async () => {
      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          "*": { "*": "deny" },
          bash: { "*": "ask" },
        }),
        global: true,
      });

      const parsed = load(perms.getFileContent()) as {
        toolPermissions: { default?: string; bash?: { default?: string } };
      };
      expect(parsed.toolPermissions.default).toBe("deny");
      // The two defaults are derived the same way and stay independent.
      expect(parsed.toolPermissions.bash?.default).toBe("ask");
    });

    it("warns and skips a pattern rule in the all-tools category", async () => {
      const logger = createMockLogger();

      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ "*": { "src/**": "deny", "*": "ask" } }),
        global: true,
        logger,
      });

      const parsed = load(perms.getFileContent()) as {
        toolPermissions: { default?: string };
      };
      expect(parsed.toolPermissions.default).toBe("ask");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("src/**"));
    });

    it("round-trips the tool-wide default through import", async () => {
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({ toolPermissions: { default: "deny" } }),
      );

      const perms = await RovodevPermissions.fromFile({ outputRoot: testDir, global: true });
      const imported = JSON.parse(perms.toRulesyncPermissions().getFileContent());

      expect(imported.permission["*"]).toEqual({ "*": "deny" });
    });
  });

  describe("import falls back to the implicit level for silent tool keys", () => {
    it("does not widen a category from one 'always allow' answer", async () => {
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      // The shape Rovo Dev leaves behind when the user answers "always allow"
      // to a single create_file prompt.
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({ toolPermissions: { tools: { create_file: "allow" } } }),
      );

      const perms = await RovodevPermissions.fromFile({ outputRoot: testDir, global: true });
      const imported = JSON.parse(perms.toRulesyncPermissions().getFileContent());

      // Rovo Dev's own default for the silent siblings is `ask`, so the category
      // collapses to `ask` rather than handing every mutation tool an `allow`.
      expect(imported.permission.edit["*"]).toBe("ask");
    });

    it("uses the file's own default as the implicit level", async () => {
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({ toolPermissions: { default: "deny", tools: { create_file: "allow" } } }),
      );

      const perms = await RovodevPermissions.fromFile({ outputRoot: testDir, global: true });
      const imported = JSON.parse(perms.toRulesyncPermissions().getFileContent());

      expect(imported.permission.edit["*"]).toBe("deny");
    });

    it("still imports a fully stated category at its stated level", async () => {
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({
          toolPermissions: {
            tools: {
              find_and_replace_code: "allow",
              create_file: "allow",
              delete_file: "allow",
              move_file: "allow",
              createTechnicalPlan: "allow",
              createJiraIssue: "allow",
              updateJiraIssue: "allow",
              createConfluencePage: "allow",
              updateConfluencePage: "allow",
            },
          },
        }),
      );

      const perms = await RovodevPermissions.fromFile({ outputRoot: testDir, global: true });
      const imported = JSON.parse(perms.toRulesyncPermissions().getFileContent());

      expect(imported.permission.edit["*"]).toBe("allow");
    });

    it("invents no rule for a category the file says nothing about", async () => {
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({ toolPermissions: { tools: { grep: "deny" } } }),
      );

      const perms = await RovodevPermissions.fromFile({ outputRoot: testDir, global: true });
      const imported = JSON.parse(perms.toRulesyncPermissions().getFileContent());

      expect(imported.permission.edit).toBeUndefined();
    });
  });
});

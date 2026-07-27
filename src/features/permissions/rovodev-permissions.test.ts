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

  describe("global-only enforcement", () => {
    it("throws on non-global fromRulesyncPermissions", async () => {
      await expect(
        RovodevPermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions: rulesyncPermissions({ bash: { "*": "ask" } }),
          global: false,
        }),
      ).rejects.toThrow(/global-only/);
    });

    it("throws on non-global fromFile", async () => {
      await expect(
        RovodevPermissions.fromFile({ outputRoot: testDir, global: false }),
      ).rejects.toThrow(/global-only/);
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

      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ webfetch: { "*": "deny" } }),
        global: true,
      });

      const tp = toolPermissionsOf(perms.getFileContent());
      expect(tp.bash).toEqual({ default: "deny" });
      expect(toolLevelsOf(perms.getFileContent())).toEqual({ create_file: "deny" });
    });

    it("preserves a hand-written tool key rulesync has no category for", async () => {
      const dirPath = join(testDir, ".rovodev");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yml"),
        dump({ toolPermissions: { tools: { createTechnicalPlan: "allow" } } }),
      );

      const perms = await RovodevPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ read: { "*": "deny" } }),
        global: true,
      });

      const tools = toolLevelsOf(perms.getFileContent());
      expect(tools.createTechnicalPlan).toBe("allow");
      expect(tools.grep).toBe("deny");
    });
  });
});

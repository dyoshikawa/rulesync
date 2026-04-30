import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AugmentcodePermissions } from "./augmentcode-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

describe("AugmentcodePermissions", () => {
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

  it("should resolve settable paths", () => {
    expect(AugmentcodePermissions.getSettablePaths()).toEqual({
      relativeDirPath: ".augment",
      relativeFilePath: "settings.json",
    });
  });

  it("should map rulesync permissions to AugmentCode toolPermissions entries", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: {
          bash: { "git *": "allow", "rm *": "deny", "*": "ask" },
          read: { "*": "allow" },
        },
      }),
    });

    const instance = await AugmentcodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const content = JSON.parse(instance.getFileContent());
    const entries = content.toolPermissions;

    const bashAllow = entries.find(
      (e: { toolName: string; permission: { type: string } }) =>
        e.toolName === "launch-process" && e.permission.type === "allow",
    );
    expect(bashAllow.shellInputRegex).toBe("^git .*$");

    const bashAsk = entries.find(
      (e: { toolName: string; permission: { type: string } }) =>
        e.toolName === "launch-process" && e.permission.type === "ask-user",
    );
    expect(bashAsk.shellInputRegex).toBeUndefined();

    const view = entries.find((e: { toolName: string }) => e.toolName === "view");
    expect(view.permission.type).toBe("allow");
  });

  it("should preserve unrelated toolPermissions entries, top-level keys, and existing launch-process deny entries (fail-closed)", async () => {
    const settingsDir = join(testDir, ".augment");
    await ensureDir(settingsDir);
    await writeFileContent(
      join(settingsDir, "settings.json"),
      JSON.stringify({
        userName: "alice",
        toolPermissions: [
          {
            toolName: "custom-tool",
            permission: { type: "allow" },
          },
          {
            toolName: "launch-process",
            shellInputRegex: "^old$",
            permission: { type: "deny" },
          },
          {
            toolName: "launch-process",
            shellInputRegex: "^old-allow$",
            permission: { type: "allow" },
          },
        ],
      }),
    );

    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: { bash: { "git *": "allow" } },
      }),
    });

    const instance = await AugmentcodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const content = JSON.parse(instance.getFileContent());
    expect(content.userName).toBe("alice");
    const entries = content.toolPermissions as Array<{
      toolName: string;
      shellInputRegex?: string;
      permission: { type: string };
    }>;
    expect(entries.find((e) => e.toolName === "custom-tool")).toBeDefined();
    // The existing launch-process *deny* entry (`^old$`) must survive (fail-closed preservation #5).
    expect(
      entries.find(
        (e) =>
          e.toolName === "launch-process" &&
          e.permission.type === "deny" &&
          e.shellInputRegex === "^old$",
      ),
    ).toBeDefined();
    // The existing launch-process *allow* entry should be replaced — rulesync owns the namespace
    // for non-deny entries.
    expect(
      entries.find(
        (e) =>
          e.toolName === "launch-process" &&
          e.permission.type === "allow" &&
          e.shellInputRegex === "^old-allow$",
      ),
    ).toBeUndefined();
    // Newly generated launch-process entry from rulesync should be present.
    expect(
      entries.find(
        (e) =>
          e.toolName === "launch-process" &&
          e.permission.type === "allow" &&
          e.shellInputRegex === "^git .*$",
      ),
    ).toBeDefined();
  });

  it("preserved launch-process deny must NOT be shadowed by a generated catch-all allow under first-match-wins", async () => {
    // Regression: previously `[...sortedGenerated, ...preservedEntries]` placed preserved entries
    // unsorted at the tail. If the user supplied `bash: { "*": "allow" }` the generated catch-all
    // allow (no regex) ended up FIRST and shadowed the preserved `^rm .*$` deny — making it dead
    // code under AugmentCode's first-match-wins evaluation.
    const settingsDir = join(testDir, ".augment");
    await ensureDir(settingsDir);
    await writeFileContent(
      join(settingsDir, "settings.json"),
      JSON.stringify({
        toolPermissions: [
          {
            toolName: "launch-process",
            shellInputRegex: "^rm .*$",
            permission: { type: "deny" },
          },
        ],
      }),
    );

    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: { bash: { "*": "allow" } },
      }),
    });

    const instance = await AugmentcodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const entries = JSON.parse(instance.getFileContent()).toolPermissions as Array<{
      toolName: string;
      shellInputRegex?: string;
      permission: { type: string };
    }>;
    const denyIndex = entries.findIndex(
      (e) =>
        e.toolName === "launch-process" &&
        e.shellInputRegex === "^rm .*$" &&
        e.permission.type === "deny",
    );
    const allowIndex = entries.findIndex(
      (e) =>
        e.toolName === "launch-process" &&
        e.shellInputRegex === undefined &&
        e.permission.type === "allow",
    );
    expect(denyIndex).toBeGreaterThanOrEqual(0);
    expect(allowIndex).toBeGreaterThanOrEqual(0);
    // Deny MUST come before the catch-all allow.
    expect(denyIndex).toBeLessThan(allowIndex);
  });

  it("should preserve existing deny entries for ALL managed tool names, not just launch-process", async () => {
    // Regression: previously preservation only protected `launch-process` denies, so user-added
    // denies on `view`, `str-replace-editor`, `save-file`, `web-fetch`, `web-search` were silently
    // dropped on regenerate — fail-open. They must now survive.
    const settingsDir = join(testDir, ".augment");
    await ensureDir(settingsDir);
    await writeFileContent(
      join(settingsDir, "settings.json"),
      JSON.stringify({
        toolPermissions: [
          { toolName: "view", permission: { type: "deny" } },
          { toolName: "save-file", permission: { type: "deny" } },
          { toolName: "view", permission: { type: "allow" } },
        ],
      }),
    );

    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        // rulesync emits a generated catch-all `view` allow under fail-closed rules.
        permission: { read: { "*": "allow" } },
      }),
    });

    const instance = await AugmentcodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const entries = JSON.parse(instance.getFileContent()).toolPermissions as Array<{
      toolName: string;
      shellInputRegex?: string;
      permission: { type: string };
    }>;
    // Preserved denies for non-bash managed tools must survive.
    expect(
      entries.find((e) => e.toolName === "view" && e.permission.type === "deny"),
    ).toBeDefined();
    expect(
      entries.find((e) => e.toolName === "save-file" && e.permission.type === "deny"),
    ).toBeDefined();
    // Existing managed-tool ALLOW entries are still replaced by generated ones.
    const viewAllows = entries.filter(
      (e) => e.toolName === "view" && e.permission.type === "allow",
    );
    expect(viewAllows).toHaveLength(1);
    // First-match-wins: the preserved view deny must come BEFORE the generated view allow.
    const denyIndex = entries.findIndex(
      (e) => e.toolName === "view" && e.permission.type === "deny",
    );
    const allowIndex = entries.findIndex(
      (e) => e.toolName === "view" && e.permission.type === "allow",
    );
    expect(denyIndex).toBeLessThan(allowIndex);
  });

  it("should drop a duplicate existing launch-process deny entry that exactly matches a generated one", async () => {
    const settingsDir = join(testDir, ".augment");
    await ensureDir(settingsDir);
    await writeFileContent(
      join(settingsDir, "settings.json"),
      JSON.stringify({
        toolPermissions: [
          {
            toolName: "launch-process",
            shellInputRegex: "^rm .*$",
            permission: { type: "deny" },
          },
        ],
      }),
    );

    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: { bash: { "rm *": "deny" } },
      }),
    });

    const instance = await AugmentcodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const entries = JSON.parse(instance.getFileContent()).toolPermissions as Array<{
      toolName: string;
      shellInputRegex?: string;
      permission: { type: string };
    }>;
    // Exactly one occurrence of the matching entry — no duplication.
    expect(
      entries.filter(
        (e) =>
          e.toolName === "launch-process" &&
          e.shellInputRegex === "^rm .*$" &&
          e.permission.type === "deny",
      ),
    ).toHaveLength(1);
  });

  it("should fail-closed for non-bash categories: a single deny collapses all rules to a catch-all deny entry", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: {
          read: { "src/**": "allow", ".env": "deny" },
        },
      }),
    });

    const instance = await AugmentcodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const entries = JSON.parse(instance.getFileContent()).toolPermissions as Array<{
      toolName: string;
      shellInputRegex?: string;
      permission: { type: string };
    }>;
    const view = entries.filter((e) => e.toolName === "view");
    expect(view).toHaveLength(1);
    expect(view[0]?.permission.type).toBe("deny");
    expect(view[0]?.shellInputRegex).toBeUndefined();
    // Aggregated warn for the collapse
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("contains a 'deny' rule"));
  });

  it("should drop non-wildcard non-bash patterns when no deny exists and aggregate-warn once per category", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: {
          read: { "src/**": "allow", "lib/**": "allow", "*": "ask" },
        },
      }),
    });

    const instance = await AugmentcodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const entries = JSON.parse(instance.getFileContent()).toolPermissions as Array<{
      toolName: string;
      shellInputRegex?: string;
      permission: { type: string };
    }>;
    const view = entries.filter((e) => e.toolName === "view");
    // Only the catch-all `*` ask entry should be emitted; the non-`*` allow patterns are dropped.
    expect(view).toEqual([{ toolName: "view", permission: { type: "ask-user" } }]);
    // Aggregate warn (single call) listing the dropped patterns.
    const dropCalls = logger.warn.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && c[0].includes("dropping non-wildcard patterns"),
    );
    expect(dropCalls).toHaveLength(1);
    expect(dropCalls[0]?.[0]).toContain("src/**");
    expect(dropCalls[0]?.[0]).toContain("lib/**");
  });

  it("should sort generated entries deny-first then specific-first to make first-match-wins safe", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: {
          // Deliberately put catch-all first in input to verify we sort by specificity, not by
          // insertion order.
          bash: { "*": "ask", "git *": "allow", "rm -rf *": "deny" },
        },
      }),
    });

    const instance = await AugmentcodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const entries = JSON.parse(instance.getFileContent()).toolPermissions as Array<{
      toolName: string;
      shellInputRegex?: string;
      permission: { type: string };
    }>;
    const launchEntries = entries.filter((e) => e.toolName === "launch-process");
    // Expect: deny first, then specific allow, then catch-all ask.
    expect(launchEntries[0]?.permission.type).toBe("deny");
    expect(launchEntries[0]?.shellInputRegex).toBe("^rm -rf .*$");
    expect(launchEntries[1]?.permission.type).toBe("allow");
    expect(launchEntries[1]?.shellInputRegex).toBe("^git .*$");
    expect(launchEntries[2]?.permission.type).toBe("ask-user");
    expect(launchEntries[2]?.shellInputRegex).toBeUndefined();
  });

  it("should round-trip toolPermissions back to rulesync format", () => {
    const instance = new AugmentcodePermissions({
      relativeDirPath: ".augment",
      relativeFilePath: "settings.json",
      fileContent: JSON.stringify({
        toolPermissions: [
          {
            toolName: "launch-process",
            shellInputRegex: "^git .*$",
            permission: { type: "allow" },
          },
          {
            toolName: "view",
            permission: { type: "deny" },
          },
          {
            toolName: "save-file",
            permission: { type: "ask-user" },
          },
        ],
      }),
    });

    const config = instance.toRulesyncPermissions().getJson();
    expect(config.permission.bash).toBeDefined();
    expect(config.permission.bash!["git *"]).toBe("allow");
    expect(config.permission.read).toEqual({ "*": "deny" });
    expect(config.permission.write).toEqual({ "*": "ask" });
  });

  it("forDeletion returns non-deletable instance", () => {
    const instance = AugmentcodePermissions.forDeletion({
      outputRoot: testDir,
      relativeDirPath: ".augment",
      relativeFilePath: "settings.json",
    });
    expect(instance.isDeletable()).toBe(false);
  });

  it("should resolve fail-closed when an AugmentCode file has both deny and allow for the same managed non-bash tool (deny first)", () => {
    const instance = new AugmentcodePermissions({
      relativeDirPath: ".augment",
      relativeFilePath: "settings.json",
      fileContent: JSON.stringify({
        toolPermissions: [
          { toolName: "view", permission: { type: "deny" } },
          { toolName: "view", permission: { type: "allow" } },
        ],
      }),
    });

    const config = instance.toRulesyncPermissions().getJson();
    // Without fail-closed precedence, last-write-wins would silently turn this into `allow`.
    expect(config.permission.read).toEqual({ "*": "deny" });
  });

  it("should resolve fail-closed when an AugmentCode file has both allow and deny for the same managed non-bash tool (allow first)", () => {
    const instance = new AugmentcodePermissions({
      relativeDirPath: ".augment",
      relativeFilePath: "settings.json",
      fileContent: JSON.stringify({
        toolPermissions: [
          { toolName: "view", permission: { type: "allow" } },
          { toolName: "view", permission: { type: "deny" } },
        ],
      }),
    });

    const config = instance.toRulesyncPermissions().getJson();
    // Reverse iteration order: precedence still picks `deny`.
    expect(config.permission.read).toEqual({ "*": "deny" });
  });

  it("should resolve precedence as deny > ask > allow when collapsing managed non-bash tool entries", () => {
    const instance = new AugmentcodePermissions({
      relativeDirPath: ".augment",
      relativeFilePath: "settings.json",
      fileContent: JSON.stringify({
        toolPermissions: [
          { toolName: "view", permission: { type: "allow" } },
          { toolName: "view", permission: { type: "ask-user" } },
        ],
      }),
    });

    const config = instance.toRulesyncPermissions().getJson();
    expect(config.permission.read).toEqual({ "*": "ask" });
  });
});

import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { OpencodePermissions } from "./opencode-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

describe("OpencodePermissions", () => {
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

  it("should resolve project and global settable paths", () => {
    expect(OpencodePermissions.getSettablePaths()).toEqual({
      relativeDirPath: ".",
      relativeFilePath: "opencode.json",
    });
    expect(OpencodePermissions.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(".config", "opencode"),
      relativeFilePath: "opencode.json",
    });
  });

  it("should load opencode.jsonc and initialize permission", async () => {
    await writeFileContent(join(testDir, "opencode.jsonc"), JSON.stringify({ model: "x" }));

    const instance = await OpencodePermissions.fromFile({ outputRoot: testDir });
    const json = instance.getJson();

    expect(instance.getRelativeFilePath()).toBe("opencode.jsonc");
    expect(json.permission).toEqual({});
  });

  it("should merge permission rules from .opencode/opencode.json over the root config", async () => {
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({ permission: { bash: { "*": "ask" }, edit: "deny" } }),
    );
    await writeFileContent(
      join(testDir, ".opencode", "opencode.json"),
      JSON.stringify({ permission: { bash: { "git *": "allow" }, webfetch: "allow" } }),
    );

    const instance = await OpencodePermissions.fromFile({ outputRoot: testDir });

    expect(instance.getRelativeFilePath()).toBe("opencode.json");
    expect(instance.getJson().permission).toEqual({
      bash: { "*": "ask", "git *": "allow" },
      edit: "deny",
      webfetch: "allow",
    });
  });

  it("should warn when .opencode/opencode.json overrides a generated permission key", async () => {
    await writeFileContent(
      join(testDir, ".opencode", "opencode.jsonc"),
      JSON.stringify({ permission: { bash: "allow", webfetch: "deny" } }),
    );
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({ permission: { bash: { "*": "ask" } } }),
    });
    const logger = { warn: vi.fn() } as any;

    await OpencodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      'OpenCode merges ".opencode/opencode.jsonc" over the generated "opencode.jsonc", so its values for these generated entries take precedence: "permission" > "bash".',
    );
  });

  it("should merge rulesync permission into existing opencode config", async () => {
    await writeFileContent(join(testDir, "opencode.json"), JSON.stringify({ model: "x" }));
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: {
          bash: { "*": "ask", "git *": "allow" },
        },
      }),
    });

    const instance = await OpencodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    const json = JSON.parse(instance.getFileContent());

    expect(instance.getRelativeFilePath()).toBe("opencode.json");
    expect(json.model).toBe("x");
    expect(json.permissions).toEqual([
      { action: "shell", resource: "*", effect: "ask" },
      { action: "shell", resource: "git *", effect: "allow" },
    ]);
    expect(json.permission).toBeUndefined();
  });

  it("should import the top-level uniform string permission form (issue #2066)", async () => {
    await writeFileContent(join(testDir, "opencode.json"), JSON.stringify({ permission: "allow" }));

    const instance = await OpencodePermissions.fromFile({ outputRoot: testDir });

    expect(instance.getJson().permission).toBe("allow");

    const rulesync = instance.toRulesyncPermissions().getJson();
    expect(rulesync.permission).toEqual({ "*": { "*": "allow" } });
  });

  it("should route OpenCode-only categories into the opencode override on import", async () => {
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({
        permission: {
          bash: { "git *": "allow" },
          external_directory: "deny",
        },
      }),
    );

    const instance = await OpencodePermissions.fromFile({ outputRoot: testDir });
    const rulesync = instance.toRulesyncPermissions().getJson();

    // Shared canonical category stays in the shared block.
    expect(rulesync.permission.bash).toEqual({ "git *": "allow" });
    expect(rulesync.permission.external_directory).toBeUndefined();
    // OpenCode-only categories move under the override, preserving their shape.
    expect(rulesync.opencode?.permission).toEqual({
      external_directory: "deny",
    });
  });

  it("should translate OpenCode's `task` key into the canonical `agent` category on import (issue #2230)", async () => {
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({
        permission: {
          bash: { "git *": "allow" },
          task: "deny",
        },
      }),
    );

    const instance = await OpencodePermissions.fromFile({ outputRoot: testDir });
    const rulesync = instance.toRulesyncPermissions().getJson();

    // OpenCode's `task` key is the subagent-launch permission; it maps to the
    // canonical `agent` category in the shared block (not the override).
    expect(rulesync.permission.agent).toEqual({ "*": "deny" });
    expect(rulesync.permission.task).toBeUndefined();
    expect(rulesync.opencode).toBeUndefined();
  });

  it("should drop blank patterns from the OpenCode-scoped override block on import", async () => {
    // The override block is built from the user's config verbatim, so a blank
    // pattern reaches it. Left there it would write a source file the next
    // `generate` refuses.
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({
        permission: {
          bash: { "": "allow", "git *": "allow" },
          external_directory: { "  ": "deny", "/tmp/**": "allow" },
        },
      }),
    );

    const imported = (
      await OpencodePermissions.fromFile({ outputRoot: testDir })
    ).toRulesyncPermissions();

    expect(imported.getJson().permission.bash).toEqual({ "git *": "allow" });
    expect(imported.getJson().opencode).toEqual({
      permission: { external_directory: { "/tmp/**": "allow" } },
    });
    expect(imported.validate().success).toBe(true);
  });

  it("should import OpenCode's `edit` key as the canonical `edit` only", async () => {
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({ permission: { edit: { "*": "deny" } } }),
    );

    const imported = await OpencodePermissions.fromFile({ outputRoot: testDir });
    const rulesync = imported.toRulesyncPermissions().getJson();

    expect(rulesync.permission).toEqual({ edit: { "*": "deny" } });
  });

  it("should round-trip the canonical `agent`/OpenCode `task` category (issue #2230)", async () => {
    await writeFileContent(join(testDir, "opencode.json"), JSON.stringify({}));
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: { agent: { "*": "deny" } },
      }),
    });

    const generated = await OpencodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    await writeFileContent(join(testDir, "opencode.json"), generated.getFileContent());

    const imported = await OpencodePermissions.fromFile({ outputRoot: testDir });
    const rulesync = imported.toRulesyncPermissions().getJson();

    expect(rulesync.permission).toEqual({ agent: { "*": "deny" } });
    expect(rulesync.opencode).toBeUndefined();
  });

  it("should keep the all-tools wildcard category in the shared block on import", async () => {
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({ permission: { "*": "ask" } }),
    );

    const instance = await OpencodePermissions.fromFile({ outputRoot: testDir });
    const rulesync = instance.toRulesyncPermissions().getJson();

    // `"*"` is the all-tools key: it must stay shared (matching the string form
    // `"permission": "ask"`), not be routed into the OpenCode-only override.
    expect(rulesync.permission).toEqual({ "*": { "*": "ask" } });
    expect(rulesync.opencode).toBeUndefined();
  });

  it("should omit the opencode override when there are no OpenCode-only categories", async () => {
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({ permission: { bash: { "git *": "allow" } } }),
    );

    const instance = await OpencodePermissions.fromFile({ outputRoot: testDir });
    const rulesync = instance.toRulesyncPermissions().getJson();

    expect(rulesync.permission.bash).toEqual({ "git *": "allow" });
    expect(rulesync.opencode).toBeUndefined();
  });

  it("should support global mode file resolution", async () => {
    await ensureDir(join(testDir, ".config", "opencode"));
    await writeFileContent(
      join(testDir, ".config", "opencode", "opencode.jsonc"),
      JSON.stringify({ permission: { bash: "ask" } }),
    );

    const instance = await OpencodePermissions.fromFile({ outputRoot: testDir, global: true });
    const rulesync = instance.toRulesyncPermissions().getJson();

    expect(rulesync.permission.bash).toEqual({ "*": "ask" });
  });
  it("should read a commented opencode.jsonc and keep the comments when regenerating", async () => {
    const commented = [
      "{",
      "  // Which model this project talks to.",
      '  "model": "x",',
      '  "permission": { "bash": "ask" }',
      "}",
    ].join("\n");
    await writeFileContent(join(testDir, "opencode.jsonc"), commented);

    const imported = await OpencodePermissions.fromFile({ outputRoot: testDir });
    expect(imported.toRulesyncPermissions().getJson().permission.bash).toEqual({ "*": "ask" });

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({ permission: { bash: { "git *": "allow" } } }),
    });
    const generated = await OpencodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    expect(generated.getFileContent()).toContain("// Which model this project talks to.");
    expect(generated.getJson().permissions).toEqual([
      { action: "shell", resource: "git *", effect: "allow" },
    ]);
    expect(generated.getJson().permission).toBeUndefined();
  });

  it("should treat an explicit null permission as an empty block", async () => {
    await writeFileContent(join(testDir, "opencode.json"), '{ "permission": null }');

    const instance = await OpencodePermissions.fromFile({ outputRoot: testDir });

    expect(instance.getJson().permission).toEqual({});
  });

  it("should ignore a permission block reachable only through __proto__", async () => {
    // `jsonc-parser` assigns keys with `obj[key] = value`, so a literal
    // `"__proto__"` replaces the parsed object's prototype instead of becoming a
    // key. Reading `permission` off the prototype would import rules the word
    // "permission" never appears next to in the file.
    await writeFileContent(
      join(testDir, "opencode.json"),
      '{ "__proto__": { "permission": { "bash": "allow" } } }',
    );

    const instance = await OpencodePermissions.fromFile({ outputRoot: testDir });

    expect(instance.getJson().permission).toEqual({});
  });
});

describe("OpencodePermissions (OpenCode V2 permissions array)", () => {
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

  const generate = async (config: unknown, logger?: { warn: ReturnType<typeof vi.fn> }) => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify(config),
    });
    return OpencodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger: logger as any,
    });
  };

  it("renames V1 keys to V2 actions in category and pattern order", async () => {
    const instance = await generate({
      permission: {
        "*": { "*": "ask" },
        bash: { "*": "ask", "git push *": "deny" },
        agent: { "*": "deny", reviewer: "allow" },
        read: { "*.env": "deny" },
      },
    });

    expect(instance.getJson().permissions).toEqual([
      { action: "*", resource: "*", effect: "ask" },
      { action: "shell", resource: "*", effect: "ask" },
      { action: "shell", resource: "git push *", effect: "deny" },
      { action: "subagent", resource: "*", effect: "deny" },
      { action: "subagent", resource: "reviewer", effect: "allow" },
      { action: "read", resource: "*.env", effect: "deny" },
    ]);
  });

  it("writes an opencode.permission.apply_patch key as the V2 edit action", async () => {
    const instance = await generate({ opencode: { permission: { apply_patch: "deny" } } });

    expect(instance.getJson().permissions).toEqual([
      { action: "edit", resource: "*", effect: "deny" },
    ]);
  });

  it("keeps URL patterns on webfetch instead of collapsing them", async () => {
    const logger = { warn: vi.fn() };
    const instance = await generate(
      { permission: { webfetch: { "*": "allow", "https://private.example/*": "deny" } } },
      logger,
    );

    expect(instance.getJson().permissions).toEqual([
      { action: "webfetch", resource: "*", effect: "allow" },
      { action: "webfetch", resource: "https://private.example/*", effect: "deny" },
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("folds write into edit keeping the stricter action per pattern", async () => {
    const instance = await generate({
      permission: {
        edit: { "*": "allow", "*.env": "deny" },
        write: { "*": "ask" },
      },
    });

    // Merged allow → ask → deny so neither rule set is loosened.
    expect(instance.getJson().permissions).toEqual([
      { action: "edit", resource: "*", effect: "ask" },
      { action: "edit", resource: "*.env", effect: "deny" },
    ]);
  });

  it("emits the opencode override block after mapping its keys, the override winning per key", async () => {
    const instance = await generate({
      permission: { bash: { "*": "ask" }, webfetch: { "*": "ask" } },
      opencode: {
        permission: { external_directory: "deny", webfetch: "allow", skill: { "*": "ask" } },
      },
    });

    expect(instance.getJson().permissions).toEqual([
      { action: "shell", resource: "*", effect: "ask" },
      { action: "webfetch", resource: "*", effect: "allow" },
      { action: "external_directory", resource: "*", effect: "deny" },
      { action: "skill", resource: "*", effect: "ask" },
    ]);
  });

  it("skips notebookedit with a warning", async () => {
    const logger = { warn: vi.fn() };
    const instance = await generate({ permission: { notebookedit: { "*": "deny" } } }, logger);

    expect(instance.getJson().permissions).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"notebookedit"'));
  });

  it("retracts a V1 permission map and keeps unrelated keys", async () => {
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({ model: "x", permission: { bash: "deny" }, tools: { foo_bar: false } }),
    );
    const instance = await generate({ permission: { bash: { "*": "ask" } } });
    const json = JSON.parse(instance.getFileContent());

    expect(json.permission).toBeUndefined();
    expect(json.model).toBe("x");
    expect(json.tools).toEqual({ foo_bar: false });
    expect(json.permissions).toEqual([{ action: "shell", resource: "*", effect: "ask" }]);
  });

  it("imports a V2 permissions array, mapping actions back to canonical categories", async () => {
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({
        permissions: [
          { action: "shell", resource: "*", effect: "ask" },
          { action: "shell", resource: "git status *", effect: "allow" },
          { action: "subagent", resource: "reviewer", effect: "deny" },
          { action: "external_directory", resource: "*", effect: "deny" },
          { action: "shell", resource: "*", effect: "deny" },
        ],
      }),
    );

    const rulesync = (await OpencodePermissions.fromFile({ outputRoot: testDir }))
      .toRulesyncPermissions()
      .getJson();

    expect(rulesync.permission).toEqual({
      bash: { "git status *": "allow", "*": "deny" },
      agent: { reviewer: "deny" },
    });
    expect(rulesync.opencode?.permission).toEqual({ external_directory: { "*": "deny" } });
  });

  it("applies a V2 permissions array after the V1 map of the same file on import", async () => {
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({
        permission: { bash: { "*": "allow", "rm *": "deny" } },
        permissions: [{ action: "shell", resource: "*", effect: "ask" }],
      }),
    );

    const rulesync = (await OpencodePermissions.fromFile({ outputRoot: testDir }))
      .toRulesyncPermissions()
      .getJson();

    expect(rulesync.permission.bash).toEqual({ "rm *": "deny", "*": "ask" });
  });

  it("moves a key the V2 array touches after the V1-only keys on import", async () => {
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({
        permission: { "*": "ask", edit: "deny" },
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      }),
    );

    const imported = await OpencodePermissions.fromFile({ outputRoot: testDir });

    // OpenCode V2 evaluates [* ask, edit deny, * allow]: the trailing allow
    // must stay after `edit` so edits are still allowed after a regenerate.
    expect(Object.keys(imported.getJson().permission ?? {})).toEqual(["edit", "*"]);
    expect(imported.toRulesyncPermissions().getJson().permission).toEqual({
      edit: { "*": "deny" },
      "*": { "*": "allow" },
    });
  });

  it("denies an empty webfetch map instead of emitting no rule, with a warning", async () => {
    const logger = { warn: vi.fn() };
    const instance = await generate({ permission: { webfetch: {}, read: {} } }, logger);

    expect(instance.getJson().permissions).toEqual([
      { action: "webfetch", resource: "*", effect: "deny" },
    ]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("default allow"));
  });

  it("collapses action-only keys that match only * to a single action", async () => {
    const instance = await generate({
      permission: { todowrite: { foo: "allow" }, question: { "*": "deny" } },
    });

    expect(instance.getJson().permissions).toEqual([
      { action: "todowrite", resource: "*", effect: "ask" },
      { action: "question", resource: "*", effect: "deny" },
    ]);
  });

  it("round-trips generate → import", async () => {
    const config = {
      permission: { bash: { "*": "ask", "git *": "allow" }, agent: { "*": "deny" } },
      opencode: { permission: { external_directory: { "*": "deny" } } },
    };
    const generated = await generate(config);
    await writeFileContent(join(testDir, "opencode.json"), generated.getFileContent());

    const rulesync = (await OpencodePermissions.fromFile({ outputRoot: testDir }))
      .toRulesyncPermissions()
      .getJson();

    expect(rulesync).toEqual(config);
  });
  it("writes canonical MCP categories as OpenCode's sanitized <server>_<tool> actions", async () => {
    const logger = { warn: vi.fn() };
    const instance = await generate(
      {
        permission: {
          mcp__deepwiki__ask_question: { "*": "deny" },
          "mcp__my.server__get-item": { "*": "ask" },
          "mcp__github__get_*": { "*": "allow" },
          mcp__context7: { "*": "deny" },
          "mcp__*": { "*": "ask" },
        },
      },
      logger,
    );

    expect(instance.getJson().permissions).toEqual([
      { action: "deepwiki_ask_question", resource: "*", effect: "deny" },
      { action: "my_server_get-item", resource: "*", effect: "ask" },
      { action: "github_get_*", resource: "*", effect: "allow" },
      { action: "context7_*", resource: "*", effect: "deny" },
      { action: "mcp__*", resource: "*", effect: "ask" },
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain('"mcp__*"');
  });

  it("imports <server>_<tool> actions of declared MCP servers as canonical MCP categories", async () => {
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({
        mcp: { servers: { github: { type: "remote", url: "https://example.com/mcp" } } },
        permissions: [
          { action: "github_get_issue", resource: "*", effect: "deny" },
          { action: "github_*", resource: "*", effect: "ask" },
          { action: "unknown_tool", resource: "*", effect: "deny" },
        ],
      }),
    );

    const rulesync = (await OpencodePermissions.fromFile({ outputRoot: testDir }))
      .toRulesyncPermissions()
      .getJson();

    expect(rulesync.permission).toEqual({
      mcp__github__get_issue: { "*": "deny" },
      mcp__github: { "*": "ask" },
    });
    expect(rulesync.opencode?.permission).toEqual({ unknown_tool: { "*": "deny" } });
  });

  it("does not claim an OpenCode built-in key for an MCP server that prefixes it", async () => {
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({
        mcp: { servers: { external: { type: "remote", url: "https://example.com/mcp" } } },
        permissions: [{ action: "external_directory", resource: "*", effect: "deny" }],
      }),
    );

    const rulesync = (await OpencodePermissions.fromFile({ outputRoot: testDir }))
      .toRulesyncPermissions()
      .getJson();

    expect(rulesync.opencode?.permission).toEqual({ external_directory: { "*": "deny" } });
  });
});

import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { PermissionAction } from "../../types/permissions.js";
import { readFileContent, writeFileContent } from "../../utils/file.js";
import {
  convertFromDeepcodePermissions,
  convertToDeepcodePermissions,
  DeepcodePermissions,
  deepcodePatternSpecificity,
} from "./deepcode-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

function rulesyncPermissionsFrom(config: Record<string, unknown>): RulesyncPermissions {
  return new RulesyncPermissions({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
    fileContent: JSON.stringify(config),
  });
}

/** fnmatch as DeepCode uses it: `*` spans everything, `?` is one character. */
function fnmatch(pattern: string, value: string): boolean {
  const source = [...pattern]
    .map((character) =>
      character === "*"
        ? ".*"
        : character === "?"
          ? "."
          : character.replace(/[.+^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return new RegExp(`^${source}$`, "s").test(value);
}

/**
 * DeepCode's evaluator: the map is flattened in key order, each key's
 * patterns sorted by specificity (stable), and the last rule whose tool-name
 * wildcard and pattern both match decides.
 */
function evaluateDeepcode({
  permissions,
  tool,
  argument,
}: {
  permissions: Record<string, string | Record<string, PermissionAction>>;
  tool: string;
  argument: string;
}): PermissionAction | undefined {
  let decision: PermissionAction | undefined;
  for (const [toolKey, spec] of Object.entries(permissions)) {
    const entries: Array<[string, PermissionAction]> =
      typeof spec === "string"
        ? [["*", spec as PermissionAction]]
        : Object.entries(spec).toSorted(
            ([a], [b]) => deepcodePatternSpecificity(a) - deepcodePatternSpecificity(b),
          );
    for (const [pattern, action] of entries) {
      if (fnmatch(toolKey, tool) && fnmatch(pattern, argument)) {
        decision = action;
      }
    }
  }
  return decision;
}

describe("convertToDeepcodePermissions", () => {
  it("should map categories to DeepCode tool names and collapse catch-alls to strings", () => {
    const result = convertToDeepcodePermissions({
      permission: {
        bash: { "*": "ask", "git *": "allow", "rm -rf *": "deny" },
        webfetch: { "*": "ask" },
        read: { "src/**": "allow" },
        agent: { "*": "deny" },
      },
    });

    expect(result).toEqual({
      bash: { "*": "ask", "git *": "allow", "rm -rf *": "deny" },
      web_fetch: "ask",
      read: { "src/**": "allow" },
      spawn_agent: "deny",
    });
  });

  it("should keep a narrower allow carved out of the author's catch-all", () => {
    const permissions = convertToDeepcodePermissions({
      permission: { bash: { "git *": "allow", "*": "ask" } },
    });

    expect(permissions).toEqual({ bash: { "*": "ask", "git *": "allow" } });
    expect(evaluateDeepcode({ permissions, tool: "bash", argument: "git status" })).toBe("allow");
    expect(evaluateDeepcode({ permissions, tool: "bash", argument: "ls" })).toBe("ask");
  });

  it("should withhold an allow that is more specific than an overlapping deny", () => {
    const warn = vi.fn();
    const permissions = convertToDeepcodePermissions({
      permission: { bash: { "git status*": "allow", "git *": "deny" } },
      logger: { warn } as never,
    });

    expect(permissions).toEqual({ bash: { "git *": "deny" } });
    expect(evaluateDeepcode({ permissions, tool: "bash", argument: "git status" })).toBe("deny");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("were withheld"));
  });

  it("should raise an ask that is more specific than an overlapping deny", () => {
    const warn = vi.fn();
    const permissions = convertToDeepcodePermissions({
      permission: { bash: { "* status": "ask", "git *": "deny", "*": "allow" } },
      logger: { warn } as never,
    });

    expect(permissions).toEqual({ bash: { "*": "allow", "git *": "deny", "* status": "deny" } });
    expect(evaluateDeepcode({ permissions, tool: "bash", argument: "git status" })).toBe("deny");
    // Inputs only the ask covered stay restricted rather than falling to the allow.
    expect(evaluateDeepcode({ permissions, tool: "bash", argument: "svn status" })).toBe("deny");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("were written as deny"));
  });

  it("should order equally specific rules so the stricter one is the last match", () => {
    const permissions = convertToDeepcodePermissions({
      permission: { bash: { "*b": "deny", "a*": "allow" } },
    });

    expect(Object.keys(permissions.bash as object)).toEqual(["a*", "*b"]);
    expect(evaluateDeepcode({ permissions, tool: "bash", argument: "ab" })).toBe("deny");
  });

  it("should write the all-tools key first and restate its restrictions in later keys", () => {
    const permissions = convertToDeepcodePermissions({
      permission: {
        read: { "*": "allow", "src/**": "allow" },
        "*": { ".env": "deny", "*": "ask" },
        bash: { "git *": "allow" },
      },
    });

    expect(Object.keys(permissions)).toEqual(["*", "read", "bash"]);
    // A same-pattern `*` rule wins (deny > ask > allow), so `read`'s own
    // catch-all becomes the stricter ask; its narrower allow is still carved out.
    expect(permissions.read).toEqual({ "*": "ask", ".env": "deny", "src/**": "allow" });
    expect(evaluateDeepcode({ permissions, tool: "read", argument: ".env" })).toBe("deny");
    expect(evaluateDeepcode({ permissions, tool: "read", argument: "src/a.ts" })).toBe("allow");
    // The `*` catch-all is the default a tool's own rules override.
    expect(evaluateDeepcode({ permissions, tool: "bash", argument: "git log" })).toBe("allow");
    expect(evaluateDeepcode({ permissions, tool: "edit", argument: "src/a.ts" })).toBe("ask");
  });

  it("should restate an all-tools catch-all over a looser catch-all of the same tool", () => {
    const permissions = convertToDeepcodePermissions({
      permission: { "*": { "*": "deny" }, bash: { "*": "allow" } },
    });

    expect(evaluateDeepcode({ permissions, tool: "bash", argument: "ls" })).toBe("deny");
  });

  it("should skip categories DeepCode has no tool for and pass other names through", () => {
    const warn = vi.fn();
    const permissions = convertToDeepcodePermissions({
      permission: {
        websearch: { "*": "allow" },
        notebookedit: { "*": "deny" },
        apply_patch: { "*": "ask" },
      },
      logger: { warn } as never,
    });

    expect(permissions).toEqual({ apply_patch: "ask" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("websearch"));
  });
});

describe("convertFromDeepcodePermissions", () => {
  it("should read plain strings as catch-alls and order patterns as DeepCode evaluates them", () => {
    const { shared, toolScoped } = convertFromDeepcodePermissions({
      permissions: {
        bash: { "git push*": "deny", "git *": "allow", "*": "ask" },
        web_fetch: "ASK",
        apply_patch: "deny",
        "mcp__*": { "*": "ask" },
      },
    });

    expect(shared).toEqual({
      bash: { "*": "ask", "git *": "allow", "git push*": "deny" },
      webfetch: { "*": "ask" },
    });
    expect(Object.keys(shared.bash ?? {})).toEqual(["*", "git *", "git push*"]);
    expect(toolScoped).toEqual({ apply_patch: { "*": "deny" }, "mcp__*": { "*": "ask" } });
  });

  it("should skip unknown actions with a warning", () => {
    const warn = vi.fn();
    const { shared } = convertFromDeepcodePermissions({
      permissions: { bash: { "git *": "always", ls: "allow" }, read: 3 },
      logger: { warn } as never,
    });

    expect(shared).toEqual({ bash: { ls: "allow" } });
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("DeepcodePermissions", () => {
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

  it("should write deepcode_config.json at the project root and under .deepcode globally", () => {
    expect(DeepcodePermissions.getSettablePaths()).toEqual({
      relativeDirPath: ".",
      relativeFilePath: "deepcode_config.json",
    });
    expect(DeepcodePermissions.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: ".deepcode",
      relativeFilePath: "deepcode_config.json",
    });
  });

  it("should replace only security.permissions and keep every other key", async () => {
    await writeFileContent(
      join(testDir, "deepcode_config.json"),
      JSON.stringify({
        security: { accessPreset: "read_only", permissions: { bash: "allow" } },
        mcpServers: { local: { type: "stdio", command: "srv" } },
        goal: { completionVerifier: "rule" },
      }),
    );

    const permissions = await DeepcodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissionsFrom({
        permission: { bash: { "git push*": "deny" } },
      }),
    });

    expect(JSON.parse(permissions.getFileContent())).toEqual({
      security: { accessPreset: "read_only", permissions: { bash: { "git push*": "deny" } } },
      mcpServers: { local: { type: "stdio", command: "srv" } },
      goal: { completionVerifier: "rule" },
    });
  });

  it("should drop security.permissions when no rule is written", async () => {
    await writeFileContent(
      join(testDir, "deepcode_config.json"),
      JSON.stringify({ security: { accessPreset: "ask", permissions: { bash: "allow" } } }),
    );

    const permissions = await DeepcodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissionsFrom({ permission: {} }),
    });

    expect(JSON.parse(permissions.getFileContent())).toEqual({
      security: { accessPreset: "ask" },
    });
  });

  it("should round-trip hand-written rules through import without duplicating them", async () => {
    const native = {
      security: {
        accessPreset: "ask",
        permissions: {
          bash: { "*": "ask", "npm test*": "allow", "git push*": "deny" },
          web_fetch: "ask",
          apply_patch: "ask",
        },
      },
    };
    await writeFileContent(join(testDir, "deepcode_config.json"), JSON.stringify(native));

    const imported = (
      await DeepcodePermissions.fromFile({ outputRoot: testDir })
    ).toRulesyncPermissions();
    expect(imported.getJson()).toMatchObject({
      permission: {
        bash: { "*": "ask", "npm test*": "allow", "git push*": "deny" },
        webfetch: { "*": "ask" },
      },
      deepcode: { permission: { apply_patch: { "*": "ask" } } },
    });

    const regenerated = await DeepcodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: imported.forTarget({ toolTarget: "deepcode" }),
    });
    await writeFileContent(join(testDir, "deepcode_config.json"), regenerated.getFileContent());

    expect(JSON.parse(await readFileContent(join(testDir, "deepcode_config.json")))).toEqual(
      native,
    );
  });
});

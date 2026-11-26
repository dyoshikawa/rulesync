import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncHooks } from "./rulesync-hooks.js";
import { ZeroHooks } from "./zero-hooks.js";

function makeRulesyncHooks(config: unknown): RulesyncHooks {
  return new RulesyncHooks({
    outputRoot: "/mock",
    relativeDirPath: ".rulesync",
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
  });
}

async function generate({
  testDir,
  config,
  global = false,
  logger,
}: {
  testDir: string;
  config: unknown;
  global?: boolean;
  logger?: ReturnType<typeof createMockLogger>;
}): Promise<{ enabled: boolean; hooks: Array<Record<string, unknown>> }> {
  const hooks = await ZeroHooks.fromRulesyncHooks({
    outputRoot: testDir,
    rulesyncHooks: makeRulesyncHooks(config),
    global,
    logger,
  });
  return JSON.parse(hooks.getFileContent());
}

describe("ZeroHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should use .zero/hooks.json in project scope", () => {
      expect(ZeroHooks.getSettablePaths()).toEqual({
        relativeDirPath: ".zero",
        relativeFilePath: "hooks.json",
      });
    });

    it.each([
      ["linux", join(".config", "zero")],
      ["darwin", join(".config", "zero")],
      ["win32", join("AppData", "Roaming", "zero")],
    ] as const)("should use the %s user config dir in global scope", (platform, expected) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      expect(ZeroHooks.getSettablePaths({ global: true }).relativeDirPath).toBe(expected);
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should map events and wrap commands in sh -c", async () => {
      const parsed = await generate({
        testDir,
        config: {
          hooks: {
            sessionStart: [{ command: "echo start" }],
            subagentStop: [{ command: "echo done", matcher: "worker" }],
            stop: [{ command: "echo stop" }],
          },
        },
      });

      expect(parsed).toEqual({
        enabled: true,
        hooks: [
          {
            id: "rulesync-project-sessionStart-001",
            event: "sessionStart",
            command: "sh",
            args: ["-c", "echo start"],
            enabled: true,
          },
          {
            id: "rulesync-project-specialistStop-001",
            event: "specialistStop",
            matcher: "worker",
            command: "sh",
            args: ["-c", "echo done"],
            enabled: true,
          },
        ],
      });
    });

    it("should translate a Bash guard to Zero's bash tool", async () => {
      const parsed = await generate({
        testDir,
        config: { hooks: { preToolUse: [{ command: "guard.sh", matcher: "Bash" }] } },
      });
      expect(parsed.hooks).toEqual([
        expect.objectContaining({ event: "beforeTool", matcher: "bash" }),
      ]);
    });

    it("should split an alternation into one hook per Zero tool", async () => {
      const parsed = await generate({
        testDir,
        config: { hooks: { preToolUse: [{ command: "guard.sh", matcher: "Write|Edit" }] } },
      });
      expect(parsed.hooks.map((hook) => [hook.id, hook.matcher])).toEqual([
        ["rulesync-project-beforeTool-001", "write_file"],
        ["rulesync-project-beforeTool-002", "edit_file"],
        ["rulesync-project-beforeTool-003", "apply_patch"],
      ]);
    });

    it("should translate MCP names and globs", async () => {
      const parsed = await generate({
        testDir,
        config: { hooks: { postToolUse: [{ command: "log.sh", matcher: "mcp__my-server__.*" }] } },
      });
      expect(parsed.hooks[0]?.matcher).toBe("mcp_my_server_*");
    });

    it("should omit the matcher for a match-all matcher", async () => {
      const parsed = await generate({
        testDir,
        config: { hooks: { preToolUse: [{ command: "guard.sh", matcher: ".*" }] } },
      });
      expect(parsed.hooks[0]).not.toHaveProperty("matcher");
    });

    it("should skip a hook whose matcher Zero cannot express, with a warning", async () => {
      const logger = createMockLogger();
      const parsed = await generate({
        testDir,
        config: { hooks: { preToolUse: [{ command: "guard.sh", matcher: "Bash(git .*)" }] } },
        logger,
      });
      expect(parsed.hooks).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("guard will not run"));
    });

    it("should warn about a preToolUse matcher naming no Zero tool", async () => {
      const logger = createMockLogger();
      const parsed = await generate({
        testDir,
        config: { hooks: { preToolUse: [{ command: "guard.sh", matcher: "NotebookEdit" }] } },
        logger,
      });
      expect(parsed.hooks[0]?.matcher).toBe("NotebookEdit");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("is not a Zero built-in tool"),
      );
    });

    it("should use user-scoped ids in global mode", async () => {
      const parsed = await generate({
        testDir,
        config: { hooks: { sessionEnd: [{ command: "echo bye" }] } },
        global: true,
      });
      expect(parsed.hooks[0]?.id).toBe("rulesync-user-sessionEnd-001");
    });

    it("should keep hand-written hooks and the enabled flag, replacing rulesync's own", async () => {
      await writeFileContent(
        join(testDir, ".zero", "hooks.json"),
        JSON.stringify({
          enabled: false,
          hooks: [
            { id: "block-rm-rf", event: "beforeTool", matcher: "bash", command: "/bin/guard" },
            { id: "rulesync-project-sessionStart-001", event: "sessionStart", command: "old" },
          ],
        }),
      );

      const parsed = await generate({
        testDir,
        config: { hooks: { sessionStart: [{ command: "echo new" }] } },
      });

      expect(parsed.enabled).toBe(false);
      expect(parsed.hooks).toEqual([
        { id: "block-rm-rf", event: "beforeTool", matcher: "bash", command: "/bin/guard" },
        expect.objectContaining({
          id: "rulesync-project-sessionStart-001",
          args: ["-c", "echo new"],
        }),
      ]);
    });

    it("should refuse to rewrite an unparseable hooks.json", async () => {
      await writeFileContent(join(testDir, ".zero", "hooks.json"), "{ broken");
      await expect(
        generate({ testDir, config: { hooks: { sessionStart: [{ command: "x" }] } } }),
      ).rejects.toThrow(/Failed to parse Zero hooks file/);
    });

    it("should apply the zero.hooks override block", async () => {
      const parsed = await generate({
        testDir,
        config: {
          hooks: { sessionStart: [{ command: "shared" }] },
          zero: { hooks: { sessionStart: [{ command: "zero only", enabled: false }] } },
        },
      });
      expect(parsed.hooks).toEqual([
        expect.objectContaining({ args: ["-c", "zero only"], enabled: false }),
      ]);
    });
  });

  describe("toRulesyncHooks", () => {
    it("should import entries and fold the per-tool split back into one matcher", async () => {
      await writeFileContent(
        join(testDir, ".zero", "hooks.json"),
        JSON.stringify({
          enabled: true,
          hooks: [
            {
              id: "a",
              event: "beforeTool",
              matcher: "write_file",
              command: "sh",
              args: ["-c", "g"],
            },
            {
              id: "b",
              event: "beforeTool",
              matcher: "edit_file",
              command: "sh",
              args: ["-c", "g"],
            },
            {
              id: "c",
              event: "beforeTool",
              matcher: "apply_patch",
              command: "sh",
              args: ["-c", "g"],
            },
            { id: "d", event: "sessionStart", command: "/bin/log", args: ["a b"] },
            { id: "e", event: "specialistStart", matcher: "*", command: "x", enabled: false },
          ],
        }),
      );

      const hooks = await ZeroHooks.fromFile({ outputRoot: testDir });
      const imported = JSON.parse(hooks.toRulesyncHooks().getFileContent());

      expect(imported.hooks).toEqual({
        preToolUse: [{ type: "command", command: "g", matcher: "Write|Edit" }],
        sessionStart: [{ type: "command", command: "/bin/log 'a b'" }],
        subagentStart: [{ type: "command", command: "x", matcher: ".*", enabled: false }],
      });
    });
  });

  it("should never be deletable", () => {
    const hooks = ZeroHooks.forDeletion({
      outputRoot: testDir,
      relativeDirPath: ".zero",
      relativeFilePath: "hooks.json",
    });
    expect(hooks.isDeletable()).toBe(false);
  });
});

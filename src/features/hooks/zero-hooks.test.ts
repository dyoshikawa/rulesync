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
}): Promise<{ enabled?: boolean; hooks: Array<Record<string, unknown>> }> {
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

      // No top-level `enabled` is added: stating it would override the user layer.
      expect(parsed).toEqual({
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

    it("should attach a Bash guard to every Zero shell tool", async () => {
      const parsed = await generate({
        testDir,
        config: { hooks: { preToolUse: [{ command: "guard.sh", matcher: "Bash" }] } },
      });
      expect(parsed.hooks.map((hook) => [hook.event, hook.matcher])).toEqual([
        ["beforeTool", "bash"],
        ["beforeTool", "exec_command"],
        ["beforeTool", "write_stdin"],
        ["beforeTool", "terminal_session"],
      ]);
    });

    it("should map Agent to Zero's Task tool", async () => {
      const parsed = await generate({
        testDir,
        config: { hooks: { preToolUse: [{ command: "guard.sh", matcher: "Agent" }] } },
      });
      expect(parsed.hooks.map((hook) => hook.matcher)).toEqual(["Task"]);
    });

    it("should warn that a native bash guard leaves the other shell tools uncovered", async () => {
      const logger = createMockLogger();
      const parsed = await generate({
        testDir,
        config: { hooks: { preToolUse: [{ command: "guard.sh", matcher: "bash" }] } },
        logger,
      });
      expect(parsed.hooks.map((hook) => hook.matcher)).toEqual(["bash"]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"terminal_session"'));
    });

    it("should keep a lowercase glob beside its canonical expansion", async () => {
      const parsed = await generate({
        testDir,
        config: { hooks: { postToolUse: [{ command: "log.sh", matcher: "web_.*" }] } },
      });
      expect(parsed.hooks.map((hook) => hook.matcher)).toEqual(["web_*"]);
    });

    it("should expand a glob over the canonical names", async () => {
      const parsed = await generate({
        testDir,
        config: { hooks: { preToolUse: [{ command: "guard.sh", matcher: "Bash.*|Writ.*" }] } },
      });
      expect(parsed.hooks.map((hook) => hook.matcher)).toEqual([
        "bash",
        "exec_command",
        "write_stdin",
        "terminal_session",
        "write_file",
      ]);
    });

    it("should run a guard whose glob matches no Zero tool on every tool, with a warning", async () => {
      const logger = createMockLogger();
      const parsed = await generate({
        testDir,
        config: { hooks: { preToolUse: [{ command: "guard.sh", matcher: "Notebook.*" }] } },
        logger,
      });
      expect(parsed.hooks).toHaveLength(1);
      expect(parsed.hooks[0]).not.toHaveProperty("matcher");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("matches no Zero tool"));
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

    it("should fail closed for a guard whose matcher Zero cannot express", async () => {
      const logger = createMockLogger();
      const parsed = await generate({
        testDir,
        config: { hooks: { preToolUse: [{ command: "guard.sh", matcher: "Bash(git .*)" }] } },
        logger,
      });
      expect(parsed.hooks).toHaveLength(1);
      expect(parsed.hooks[0]).not.toHaveProperty("matcher");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("runs before every Zero tool call"),
      );
    });

    it("should skip a non-guard hook whose matcher Zero cannot express, with a warning", async () => {
      const logger = createMockLogger();
      const parsed = await generate({
        testDir,
        config: { hooks: { postToolUse: [{ command: "log.sh", matcher: "Bash(git .*)" }] } },
        logger,
      });
      expect(parsed.hooks).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("hook was skipped"));
    });

    it("should not generate an entry identical to a kept hand-written one", async () => {
      await writeFileContent(
        join(testDir, ".zero", "hooks.json"),
        JSON.stringify({
          hooks: [{ id: "my-guard", event: "beforeTool", matcher: "bash", command: "/bin/guard" }],
        }),
      );

      const hooks = await ZeroHooks.fromFile({ outputRoot: testDir });
      const imported = hooks.toRulesyncHooks().getJson();
      const parsed = await generate({
        testDir,
        config: imported,
      });

      expect(imported.hooks.preToolUse).toEqual([
        { type: "command", command: "/bin/guard", matcher: "Bash" },
      ]);
      // The `bash` entry is the kept hand-written one; only the other shell
      // tools the canonical `Bash` covers are added.
      expect(parsed.hooks.map((hook) => [hook.id, hook.matcher])).toEqual([
        ["my-guard", "bash"],
        ["rulesync-project-beforeTool-002", "exec_command"],
        ["rulesync-project-beforeTool-003", "write_stdin"],
        ["rulesync-project-beforeTool-004", "terminal_session"],
      ]);
    });

    it("should fail closed for a guard naming no Zero tool", async () => {
      const logger = createMockLogger();
      const parsed = await generate({
        testDir,
        config: { hooks: { preToolUse: [{ command: "guard.sh", matcher: "NotebookEdit" }] } },
        logger,
      });
      expect(parsed.hooks).toHaveLength(1);
      expect(parsed.hooks[0]).not.toHaveProperty("matcher");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("matches no Zero tool"));
    });

    it("should write an unknown name on a non-guard event as-is, with a warning", async () => {
      const logger = createMockLogger();
      const parsed = await generate({
        testDir,
        config: { hooks: { postToolUse: [{ command: "log.sh", matcher: "NotebookEdit" }] } },
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

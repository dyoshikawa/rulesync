import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncHooks } from "./rulesync-hooks.js";
import { TraeHooks } from "./trae-hooks.js";

const buildRulesyncHooks = (testDir: string, config: Record<string, unknown>): RulesyncHooks =>
  new RulesyncHooks({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
    validate: false,
  });

const generate = async (testDir: string, config: Record<string, unknown>, global = false) => {
  const logger = createMockLogger();
  const warnSpy = vi.spyOn(logger, "warn");
  const hooks = await TraeHooks.fromRulesyncHooks({
    outputRoot: testDir,
    rulesyncHooks: buildRulesyncHooks(testDir, config),
    validate: false,
    global,
    logger,
  });
  return { hooks, parsed: JSON.parse(hooks.getFileContent()), warnSpy };
};

describe("TraeHooks", () => {
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

  it("should use .trae/hooks.json in both scopes", () => {
    const expected = { relativeDirPath: ".trae", relativeFilePath: "hooks.json" };
    expect(TraeHooks.getSettablePaths({ global: false })).toEqual(expected);
    expect(TraeHooks.getSettablePaths({ global: true })).toEqual(expected);
  });

  it("should emit the six supported events in PascalCase and drop the rest", async () => {
    const { parsed } = await generate(testDir, {
      version: 1,
      hooks: {
        sessionStart: [{ command: "start.sh" }],
        beforeSubmitPrompt: [{ command: "prompt.sh" }],
        preToolUse: [{ command: "pre.sh", matcher: "Edit|Write" }],
        postToolUse: [{ command: "post.sh" }],
        stop: [{ command: "stop.sh", timeout: 60 }],
        notification: [{ command: "notify.sh", matcher: "idle_prompt" }],
        sessionEnd: [{ command: "end.sh" }],
      },
    });

    expect(Object.keys(parsed.hooks).toSorted()).toEqual([
      "Notification",
      "PostToolUse",
      "PreToolUse",
      "SessionStart",
      "Stop",
      "UserPromptSubmit",
    ]);
    expect(parsed.hooks.PreToolUse[0].matcher).toBe("Edit|Write");
    expect(parsed.hooks.Notification[0].matcher).toBe("idle_prompt");
    expect(parsed.hooks.Stop[0].hooks[0]).toEqual({
      type: "command",
      command: "stop.sh",
      timeout: 60,
    });
  });

  it("should translate Bash to RunCommand in matchers", async () => {
    const { parsed } = await generate(testDir, {
      version: 1,
      hooks: { preToolUse: [{ command: "guard.sh", matcher: "Bash|mcp__srv__Bash" }] },
    });

    expect(parsed.hooks.PreToolUse[0].matcher).toBe("RunCommand|mcp__srv__Bash");
  });

  // The processor warns about the skipped types (see HooksProcessor).
  it("should drop non-command hooks", async () => {
    const { parsed } = await generate(testDir, {
      version: 1,
      hooks: {
        preToolUse: [
          { type: "command", command: "pre.sh" },
          { type: "prompt", prompt: "Safe?" },
        ],
      },
    });

    expect(parsed.hooks.PreToolUse.flatMap((g: { hooks: unknown[] }) => g.hooks)).toEqual([
      { type: "command", command: "pre.sh" },
    ]);
  });

  it("should drop matchers on events that take none", async () => {
    const { parsed, warnSpy } = await generate(testDir, {
      version: 1,
      hooks: {
        sessionStart: [{ command: "start.sh", matcher: "startup" }],
        stop: [{ command: "stop.sh", matcher: "x" }],
      },
    });

    expect(parsed.hooks.SessionStart[0].matcher).toBeUndefined();
    expect(parsed.hooks.Stop[0].matcher).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('matcher "startup" on "sessionStart" hook will be ignored'),
    );
  });

  it("should anchor dot-relative commands to $TRAE_PROJECT_DIR", async () => {
    const { parsed } = await generate(testDir, {
      version: 1,
      hooks: { stop: [{ command: "./scripts/check.sh" }] },
    });

    expect(parsed.hooks.Stop[0].hooks[0].command).toBe('"$TRAE_PROJECT_DIR"/scripts/check.sh');
  });

  it("should keep version and other top-level keys of an existing file", async () => {
    await ensureDir(join(testDir, ".trae"));
    await writeFileContent(
      join(testDir, ".trae", "hooks.json"),
      JSON.stringify({ version: 1, hooks: { Stop: [{ hooks: [{ command: "stale.sh" }] }] } }),
    );

    const { hooks, parsed } = await generate(
      testDir,
      { version: 1, hooks: { sessionStart: [{ command: "start.sh" }] } },
      true,
    );

    expect(hooks.getRelativeDirPath()).toBe(".trae");
    expect(parsed.version).toBe(1);
    expect(parsed.hooks.SessionStart).toHaveLength(1);
    expect(parsed.hooks.Stop).toBeUndefined();
  });

  it("should import TRAE hooks, mapping RunCommand back to Bash", () => {
    const hooks = new TraeHooks({
      outputRoot: testDir,
      relativeDirPath: ".trae",
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        version: 1,
        hooks: {
          PreToolUse: [
            {
              matcher: "RunCommand|Edit",
              hooks: [{ type: "command", command: "$TRAE_PROJECT_DIR/guard.sh", timeout: 10 }],
            },
          ],
          UserPromptSubmit: [{ hooks: [{ type: "command", command: "prompt.sh" }] }],
        },
      }),
      validate: false,
    });

    const json = hooks.toRulesyncHooks().getJson();
    expect(json.hooks.preToolUse?.[0]).toMatchObject({
      command: "./guard.sh",
      matcher: "Bash|Edit",
      timeout: 10,
    });
    expect(json.hooks.beforeSubmitPrompt?.[0]).toMatchObject({ command: "prompt.sh" });
  });

  it("should round-trip through generate and import", async () => {
    const { hooks } = await generate(testDir, {
      version: 1,
      hooks: {
        preToolUse: [{ command: "pre.sh", matcher: "Bash", timeout: 5 }],
        stop: [{ command: "stop.sh" }],
      },
    });

    const json = hooks.toRulesyncHooks().getJson();
    expect(json.hooks.preToolUse?.[0]).toMatchObject({
      command: "pre.sh",
      matcher: "Bash",
      timeout: 5,
    });
    expect(json.hooks.stop?.[0]).toMatchObject({ command: "stop.sh" });
  });
});

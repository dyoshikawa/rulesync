import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { GrokcliHooks } from "./grokcli-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("GrokcliHooks", () => {
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

  const makeRulesyncHooks = (config: unknown): RulesyncHooks =>
    new RulesyncHooks({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify(config),
      validate: false,
    });

  describe("getSettablePaths", () => {
    it("should return .grok/hooks and rulesync.json for project mode", () => {
      const paths = GrokcliHooks.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: join(".grok", "hooks"),
        relativeFilePath: "rulesync.json",
      });
    });

    it("should use the same relative layout for global mode", () => {
      const paths = GrokcliHooks.getSettablePaths({ global: true });
      expect(paths).toEqual({
        relativeDirPath: join(".grok", "hooks"),
        relativeFilePath: "rulesync.json",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should emit a Claude-compatible nested map under the top-level hooks key", async () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ matcher: "exec", command: "./scripts/check.sh", timeout: 10 }],
          postToolUse: [{ command: "./scripts/after.sh" }],
          beforeSubmitPrompt: [{ command: "./scripts/prompt.sh" }],
          stop: [{ command: "./scripts/stop.sh" }],
          sessionStart: [{ command: "./scripts/start.sh" }],
        },
      };
      const rulesyncHooks = makeRulesyncHooks(config);

      const grokHooks = await GrokcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(grokHooks.getFileContent());
      // Everything nests under the top-level `hooks` key.
      expect(parsed.hooks).toBeDefined();
      // PreToolUse keeps its matcher, tested against the tool name.
      expect(parsed.hooks.PreToolUse).toEqual([
        {
          matcher: "exec",
          hooks: [{ type: "command", command: "./scripts/check.sh", timeout: 10 }],
        },
      ]);
      // A hook authored without a matcher carries no matcher key.
      expect(parsed.hooks.PostToolUse).toEqual([
        { hooks: [{ type: "command", command: "./scripts/after.sh" }] },
      ]);
      expect(parsed.hooks.UserPromptSubmit).toEqual([
        { hooks: [{ type: "command", command: "./scripts/prompt.sh" }] },
      ]);
      expect(parsed.hooks.Stop).toEqual([
        { hooks: [{ type: "command", command: "./scripts/stop.sh" }] },
      ]);
      expect(parsed.hooks.SessionStart).toEqual([
        { hooks: [{ type: "command", command: "./scripts/start.sh" }] },
      ]);
    });

    it("should drop a matcher on a matcher-less event", async () => {
      const config = {
        version: 1,
        hooks: {
          // `stop` is matcher-less; the matcher must be dropped from the output.
          stop: [{ matcher: "exec", command: "./scripts/stop.sh" }],
        },
      };
      const rulesyncHooks = makeRulesyncHooks(config);

      const grokHooks = await GrokcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(grokHooks.getFileContent());
      expect(parsed.hooks.Stop).toEqual([
        { hooks: [{ type: "command", command: "./scripts/stop.sh" }] },
      ]);
    });

    it("should keep matchers on the non-tool events Grok documents them for", async () => {
      // Grok's per-event matcher table: the notification type on Notification,
      // the subagent type on SubagentStart/SubagentStop, the start source on
      // SessionStart, the end reason on SessionEnd, the compaction trigger on
      // PreCompact/PostCompact, and the error type on StopFailure. Only Stop and
      // UserPromptSubmit ignore one.
      const logger = createMockLogger();
      const config = {
        version: 1,
        hooks: {
          notification: [{ matcher: "idle_prompt", command: "./scripts/chime.sh" }],
          subagentStart: [{ matcher: "explore", command: "./scripts/sub.sh" }],
          stopFailure: [{ matcher: "rate_limit", command: "./scripts/backoff.sh" }],
          preCompact: [{ matcher: "auto", command: "./scripts/compact.sh" }],
          sessionStart: [{ matcher: "resume", command: "./scripts/resume.sh" }],
        },
      };

      const grokHooks = await GrokcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: makeRulesyncHooks(config),
        validate: false,
        logger,
      });

      const parsed = JSON.parse(grokHooks.getFileContent());
      expect(parsed.hooks.Notification[0].matcher).toBe("idle_prompt");
      expect(parsed.hooks.SubagentStart[0].matcher).toBe("explore");
      expect(parsed.hooks.StopFailure[0].matcher).toBe("rate_limit");
      expect(parsed.hooks.PreCompact[0].matcher).toBe("auto");
      expect(parsed.hooks.SessionStart[0].matcher).toBe("resume");
      expect(logger.warn).not.toHaveBeenCalled();

      // And they survive the trip back into canonical hooks.
      const json = grokHooks.toRulesyncHooks().getJson();
      expect(json.hooks.notification?.[0]?.matcher).toBe("idle_prompt");
      expect(json.hooks.stopFailure?.[0]?.matcher).toBe("rate_limit");
    });

    it("should map stopCancelled onto StopCancelled and keep its reason matcher (issue #2498)", async () => {
      const logger = createMockLogger();
      const config = {
        version: 1,
        hooks: {
          stopCancelled: [{ matcher: "user_interrupt", command: "./scripts/cancelled.sh" }],
        },
      };

      const grokHooks = await GrokcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: makeRulesyncHooks(config),
        validate: false,
        logger,
      });

      const parsed = JSON.parse(grokHooks.getFileContent());
      expect(parsed.hooks.StopCancelled[0].command).toBeUndefined();
      expect(parsed.hooks.StopCancelled[0].hooks[0].command).toBe("./scripts/cancelled.sh");
      // Upstream tests the cancellation reason on this event, so unlike `Stop`
      // the matcher must survive rather than be dropped with a warning.
      expect(parsed.hooks.StopCancelled[0].matcher).toBe("user_interrupt");
      expect(logger.warn).not.toHaveBeenCalled();

      const json = grokHooks.toRulesyncHooks().getJson();
      expect(json.hooks.stopCancelled?.[0]?.matcher).toBe("user_interrupt");
      expect(json.hooks.stopCancelled?.[0]?.command).toBe("./scripts/cancelled.sh");
    });

    it("should drop canonical events without a Grok equivalent", async () => {
      const config = {
        version: 1,
        hooks: {
          // Not in the Grok native event set.
          beforeReadFile: [{ command: "read.sh" }],
          afterFileEdit: [{ command: "edit.sh" }],
          preToolUse: [{ command: "tool.sh" }],
        },
      };
      const rulesyncHooks = makeRulesyncHooks(config);

      const grokHooks = await GrokcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(grokHooks.getFileContent());
      expect(Object.keys(parsed.hooks)).toEqual(["PreToolUse"]);
    });

    it("should merge config.grokcli.hooks on top of shared hooks", async () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ command: "shared.sh" }],
        },
        grokcli: {
          hooks: {
            preToolUse: [{ command: "override.sh" }],
            stop: [{ command: "override-stop.sh" }],
          },
        },
      };
      const rulesyncHooks = makeRulesyncHooks(config);

      const grokHooks = await GrokcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(grokHooks.getFileContent());
      expect(parsed.hooks.PreToolUse).toEqual([
        { hooks: [{ type: "command", command: "override.sh" }] },
      ]);
      expect(parsed.hooks.Stop).toEqual([
        { hooks: [{ type: "command", command: "override-stop.sh" }] },
      ]);
    });
  });

  describe("fromFile", () => {
    it("should parse an existing project rulesync.json", async () => {
      const dir = join(testDir, ".grok", "hooks");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "rulesync.json"),
        JSON.stringify({
          hooks: {
            PreToolUse: [{ matcher: "exec", hooks: [{ type: "command", command: "s.sh" }] }],
          },
        }),
      );

      const grokHooks = await GrokcliHooks.fromFile({ outputRoot: testDir });
      const parsed = JSON.parse(grokHooks.getFileContent());
      expect(parsed.hooks.PreToolUse).toBeDefined();
    });

    it("should fall back to an empty hooks object when the file is missing", async () => {
      const grokHooks = await GrokcliHooks.fromFile({ outputRoot: testDir });
      expect(JSON.parse(grokHooks.getFileContent())).toEqual({ hooks: {} });
    });
  });

  describe("toRulesyncHooks", () => {
    it("should map Grok events back to canonical names", () => {
      const fileContent = JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "exec", hooks: [{ type: "command", command: "tool.sh" }] }],
          Stop: [{ hooks: [{ type: "command", command: "stop.sh" }] }],
        },
      });
      const grokHooks = new GrokcliHooks({
        outputRoot: testDir,
        relativeDirPath: join(".grok", "hooks"),
        relativeFilePath: "rulesync.json",
        fileContent,
        validate: false,
      });

      const parsed = JSON.parse(grokHooks.toRulesyncHooks().getFileContent());
      expect(parsed.version).toBe(1);
      expect(parsed.hooks.preToolUse).toEqual([
        { type: "command", command: "tool.sh", matcher: "exec" },
      ]);
      expect(parsed.hooks.stop).toEqual([{ type: "command", command: "stop.sh" }]);
    });

    it("should round-trip every mappable event through fromRulesyncHooks and back", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "start.sh" }],
          sessionEnd: [{ type: "command", command: "end.sh" }],
          beforeSubmitPrompt: [{ type: "command", command: "prompt.sh" }],
          preToolUse: [{ type: "command", command: "tool.sh", matcher: "exec" }],
          // matcher must survive the round-trip on the tool-name events too.
          postToolUse: [{ type: "command", command: "after.sh", matcher: "Write" }],
          postToolUseFailure: [{ type: "command", command: "fail.sh", matcher: "Bash" }],
          permissionDenied: [{ type: "command", command: "denied.sh", matcher: "Edit" }],
          stop: [{ type: "command", command: "stop.sh" }],
          stopFailure: [{ type: "command", command: "stop-failure.sh" }],
          notification: [{ type: "command", command: "notify.sh" }],
          subagentStart: [{ type: "command", command: "sub-start.sh" }],
          subagentStop: [{ type: "command", command: "sub-stop.sh" }],
          preCompact: [{ type: "command", command: "pre-compact.sh" }],
          postCompact: [{ type: "command", command: "post-compact.sh" }],
        },
      };
      const rulesyncHooks = makeRulesyncHooks(config);

      const grokHooks = await GrokcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(grokHooks.toRulesyncHooks().getFileContent());
      expect(parsed.hooks).toEqual(config.hooks);
    });

    it("should throw on invalid JSON content", () => {
      const grokHooks = new GrokcliHooks({
        outputRoot: testDir,
        relativeDirPath: join(".grok", "hooks"),
        relativeFilePath: "rulesync.json",
        fileContent: "{ not json",
        validate: false,
      });

      expect(() => grokHooks.toRulesyncHooks()).toThrow(/Failed to parse Grok hooks/);
    });
  });

  describe("forDeletion", () => {
    it("should produce an empty hooks object", () => {
      const grokHooks = GrokcliHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".grok", "hooks"),
        relativeFilePath: "rulesync.json",
      });
      expect(JSON.parse(grokHooks.getFileContent())).toEqual({ hooks: {} });
    });
  });
});

describe("GrokcliHooks handler types", () => {
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

  it("writes an http hook alongside a command one, and drops a type Grok has no handler for", async () => {
    // Grok's HookHandlerType is `command | http`; the adapter used to declare
    // only `command` on the stale premise that the converter could not do more.
    const hooks = await GrokcliHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks: new RulesyncHooks({
        relativeDirPath: ".rulesync",
        relativeFilePath: "hooks.jsonc",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            stop: [
              { type: "command", command: "./notify.sh" },
              { type: "http", url: "https://example.com/hook", timeout: 5 },
              { type: "prompt", prompt: "Summarize" },
            ],
          },
        }),
      }),
    });

    const written = JSON.parse(hooks.getFileContent()).hooks.Stop[0].hooks;
    expect(written).toEqual([
      { type: "command", command: "./notify.sh" },
      { type: "http", url: "https://example.com/hook", timeout: 5 },
    ]);
  });
});

describe("GrokcliHooks per-handler env", () => {
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

  const fromCanonical = (config: unknown) =>
    GrokcliHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks: new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      }),
    });

  const fromToolFile = (config: unknown) =>
    new GrokcliHooks({
      outputRoot: testDir,
      relativeDirPath: join(".grok", "hooks"),
      relativeFilePath: "rulesync.json",
      fileContent: JSON.stringify(config),
    });

  it("emits env on a command hook only", async () => {
    // Upstream `HookConfig.env: HashMap<String, String>` is merged into
    // `HookSpec::extra_env` for the spawned command, so an http handler has no
    // process to merge it into.
    const hooks = await fromCanonical({
      version: 1,
      hooks: {
        stop: [
          { type: "command", command: "./notify.sh", env: { CI: "1", LEVEL: "debug" } },
          { type: "http", url: "https://example.com/hook", env: { CI: "1" } },
        ],
      },
    });

    const written = JSON.parse(hooks.getFileContent()).hooks.Stop[0].hooks;
    expect(written[0]).toEqual({
      type: "command",
      command: "./notify.sh",
      env: { CI: "1", LEVEL: "debug" },
    });
    expect(written[1]).not.toHaveProperty("env");
  });

  // The canonical schema already rejects most of these, so this guard is what
  // protects the looser paths into a definition: the `grokcli.hooks` override
  // block and a hook read out of an existing tool file.
  it("refuses an env entry that is not a clean string pair", async () => {
    const hooks = await fromCanonical({
      version: 1,
      hooks: {
        stop: [
          { type: "command", command: "./a.sh", env: { PORT: 8080 } },
          { type: "command", command: "./b.sh", env: { INJECTED: "a\nb" } },
          { type: "command", command: "./c.sh", env: ["CI=1"] },
          // A key rebuilt into `KEY=VALUE` would name `PATH`, not this key.
          { type: "command", command: "./d.sh", env: { "PATH=/tmp/evil": "1" } },
          { type: "command", command: "./e.sh", env: { "BAD\nKEY": "1" } },
          { type: "command", command: "./f.sh", env: { "": "1" } },
        ],
      },
    });

    for (const hook of JSON.parse(hooks.getFileContent()).hooks.Stop[0].hooks) {
      expect(hook).not.toHaveProperty("env");
    }
  });

  it("refuses an unusable env while importing", () => {
    const imported = fromToolFile({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "./a.sh", env: { PORT: 8080 } },
              { type: "command", command: "./b.sh", env: "CI=1" },
              { type: "command", command: "./c.sh", env: { "PATH=/tmp/evil": "1" } },
              { type: "command", command: "./d.sh", env: {} },
            ],
          },
        ],
      },
    })
      .toRulesyncHooks()
      .getJson().hooks.stop;

    expect(imported?.[0]).not.toHaveProperty("env");
    expect(imported?.[1]).not.toHaveProperty("env");
    expect(imported?.[2]).not.toHaveProperty("env");
    // An empty map is a legitimate value and survives.
    expect(imported?.[3]).toEqual({ type: "command", command: "./d.sh", env: {} });
  });

  it("drops a __proto__ key before the generated file", async () => {
    // The stripping is the JSONC parser rebuilding the object, not the env
    // guard — a `__proto__` own key is non-empty, has no "=" and no control
    // characters, so the guard accepts it. Asserted here so a future parser
    // change does not put it back silently.
    const hooks = await fromCanonical({
      version: 1,
      hooks: {
        stop: [
          {
            type: "command",
            command: "./notify.sh",
            env: JSON.parse('{"__proto__":"polluted","CI":"1"}'),
          },
        ],
      },
    });

    const written = JSON.parse(hooks.getFileContent()).hooks.Stop[0].hooks[0];
    expect(written.env).toEqual({ CI: "1" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("imports env from a command hook and ignores it on an http hook", () => {
    const imported = fromToolFile({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "./notify.sh", env: { CI: "1" } },
              { type: "http", url: "https://example.com/hook", env: { CI: "1" } },
            ],
          },
        ],
      },
    })
      .toRulesyncHooks()
      .getJson().hooks.stop;

    expect(imported?.[0]).toEqual({ type: "command", command: "./notify.sh", env: { CI: "1" } });
    expect(imported?.[1]).toEqual({ type: "http", url: "https://example.com/hook" });
  });

  it("round-trips env through generate and import", async () => {
    const hooks = await fromCanonical({
      version: 1,
      hooks: { stop: [{ type: "command", command: "./notify.sh", env: { CI: "1" } }] },
    });

    expect(
      fromToolFile(JSON.parse(hooks.getFileContent())).toRulesyncHooks().getJson().hooks.stop,
    ).toEqual([{ type: "command", command: "./notify.sh", env: { CI: "1" } }]);
  });
});

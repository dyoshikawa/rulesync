import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { QODER_HOOK_EVENTS } from "../../types/hooks.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { QoderHooks } from "./qoder-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

const buildRulesyncHooks = (testDir: string, config: Record<string, unknown>): RulesyncHooks =>
  new RulesyncHooks({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
    validate: false,
  });

describe("QoderHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return .qoder/settings.json for both scopes", () => {
      const expected = { relativeDirPath: ".qoder", relativeFilePath: "settings.json" };
      expect(QoderHooks.getSettablePaths({ global: false })).toEqual(expected);
      expect(QoderHooks.getSettablePaths({ global: true })).toEqual(expected);
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should emit every documented Qoder event in PascalCase", async () => {
      const hooks = Object.fromEntries(
        QODER_HOOK_EVENTS.map((event) => [event, [{ type: "command", command: `${event}.sh` }]]),
      );
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          ...hooks,
          // Not a Qoder event.
          preModelInvocation: [{ type: "command", command: "model.sh" }],
        },
      });

      const qoderHooks = await QoderHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      expect(qoderHooks.getRelativeDirPath()).toBe(".qoder");
      expect(qoderHooks.getRelativeFilePath()).toBe("settings.json");
      const parsed = JSON.parse(qoderHooks.getFileContent());
      expect(Object.keys(parsed.hooks)).toHaveLength(27);
      expect(parsed.hooks.UserPromptSubmit[0].hooks[0].command).toBe("beforeSubmitPrompt.sh");
      expect(parsed.hooks.PostToolUseFailure[0].hooks[0].command).toBe("postToolUseFailure.sh");
      expect(parsed.hooks.TeammateIdle[0].hooks[0].command).toBe("teammateIdle.sh");
      expect(parsed.hooks.Setup[0].hooks[0].command).toBe("setup.sh");
      expect(JSON.stringify(parsed.hooks)).not.toContain("model.sh");
    });

    it("should emit the four documented handler types and skip mcp_tool", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          preToolUse: [
            { type: "command", command: "check.sh", matcher: "Bash", timeout: 30 },
            { type: "http", url: "https://example.com/hook", headers: { "X-Key": "v" } },
            { type: "prompt", prompt: "Is this safe?", model: "fast" },
            { type: "agent", prompt: "Review the change", model: "smart" },
            { type: "mcp_tool", server: "s", tool: "t" },
          ],
        },
      });

      const qoderHooks = await QoderHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(qoderHooks.getFileContent());
      const entries = parsed.hooks.PreToolUse.flatMap(
        (g: { hooks: Array<{ type: string }> }) => g.hooks,
      );
      expect(entries.map((e: { type: string }) => e.type)).toEqual([
        "command",
        "http",
        "prompt",
        "agent",
      ]);
      expect(entries[0]).toMatchObject({ command: "check.sh", timeout: 30 });
      expect(entries[1]).toMatchObject({
        url: "https://example.com/hook",
        headers: { "X-Key": "v" },
      });
      expect(entries[2]).toMatchObject({ prompt: "Is this safe?", model: "fast" });
      expect(entries[3]).toMatchObject({ prompt: "Review the change", model: "smart" });
      expect(parsed.hooks.PreToolUse[0].matcher).toBe("Bash");
    });

    it("should carry the documented command-hook fields", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          postToolUse: [
            {
              type: "command",
              command: "lint.sh",
              if: "Edit(*.ts)",
              statusMessage: "Linting",
              shell: "bash",
              once: true,
              async: true,
              asyncRewake: true,
              rewakeMessage: "Lint failed:",
              rewakeSummary: "Lint errors found",
              args: ["--fix"],
              env: { FOO: "bar" },
            },
          ],
        },
      });

      const qoderHooks = await QoderHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(qoderHooks.getFileContent());
      expect(parsed.hooks.PostToolUse[0].hooks[0]).toEqual({
        type: "command",
        command: "lint.sh",
        if: "Edit(*.ts)",
        statusMessage: "Linting",
        shell: "bash",
        once: true,
        async: true,
        asyncRewake: true,
        rewakeMessage: "Lint failed:",
        rewakeSummary: "Lint errors found",
        args: ["--fix"],
        env: { FOO: "bar" },
      });
    });

    it("should warn when rewakeSummary exceeds Qoder's 300-character cap but still emit it", async () => {
      const summary = "x".repeat(301);
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          stop: [
            { type: "command", command: "check.sh", asyncRewake: true, rewakeSummary: summary },
          ],
        },
      });

      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, "warn");
      const qoderHooks = await QoderHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        logger,
      });

      const parsed = JSON.parse(qoderHooks.getFileContent());
      expect(parsed.hooks.Stop[0].hooks[0].rewakeSummary).toBe(summary);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('caps "rewakeSummary" at 300 characters'),
      );
    });

    it("should not warn when rewakeSummary is exactly 300 characters", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          stop: [
            {
              type: "command",
              command: "check.sh",
              asyncRewake: true,
              rewakeSummary: "x".repeat(300),
            },
          ],
        },
      });

      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, "warn");
      await QoderHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        logger,
      });

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it.each([299, 300, 301])(
      "should measure rewakeSummary after collapsing whitespace (%i characters)",
      async (length) => {
        const summary = `  ${"x".repeat(length - 2)}${" \t".repeat(200)}y   `;
        const rulesyncHooks = buildRulesyncHooks(testDir, {
          version: 1,
          hooks: {
            stop: [
              { type: "command", command: "check.sh", asyncRewake: true, rewakeSummary: summary },
            ],
          },
        });
        const logger = createMockLogger();
        const qoderHooks = await QoderHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks,
          validate: false,
          logger,
        });

        expect(JSON.parse(qoderHooks.getFileContent()).hooks.Stop[0].hooks[0].rewakeSummary).toBe(
          summary,
        );
        if (length > 300) {
          expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
            expect.stringContaining(
              `is ${length} characters long after collapsing whitespace; ` +
                'this tool caps "rewakeSummary" at 300 characters',
            ),
          );
        } else {
          expect(logger.warn).not.toHaveBeenCalled();
        }
      },
    );

    it.each([
      { asyncRewake: undefined, warns: true },
      { asyncRewake: false, warns: true },
      { asyncRewake: true, warns: false },
    ])(
      "should warn about rewakeMessage and rewakeSummary without asyncRewake but still emit them (asyncRewake: $asyncRewake)",
      async ({ asyncRewake, warns }) => {
        const rulesyncHooks = buildRulesyncHooks(testDir, {
          version: 1,
          hooks: {
            stop: [
              {
                type: "command",
                command: "check.sh",
                ...(asyncRewake === undefined ? {} : { asyncRewake }),
                rewakeMessage: "Check failed:",
                rewakeSummary: "Checks found issues",
              },
            ],
          },
        });
        const logger = createMockLogger();
        const qoderHooks = await QoderHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks,
          validate: false,
          logger,
        });

        const hook = JSON.parse(qoderHooks.getFileContent()).hooks.Stop[0].hooks[0];
        expect(hook.rewakeMessage).toBe("Check failed:");
        expect(hook.rewakeSummary).toBe("Checks found issues");
        if (warns) {
          expect(logger.warn).toHaveBeenCalledTimes(2);
          for (const field of ["rewakeMessage", "rewakeSummary"]) {
            expect(logger.warn).toHaveBeenCalledWith(
              expect.stringContaining(
                `"${field}" on a "command" hook on "stop" has no effect without "asyncRewake": true`,
              ),
            );
          }
        } else {
          expect(logger.warn).not.toHaveBeenCalled();
        }
      },
    );

    it("should drop rewakeMessage and rewakeSummary from non-command hooks", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          stop: [
            {
              type: "prompt",
              prompt: "Done?",
              rewakeMessage: "Prefix:",
              rewakeSummary: "Summary",
            },
          ],
        },
      });

      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, "warn");
      const qoderHooks = await QoderHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        logger,
      });

      const hook = JSON.parse(qoderHooks.getFileContent()).hooks.Stop[0].hooks[0];
      expect(hook).not.toHaveProperty("rewakeMessage");
      expect(hook).not.toHaveProperty("rewakeSummary");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Dropping "rewakeMessage"'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Dropping "rewakeSummary"'));
    });

    it("should anchor dot-relative commands to $QODER_PROJECT_DIR", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          sessionStart: [
            { command: ".rulesync/hooks/start.sh" },
            { command: "npx prettier --write ." },
          ],
        },
      });

      const qoderHooks = await QoderHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(qoderHooks.getFileContent());
      const commands = parsed.hooks.SessionStart.flatMap((g: { hooks: { command: string }[] }) =>
        g.hooks.map((h) => h.command),
      );
      expect(commands).toEqual([
        '"$QODER_PROJECT_DIR"/.rulesync/hooks/start.sh',
        "npx prettier --write .",
      ]);
    });

    it("should drop matchers on events Qoder documents without one", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ command: "prompt.sh", matcher: "*.js" }],
          cwdChanged: [{ command: "cwd.sh", matcher: "src" }],
          fileChanged: [{ command: "file.sh", matcher: ".env" }],
        },
      });

      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, "warn");
      const qoderHooks = await QoderHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        logger,
      });

      const parsed = JSON.parse(qoderHooks.getFileContent());
      expect(parsed.hooks.UserPromptSubmit[0].matcher).toBeUndefined();
      expect(parsed.hooks.CwdChanged[0].matcher).toBeUndefined();
      expect(parsed.hooks.FileChanged[0].matcher).toBe(".env");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('matcher "*.js" on "beforeSubmitPrompt" hook will be ignored'),
      );
    });

    it("should merge into an existing settings.json and keep unrelated keys", async () => {
      await ensureDir(join(testDir, ".qoder"));
      await writeFileContent(
        join(testDir, ".qoder", "settings.json"),
        JSON.stringify({
          model: "auto",
          permissions: { allow: ["Read"] },
          hooks: { Stop: [{ hooks: [{ type: "command", command: "stale.sh" }] }] },
        }),
      );
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { sessionStart: [{ command: "start.sh" }] },
      });

      const qoderHooks = await QoderHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(qoderHooks.getFileContent());
      expect(parsed.model).toBe("auto");
      expect(parsed.permissions).toEqual({ allow: ["Read"] });
      expect(parsed.hooks.SessionStart).toHaveLength(1);
      // The stale event is replaced because rulesync owns the whole `hooks` key.
      expect(parsed.hooks.Stop).toBeUndefined();
    });

    it("should emit events from the qoder override block", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {},
        qoder: {
          hooks: {
            sessionStart: [{ command: "qoder-only.sh" }],
          },
        },
      });

      const qoderHooks = await QoderHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(qoderHooks.getFileContent());
      expect(JSON.stringify(parsed.hooks.SessionStart)).toContain("qoder-only.sh");
    });

    it("should write to .qoder/settings.json in global mode", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { stop: [{ command: "stop.sh" }] },
      });

      const qoderHooks = await QoderHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        global: true,
      });

      expect(qoderHooks.getRelativeDirPath()).toBe(".qoder");
      expect(qoderHooks.getRelativeFilePath()).toBe("settings.json");
      expect(JSON.parse(qoderHooks.getFileContent())).toEqual({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "stop.sh" }] }] },
      });
    });

    it("should throw when the existing settings.json is not parseable", async () => {
      await ensureDir(join(testDir, ".qoder"));
      await writeFileContent(join(testDir, ".qoder", "settings.json"), "invalid json {");
      const rulesyncHooks = buildRulesyncHooks(testDir, { version: 1, hooks: {} });

      await expect(
        QoderHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks, validate: false }),
      ).rejects.toThrow(/Failed to parse shared config/);
    });
  });

  describe("fromFile", () => {
    it("should load .qoder/settings.json when it exists", async () => {
      await ensureDir(join(testDir, ".qoder"));
      const content = JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "stop.sh" }] }] },
      });
      await writeFileContent(join(testDir, ".qoder", "settings.json"), content);

      const qoderHooks = await QoderHooks.fromFile({ outputRoot: testDir, validate: false });

      expect(qoderHooks.getFileContent()).toBe(content);
    });

    it("should initialize an empty hooks block when the file does not exist", async () => {
      const qoderHooks = await QoderHooks.fromFile({ outputRoot: testDir, validate: false });

      expect(JSON.parse(qoderHooks.getFileContent())).toEqual({ hooks: {} });
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert PascalCase events and handler fields to the canonical model", () => {
      const qoderHooks = new QoderHooks({
        outputRoot: testDir,
        relativeDirPath: ".qoder",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          model: "auto",
          hooks: {
            UserPromptSubmit: [{ hooks: [{ type: "command", command: "prompt.sh" }] }],
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [
                  {
                    type: "command",
                    command: "pre.sh",
                    timeout: 10,
                    shell: "powershell",
                    env: { A: "1" },
                  },
                ],
              },
            ],
            PermissionRequest: [{ hooks: [{ type: "agent", prompt: "Allow?", model: "m" }] }],
          },
        }),
        validate: false,
      });

      const json = qoderHooks.toRulesyncHooks().getJson();

      expect(json.hooks.beforeSubmitPrompt?.[0]?.command).toBe("prompt.sh");
      expect(json.hooks.preToolUse?.[0]).toMatchObject({
        command: "pre.sh",
        matcher: "Bash",
        timeout: 10,
        shell: "powershell",
        env: { A: "1" },
      });
      expect(json.hooks.permissionRequest?.[0]).toMatchObject({
        type: "agent",
        prompt: "Allow?",
        model: "m",
      });
      // Sibling settings keys must not leak into the canonical model.
      expect((json as Record<string, unknown>).model).toBeUndefined();
    });

    it("should round-trip rewakeMessage and rewakeSummary on command hooks", () => {
      const qoderHooks = new QoderHooks({
        outputRoot: testDir,
        relativeDirPath: ".qoder",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            Stop: [
              {
                hooks: [
                  {
                    type: "command",
                    command: "check.sh",
                    asyncRewake: true,
                    rewakeMessage: "Check failed:",
                    rewakeSummary: "Checks found issues",
                  },
                ],
              },
            ],
          },
        }),
        validate: false,
      });

      const json = qoderHooks.toRulesyncHooks().getJson();

      expect(json.hooks.stop?.[0]).toMatchObject({
        command: "check.sh",
        asyncRewake: true,
        rewakeMessage: "Check failed:",
        rewakeSummary: "Checks found issues",
      });
    });
  });
});

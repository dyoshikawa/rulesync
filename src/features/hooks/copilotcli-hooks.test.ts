import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CopilotcliHooks } from "./copilotcli-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("CopilotcliHooks", () => {
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
    it("should return .github/hooks/copilotcli-hooks.json in project mode", () => {
      const paths = CopilotcliHooks.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilotcli-hooks.json",
      });
    });

    it("should return .copilot/hooks/copilot-hooks.json in global mode", () => {
      const paths = CopilotcliHooks.getSettablePaths({ global: true });
      expect(paths).toEqual({
        relativeDirPath: join(".copilot", "hooks"),
        relativeFilePath: "copilot-hooks.json",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should serialize supported events to copilotcli-hooks.json", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "echo session-start" }],
          beforeSubmitPrompt: [{ command: "echo prompt" }],
          // matchers are honored on preToolUse/postToolUse
          preToolUse: [{ matcher: "Edit|Write", command: "echo edit" }],
          // event not in the Copilot CLI surface — dropped
          worktreeCreate: [{ command: "echo skipped" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const hooks = await CopilotcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.version).toBe(1);
      expect(parsed.hooks.sessionStart).toBeDefined();
      expect(parsed.hooks.userPromptSubmitted).toBeDefined();
      // matcher entry is now honored on preToolUse and emits the matcher field
      expect(parsed.hooks.preToolUse).toBeDefined();
      expect(parsed.hooks.preToolUse[0]).toMatchObject({ matcher: "Edit|Write" });
      // event outside the Copilot CLI surface must not leak through
      expect(parsed.hooks.worktreeCreate).toBeUndefined();
    });

    it("emits matcher on preToolUse/postToolUse and drops it on other events", async () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ matcher: "Edit|Write", command: "echo pre" }],
          postToolUse: [{ matcher: "Bash", command: "echo post" }],
          // matcher on an unsupported event must be dropped, but the hook kept
          sessionStart: [{ matcher: "ignored", command: "echo start" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const hooks = await CopilotcliHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
      const parsed = JSON.parse(hooks.getFileContent());

      expect(parsed.hooks.preToolUse[0]).toMatchObject({ matcher: "Edit|Write" });
      expect(parsed.hooks.postToolUse[0]).toMatchObject({ matcher: "Bash" });
      // sessionStart hook is kept but its matcher is stripped
      expect(parsed.hooks.sessionStart).toBeDefined();
      expect(parsed.hooks.sessionStart[0].matcher).toBeUndefined();
    });

    it("emits matchers on the four other documented matcher-aware events", async () => {
      const config = {
        version: 1,
        hooks: {
          notification: [{ matcher: "permission", command: "echo n" }],
          permissionRequest: [{ matcher: "Bash", command: "echo p" }],
          preCompact: [{ matcher: "manual", command: "echo c" }],
          subagentStart: [{ matcher: "planner", command: "echo s" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const hooks = await CopilotcliHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
      const parsed = JSON.parse(hooks.getFileContent());

      expect(parsed.hooks.notification[0]).toMatchObject({ matcher: "permission" });
      expect(parsed.hooks.permissionRequest[0]).toMatchObject({ matcher: "Bash" });
      expect(parsed.hooks.preCompact[0]).toMatchObject({ matcher: "manual" });
      expect(parsed.hooks.subagentStart[0]).toMatchObject({ matcher: "planner" });
    });

    it("round-trips the userPromptTransformed event", async () => {
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: { userPromptExpansion: [{ command: "echo transformed" }] },
        }),
        validate: false,
      });

      const hooks = await CopilotcliHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks.userPromptTransformed).toBeDefined();

      const imported = new CopilotcliHooks({
        outputRoot: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilotcli-hooks.json",
        fileContent: hooks.getFileContent(),
        validate: false,
      });
      expect(imported.toRulesyncHooks().getJson().hooks.userPromptExpansion?.[0]?.command).toBe(
        "echo transformed",
      );
    });

    it("writes the portable command field unless a shell is selected", async () => {
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            // No `shell` selector: the output must be identical on every
            // platform, so the portable field is written.
            sessionStart: [{ command: "echo portable" }],
            sessionEnd: [{ command: "echo win", shell: "powershell" }],
            preToolUse: [{ command: "echo nix", shell: "bash" }],
          },
        }),
        validate: false,
      });

      const hooks = await CopilotcliHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
      const parsed = JSON.parse(hooks.getFileContent());

      expect(parsed.hooks.sessionStart[0]).toMatchObject({ command: "echo portable" });
      expect(parsed.hooks.sessionStart[0].bash).toBeUndefined();
      expect(parsed.hooks.sessionStart[0].powershell).toBeUndefined();
      expect(parsed.hooks.sessionEnd[0]).toMatchObject({ powershell: "echo win" });
      expect(parsed.hooks.preToolUse[0]).toMatchObject({ bash: "echo nix" });
    });

    it("drops a matcher on an event that does not honor one, naming all six that do", async () => {
      const logger = createMockLogger();
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: { userPromptExpansion: [{ matcher: "ignored", command: "echo x" }] },
        }),
        validate: false,
      });

      const hooks = await CopilotcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        logger,
      });

      expect(JSON.parse(hooks.getFileContent()).hooks.userPromptTransformed[0].matcher).toBe(
        undefined,
      );
      const warning = logger.warn.mock.calls.flat().join(" ");
      expect(warning).toContain("preToolUse");
      expect(warning).toContain("subagentStart");
    });

    it("round-trips a preToolUse matcher through import and export", async () => {
      const fileContent = JSON.stringify({
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", matcher: "Edit|Write", bash: "echo edit" }],
        },
      });
      const hooks = new CopilotcliHooks({
        outputRoot: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilotcli-hooks.json",
        fileContent,
        validate: false,
      });

      // Import preserves the matcher in canonical format.
      const canonical = JSON.parse(hooks.toRulesyncHooks().getFileContent());
      expect(canonical.hooks.preToolUse[0]).toMatchObject({
        type: "command",
        command: "echo edit",
        matcher: "Edit|Write",
      });

      // Re-export emits the matcher again.
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(canonical),
        validate: false,
      });
      const reexported = await CopilotcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
      });
      const parsed = JSON.parse(reexported.getFileContent());
      expect(parsed.hooks.preToolUse[0]).toMatchObject({ matcher: "Edit|Write" });
    });

    it("maps the wider Copilot CLI event surface", async () => {
      const config = {
        version: 1,
        hooks: {
          stop: [{ command: "echo stop" }],
          subagentStart: [{ command: "echo subagent-start" }],
          subagentStop: [{ command: "echo subagent-stop" }],
          postToolUseFailure: [{ command: "echo fail" }],
          preCompact: [{ command: "echo compact" }],
          permissionRequest: [{ command: "echo perm" }],
          notification: [{ command: "echo notify" }],
          beforeMCPExecution: [{ command: "echo mcp" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const hooks = await CopilotcliHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
      const parsed = JSON.parse(hooks.getFileContent());

      // `stop` maps to Copilot CLI's `agentStop`; the rest keep their names.
      expect(parsed.hooks.agentStop).toBeDefined();
      expect(parsed.hooks.subagentStart).toBeDefined();
      expect(parsed.hooks.subagentStop).toBeDefined();
      expect(parsed.hooks.postToolUseFailure).toBeDefined();
      expect(parsed.hooks.preCompact).toBeDefined();
      expect(parsed.hooks.permissionRequest).toBeDefined();
      expect(parsed.hooks.notification).toBeDefined();
      // `beforeMCPExecution` maps to Copilot CLI's `preMcpToolCall` (v1.0.51).
      expect(parsed.hooks.preMcpToolCall).toBeDefined();
    });

    it("round-trips the preMcpToolCall hook event", async () => {
      const copilotConfig = {
        version: 1,
        hooks: {
          preMcpToolCall: [{ type: "command", bash: "echo mcp" }],
        },
      };
      const imported = new CopilotcliHooks({
        outputRoot: testDir,
        relativeDirPath: ".github/hooks",
        relativeFilePath: "copilotcli-hooks.json",
        fileContent: JSON.stringify(copilotConfig),
        validate: false,
      });

      // Import maps `preMcpToolCall` back to canonical `beforeMCPExecution`.
      const canonical = JSON.parse(imported.toRulesyncHooks().getFileContent());
      expect(canonical.hooks.beforeMCPExecution).toBeDefined();
      expect(canonical.hooks.beforeMCPExecution[0]).toMatchObject({
        type: "command",
        command: "echo mcp",
      });

      // Re-export emits the Copilot CLI event name again.
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(canonical),
        validate: false,
      });
      const reExported = await CopilotcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
      });
      const parsed = JSON.parse(reExported.getFileContent());
      expect(parsed.hooks.preMcpToolCall).toBeDefined();
    });

    it("emits prompt and http hook types and preserves cwd/env", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [
            { type: "prompt", prompt: "Remember the project conventions." },
            { type: "command", command: "echo hi", cwd: "/work", env: { A: "b" } },
          ],
          preToolUse: [
            {
              type: "http",
              url: "https://example.com/hook",
              headers: { Authorization: "Bearer x" },
              allowedEnvVars: ["TOKEN"],
            },
          ],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const hooks = await CopilotcliHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
      const parsed = JSON.parse(hooks.getFileContent());

      const sessionStart = parsed.hooks.sessionStart;
      expect(sessionStart).toEqual(
        expect.arrayContaining([
          { type: "prompt", prompt: "Remember the project conventions." },
          expect.objectContaining({ type: "command", cwd: "/work", env: { A: "b" } }),
        ]),
      );
      expect(parsed.hooks.preToolUse[0]).toMatchObject({
        type: "http",
        url: "https://example.com/hook",
        headers: { Authorization: "Bearer x" },
        allowedEnvVars: ["TOKEN"],
      });
    });

    it("skips prompt hooks on events other than sessionStart", async () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ type: "prompt", prompt: "nope" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const hooks = await CopilotcliHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks.preToolUse).toBeUndefined();
    });

    it("round-trips prompt/http/cwd/env on import", async () => {
      const fileContent = JSON.stringify({
        version: 1,
        hooks: {
          sessionStart: [{ type: "prompt", prompt: "remember" }],
          agentStop: [{ type: "command", bash: "echo stop", cwd: "/w", env: { K: "v" } }],
          preToolUse: [{ type: "http", url: "https://x.test", allowedEnvVars: ["T"] }],
        },
      });
      const hooks = new CopilotcliHooks({
        outputRoot: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilotcli-hooks.json",
        fileContent,
        validate: false,
      });

      const canonical = JSON.parse(hooks.toRulesyncHooks().getFileContent());
      expect(canonical.hooks.sessionStart[0]).toMatchObject({ type: "prompt", prompt: "remember" });
      // agentStop maps back to canonical `stop`.
      expect(canonical.hooks.stop[0]).toMatchObject({
        type: "command",
        command: "echo stop",
        cwd: "/w",
        env: { K: "v" },
      });
      expect(canonical.hooks.preToolUse[0]).toMatchObject({
        type: "http",
        url: "https://x.test",
        allowedEnvVars: ["T"],
      });
    });

    it("should let copilotcli.hooks override copilot.hooks override shared hooks", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ command: "shared" }],
        },
        copilot: {
          hooks: {
            sessionStart: [{ command: "copilot-shared" }],
          },
        },
        copilotcli: {
          hooks: {
            sessionStart: [{ command: "cli-only" }],
          },
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const hooks = await CopilotcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });
      const parsed = JSON.parse(hooks.getFileContent());
      const stringified = JSON.stringify(parsed.hooks);
      expect(stringified).toContain("cli-only");
      expect(stringified).not.toContain("copilot-shared");
      expect(stringified).not.toContain('"shared"');
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert copilotcli-hooks.json back to canonical format", () => {
      const hooks = new CopilotcliHooks({
        outputRoot: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilotcli-hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [{ type: "command", bash: "echo a", timeoutSec: 30 }],
            errorOccurred: [{ type: "command", bash: "echo b" }],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = hooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart?.[0]?.command).toBe("echo a");
      expect(json.hooks.sessionStart?.[0]?.timeout).toBe(30);
      expect(json.hooks.afterError?.[0]?.command).toBe("echo b");
    });

    it("reads the portable command field and the timeout alias", () => {
      const hooks = new CopilotcliHooks({
        outputRoot: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilotcli-hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            // Upstream copies `command` to both shells when neither is present,
            // and honors `timeout` only when `timeoutSec` is absent.
            sessionStart: [{ type: "command", command: "echo portable", timeout: 45 }],
            // An explicit shell field still wins over the portable fallback.
            sessionEnd: [{ type: "command", bash: "echo bash", command: "echo ignored" }],
            // `timeoutSec` still wins over the alias.
            preToolUse: [{ type: "command", bash: "echo t", timeoutSec: 10, timeout: 99 }],
          },
        }),
        validate: false,
      });

      const json = hooks.toRulesyncHooks().getJson();
      expect(json.hooks.sessionStart?.[0]?.command).toBe("echo portable");
      expect(json.hooks.sessionStart?.[0]?.timeout).toBe(45);
      // A portable entry stays portable: no shell selector is invented for it.
      expect(json.hooks.sessionStart?.[0]?.shell).toBeUndefined();
      expect(json.hooks.sessionEnd?.[0]?.command).toBe("echo bash");
      expect(json.hooks.sessionEnd?.[0]?.shell).toBe("bash");
      expect(json.hooks.preToolUse?.[0]?.timeout).toBe(10);
    });

    it("should round-trip cwd through import and re-export", async () => {
      const hooks = new CopilotcliHooks({
        outputRoot: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilotcli-hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [
              { type: "command", bash: "echo hi", cwd: "packages/api", timeoutSec: 30 },
            ],
          },
        }),
        validate: false,
      });

      const imported = hooks.toRulesyncHooks().getJson();
      expect(imported.hooks.sessionStart?.[0]?.cwd).toBe("packages/api");

      const reExported = JSON.parse(
        (
          await CopilotcliHooks.fromRulesyncHooks({
            outputRoot: testDir,
            rulesyncHooks: hooks.toRulesyncHooks(),
            validate: false,
          })
        ).getFileContent(),
      );
      expect(reExported.hooks.sessionStart[0].cwd).toBe("packages/api");
      expect(reExported.hooks.sessionStart[0].timeoutSec).toBe(30);
    });

    it("should always take bash when both bash and powershell are present", () => {
      const logger = createMockLogger();

      const hooks = new CopilotcliHooks({
        outputRoot: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilotcli-hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [
              { type: "command", bash: "echo start", powershell: "Write-Output start" },
            ],
          },
        }),
        validate: false,
      });

      const json = hooks.toRulesyncHooks({ logger }).getJson();
      expect(json.hooks.sessionStart?.[0]?.command).toBe("echo start");
      expect(json.hooks.sessionStart?.[0]?.shell).toBe("bash");
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        "Copilot CLI hook has both bash and powershell commands; using bash and ignoring powershell, so the imported config does not depend on the machine the import ran on.",
      );
    });

    it("should pick bash on Windows too, so import does not depend on the platform", () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("win32");

      const hooks = new CopilotcliHooks({
        outputRoot: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilotcli-hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [
              { type: "command", bash: "echo start", powershell: "Write-Output start" },
            ],
          },
        }),
        validate: false,
      });

      // The same file must import to the same canonical config everywhere,
      // otherwise the rulesync hooks file differs per contributor's machine.
      const json = hooks.toRulesyncHooks().getJson();
      expect(json.hooks.sessionStart?.[0]?.command).toBe("echo start");
      expect(json.hooks.sessionStart?.[0]?.shell).toBe("bash");
    });

    it("should default missing 'type' field to 'command' when importing", () => {
      const hooks = new CopilotcliHooks({
        outputRoot: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilotcli-hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            // hand-edited entry omitting `type`
            sessionStart: [{ bash: "echo no-type" }],
          },
        }),
        validate: false,
      });

      const json = hooks.toRulesyncHooks().getJson();
      expect(json.hooks.sessionStart?.[0]?.command).toBe("echo no-type");
    });

    it("should carry an event named toString through as a plain string key (#2757)", () => {
      const hooks = new CopilotcliHooks({
        outputRoot: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilotcli-hooks.json",
        // JSON.parse yields an own enumerable `toString` key, unlike an object
        // literal whose `toString` the lookup map would inherit from
        // Object.prototype.
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [{ type: "command", bash: "echo start" }],
            toString: [{ type: "command", bash: "echo crafted" }],
          },
        }),
        validate: false,
      });

      const json = hooks.toRulesyncHooks().getJson();
      expect(json.hooks.sessionStart?.[0]?.command).toBe("echo start");
      expect(Object.keys(json.hooks)).toEqual(["sessionStart"]);
      // The unmapped name must fall through verbatim rather than resolving to
      // Object.prototype.toString and landing under its stringified source.
      const overrideHooks = (json as { copilotcli?: { hooks?: Record<string, unknown[]> } })
        .copilotcli?.hooks;
      expect(Object.keys(overrideHooks ?? {})).toEqual(["toString"]);
      expect(overrideHooks?.["toString"]?.[0]).toMatchObject({ command: "echo crafted" });
    });
  });

  describe("fromFile", () => {
    it("should load project copilotcli-hooks.json", async () => {
      const dir = join(testDir, ".github", "hooks");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "copilotcli-hooks.json"),
        JSON.stringify({ version: 1, hooks: { sessionStart: [] } }),
      );

      const hooks = await CopilotcliHooks.fromFile({ outputRoot: testDir, validate: false });
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.version).toBe(1);
    });

    it("should load global copilot-hooks.json from .copilot/hooks", async () => {
      const dir = join(testDir, ".copilot", "hooks");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "copilot-hooks.json"),
        JSON.stringify({ version: 1, hooks: {} }),
      );

      const hooks = await CopilotcliHooks.fromFile({
        outputRoot: testDir,
        validate: false,
        global: true,
      });
      expect(hooks.getRelativeDirPath()).toBe(join(".copilot", "hooks"));
      expect(hooks.getRelativeFilePath()).toBe("copilot-hooks.json");
    });

    it("should return default content when file does not exist", async () => {
      const hooks = await CopilotcliHooks.fromFile({ outputRoot: testDir, validate: false });
      expect(hooks.getFileContent()).toBe('{"hooks":{}}');
    });
  });

  describe("forDeletion", () => {
    it("should return CopilotcliHooks with empty hooks", () => {
      const hooks = CopilotcliHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilotcli-hooks.json",
      });
      expect(JSON.parse(hooks.getFileContent())).toEqual({ hooks: {} });
    });
  });
});

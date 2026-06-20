import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
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

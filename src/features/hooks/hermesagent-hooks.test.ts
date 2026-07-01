import { describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { parseHermesConfig } from "../hermes-config.js";
import { HermesagentHooks } from "./hermesagent-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

const logger = createMockLogger();

function rulesyncHooksFrom(config: Record<string, unknown>): RulesyncHooks {
  return new RulesyncHooks({
    relativeDirPath: ".rulesync",
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
    validate: false,
  });
}

describe("HermesagentHooks", () => {
  describe("getSettablePaths", () => {
    it("returns the shared global config.yaml path", () => {
      expect(HermesagentHooks.getSettablePaths()).toEqual({
        relativeDirPath: ".hermes",
        relativeFilePath: "config.yaml",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("maps preToolUse/postToolUse to pre_tool_call/post_tool_call with matcher", async () => {
      const rulesyncHooks = rulesyncHooksFrom({
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "guard.sh", matcher: "terminal" }],
          postToolUse: [{ type: "command", command: "format.sh" }],
        },
      });

      const hooks = await HermesagentHooks.fromRulesyncHooks({
        outputRoot: ".",
        rulesyncHooks,
      });

      const config = parseHermesConfig(hooks.getFileContent());
      expect(config.hooks).toEqual({
        pre_tool_call: [{ command: "guard.sh", matcher: "terminal" }],
        post_tool_call: [{ command: "format.sh" }],
      });
    });

    it("maps sessionStart/sessionEnd to on_session_start/on_session_end", async () => {
      const rulesyncHooks = rulesyncHooksFrom({
        version: 1,
        hooks: {
          sessionStart: [{ command: "init.sh" }],
          sessionEnd: [{ command: "cleanup.sh" }],
        },
      });

      const hooks = await HermesagentHooks.fromRulesyncHooks({
        outputRoot: ".",
        rulesyncHooks,
      });

      const config = parseHermesConfig(hooks.getFileContent());
      expect(config.hooks).toEqual({
        on_session_start: [{ command: "init.sh" }],
        on_session_end: [{ command: "cleanup.sh" }],
      });
    });

    it("maps preModelInvocation/postModelInvocation to pre_llm_call/post_llm_call", async () => {
      const rulesyncHooks = rulesyncHooksFrom({
        version: 1,
        hooks: {
          preModelInvocation: [{ command: "inject-context.sh" }],
          postModelInvocation: [{ command: "sync.sh" }],
        },
      });

      const hooks = await HermesagentHooks.fromRulesyncHooks({
        outputRoot: ".",
        rulesyncHooks,
      });

      const config = parseHermesConfig(hooks.getFileContent());
      expect(config.hooks).toEqual({
        pre_llm_call: [{ command: "inject-context.sh" }],
        post_llm_call: [{ command: "sync.sh" }],
      });
    });

    it("maps subagentStart/subagentStop to subagent_start/subagent_stop", async () => {
      const rulesyncHooks = rulesyncHooksFrom({
        version: 1,
        hooks: {
          subagentStart: [{ command: "log-start.sh" }],
          subagentStop: [{ command: "log-stop.sh" }],
        },
      });

      const hooks = await HermesagentHooks.fromRulesyncHooks({
        outputRoot: ".",
        rulesyncHooks,
      });

      const config = parseHermesConfig(hooks.getFileContent());
      expect(config.hooks).toEqual({
        subagent_start: [{ command: "log-start.sh" }],
        subagent_stop: [{ command: "log-stop.sh" }],
      });
    });

    it("passes through timeout", async () => {
      const rulesyncHooks = rulesyncHooksFrom({
        version: 1,
        hooks: {
          preToolUse: [{ command: "guard.sh", timeout: 5 }],
        },
      });

      const hooks = await HermesagentHooks.fromRulesyncHooks({
        outputRoot: ".",
        rulesyncHooks,
      });

      const config = parseHermesConfig(hooks.getFileContent());
      expect(config.hooks).toEqual({
        pre_tool_call: [{ command: "guard.sh", timeout: 5 }],
      });
    });

    it("drops events with no native Hermes equivalent", async () => {
      const rulesyncHooks = rulesyncHooksFrom({
        version: 1,
        hooks: {
          preToolUse: [{ command: "guard.sh" }],
          // Not part of Hermes's VALID_HOOKS mapping table.
          stop: [{ command: "audit.sh" }],
          worktreeCreate: [{ command: "wt.sh" }],
        },
      });

      const hooks = await HermesagentHooks.fromRulesyncHooks({
        outputRoot: ".",
        rulesyncHooks,
      });

      const config = parseHermesConfig(hooks.getFileContent());
      expect(config.hooks).toEqual({
        pre_tool_call: [{ command: "guard.sh" }],
      });
    });

    it("drops prompt/http hook types (only type: command is supported)", async () => {
      const rulesyncHooks = rulesyncHooksFrom({
        version: 1,
        hooks: {
          preToolUse: [
            { type: "command", command: "guard.sh" },
            { type: "prompt", prompt: "Should I proceed?" },
            { type: "http", url: "https://example.com/hook" },
          ],
        },
      });

      const hooks = await HermesagentHooks.fromRulesyncHooks({
        outputRoot: ".",
        rulesyncHooks,
      });

      const config = parseHermesConfig(hooks.getFileContent());
      expect(config.hooks).toEqual({
        pre_tool_call: [{ command: "guard.sh" }],
      });
    });

    it("drops matcher (with a warning) on events other than pre_tool_call/post_tool_call", async () => {
      const warnSpy = vi.spyOn(logger, "warn");
      const rulesyncHooks = rulesyncHooksFrom({
        version: 1,
        hooks: {
          sessionStart: [{ command: "init.sh", matcher: "ignored" }],
        },
      });

      const hooks = await HermesagentHooks.fromRulesyncHooks({
        outputRoot: ".",
        rulesyncHooks,
        logger,
      });

      const config = parseHermesConfig(hooks.getFileContent());
      expect(config.hooks).toEqual({
        on_session_start: [{ command: "init.sh" }],
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('matcher "ignored" on "sessionStart" hook will be ignored'),
      );
    });

    it("merges the hermesagent override block on top of shared hooks", async () => {
      const rulesyncHooks = rulesyncHooksFrom({
        version: 1,
        hooks: {
          preToolUse: [{ command: "shared.sh" }],
        },
        hermesagent: {
          hooks: {
            preToolUse: [{ command: "hermes-override.sh" }],
            postToolUse: [{ command: "post.sh" }],
          },
        },
      });

      const hooks = await HermesagentHooks.fromRulesyncHooks({
        outputRoot: ".",
        rulesyncHooks,
      });

      const config = parseHermesConfig(hooks.getFileContent());
      expect(config.hooks).toEqual({
        pre_tool_call: [{ command: "hermes-override.sh" }],
        post_tool_call: [{ command: "post.sh" }],
      });
    });

    it("preserves existing Hermes config when writing hooks", async () => {
      const rulesyncHooks = rulesyncHooksFrom({
        version: 1,
        hooks: {
          preToolUse: [{ command: "pnpm lint" }],
        },
      });

      const hooks = await HermesagentHooks.fromRulesyncHooks({
        outputRoot: ".",
        rulesyncHooks,
      });

      hooks.setFileContent(`model: hermes-3
mcp_servers:
  docs:
    url: https://example.com/mcp
hooks:
  pre_tool_call:
    - command: stale.sh
`);

      const config = parseHermesConfig(hooks.getFileContent());
      expect(config.model).toBe("hermes-3");
      expect(config.mcp_servers).toEqual({
        docs: { url: "https://example.com/mcp" },
      });
      // The freshly computed hooks block replaces the stale on-disk hooks,
      // the same way HermesagentPermissions/HermesagentMcp recompute their
      // managed keys from canonical rulesync state on every generation.
      expect(config.hooks).toEqual({
        pre_tool_call: [{ command: "pnpm lint" }],
      });
    });
  });

  describe("toRulesyncHooks", () => {
    it("round-trips native VALID_HOOKS event keys back to canonical event names", () => {
      const hooks = new HermesagentHooks({
        outputRoot: ".",
        fileContent: `hooks:
  pre_tool_call:
    - command: guard.sh
      matcher: terminal
  post_tool_call:
    - command: format.sh
  pre_llm_call:
    - command: inject.sh
  post_llm_call:
    - command: sync.sh
  on_session_start:
    - command: init.sh
  on_session_end:
    - command: cleanup.sh
  subagent_start:
    - command: log-start.sh
  subagent_stop:
    - command: log-stop.sh
`,
      });

      const json = hooks.toRulesyncHooks().getJson();
      expect(json.hooks.preToolUse).toEqual([
        { type: "command", command: "guard.sh", matcher: "terminal" },
      ]);
      expect(json.hooks.postToolUse).toEqual([{ type: "command", command: "format.sh" }]);
      expect(json.hooks.preModelInvocation).toEqual([{ type: "command", command: "inject.sh" }]);
      expect(json.hooks.postModelInvocation).toEqual([{ type: "command", command: "sync.sh" }]);
      expect(json.hooks.sessionStart).toEqual([{ type: "command", command: "init.sh" }]);
      expect(json.hooks.sessionEnd).toEqual([{ type: "command", command: "cleanup.sh" }]);
      expect(json.hooks.subagentStart).toEqual([{ type: "command", command: "log-start.sh" }]);
      expect(json.hooks.subagentStop).toEqual([{ type: "command", command: "log-stop.sh" }]);
    });

    it("drops native events with no canonical equivalent (pre_verify, transform_*, ...)", () => {
      const hooks = new HermesagentHooks({
        outputRoot: ".",
        fileContent: `hooks:
  pre_tool_call:
    - command: guard.sh
  pre_verify:
    - command: verify.sh
  transform_tool_result:
    - command: redact.sh
`,
      });

      const json = hooks.toRulesyncHooks().getJson();
      expect(json.hooks.preToolUse).toEqual([{ type: "command", command: "guard.sh" }]);
      expect(json.hooks.pre_verify).toBeUndefined();
      expect(json.hooks.transform_tool_result).toBeUndefined();
      expect(Object.keys(json.hooks)).toEqual(["preToolUse"]);
    });

    it("returns an empty canonical hooks map when no hooks key is present", () => {
      const hooks = new HermesagentHooks({
        outputRoot: ".",
        fileContent: "model: hermes-3\n",
      });

      const json = hooks.toRulesyncHooks().getJson();
      expect(json.hooks).toEqual({});
    });
  });

  describe("isDeletable", () => {
    it("returns false because config.yaml is shared with other Hermes settings", () => {
      const hooks = new HermesagentHooks({
        outputRoot: ".",
        fileContent: "hooks: {}\n",
      });
      expect(hooks.isDeletable()).toBe(false);
    });
  });
});

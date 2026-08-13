import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { parseSharedConfig } from "../shared/shared-config-gateway.js";
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

      const config = parseSharedConfig({ format: "yaml", fileContent: hooks.getFileContent() });
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

      const config = parseSharedConfig({ format: "yaml", fileContent: hooks.getFileContent() });
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

      const config = parseSharedConfig({ format: "yaml", fileContent: hooks.getFileContent() });
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

      const config = parseSharedConfig({ format: "yaml", fileContent: hooks.getFileContent() });
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

      const config = parseSharedConfig({ format: "yaml", fileContent: hooks.getFileContent() });
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

      const config = parseSharedConfig({ format: "yaml", fileContent: hooks.getFileContent() });
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

      const config = parseSharedConfig({ format: "yaml", fileContent: hooks.getFileContent() });
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

      const config = parseSharedConfig({ format: "yaml", fileContent: hooks.getFileContent() });
      expect(config.hooks).toEqual({
        on_session_start: [{ command: "init.sh" }],
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('matcher "ignored" on "sessionStart" hook will be ignored'),
      );
    });

    it("emits failClosed as fail_closed on pre_tool_call", async () => {
      const rulesyncHooks = rulesyncHooksFrom({
        version: 1,
        hooks: {
          preToolUse: [
            { command: "guard.sh", failClosed: true },
            { command: "audit.sh", failClosed: false },
          ],
        },
      });

      const hooks = await HermesagentHooks.fromRulesyncHooks({
        outputRoot: ".",
        rulesyncHooks,
      });

      const config = parseSharedConfig({ format: "yaml", fileContent: hooks.getFileContent() });
      expect(config.hooks).toEqual({
        pre_tool_call: [
          { command: "guard.sh", fail_closed: true },
          { command: "audit.sh", fail_closed: false },
        ],
      });
    });

    it("drops failClosed: true (with a warning) on events other than pre_tool_call", async () => {
      const warnSpy = vi.spyOn(logger, "warn");
      const rulesyncHooks = rulesyncHooksFrom({
        version: 1,
        hooks: {
          postToolUse: [{ command: "format.sh", failClosed: true }],
        },
      });

      const hooks = await HermesagentHooks.fromRulesyncHooks({
        outputRoot: ".",
        rulesyncHooks,
        logger,
      });

      const config = parseSharedConfig({ format: "yaml", fileContent: hooks.getFileContent() });
      expect(config.hooks).toEqual({
        post_tool_call: [{ command: "format.sh" }],
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('failClosed on "postToolUse" hook will be ignored'),
      );
    });

    it("does not warn about failClosed: false on another event (it is the upstream default)", async () => {
      // The mock logger is shared across this file, so drop the calls earlier
      // cases recorded before asserting on absence.
      const warnSpy = vi.spyOn(logger, "warn").mockClear();
      const rulesyncHooks = rulesyncHooksFrom({
        version: 1,
        hooks: {
          sessionStart: [{ command: "init.sh", failClosed: false }],
        },
      });

      const hooks = await HermesagentHooks.fromRulesyncHooks({
        outputRoot: ".",
        rulesyncHooks,
        logger,
      });

      const config = parseSharedConfig({ format: "yaml", fileContent: hooks.getFileContent() });
      expect(config.hooks).toEqual({
        on_session_start: [{ command: "init.sh" }],
      });
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("failClosed"));
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

      const config = parseSharedConfig({ format: "yaml", fileContent: hooks.getFileContent() });
      expect(config.hooks).toEqual({
        pre_tool_call: [{ command: "hermes-override.sh" }],
        post_tool_call: [{ command: "post.sh" }],
      });
    });

    it("emits native-only events and lets exact native overrides win", async () => {
      const rulesyncHooks = rulesyncHooksFrom({
        version: 1,
        hooks: {
          preToolUse: [{ command: "shared.sh" }],
        },
        hermesagent: {
          hooks: {
            preToolUse: [{ command: "canonical-override.sh" }],
            pre_tool_call: [{ command: "native-override.sh", matcher: "terminal" }],
            pre_verify: [{ command: "verify.sh", matcher: "ignored" }],
            pre_api_request: [{ command: "audit-request.sh" }],
            kanban_task_completed: [{ command: "audit-task.sh" }],
          },
        },
      });
      const warnSpy = vi.spyOn(logger, "warn");

      const hooks = await HermesagentHooks.fromRulesyncHooks({
        outputRoot: ".",
        rulesyncHooks,
        logger,
      });
      const config = parseSharedConfig({ format: "yaml", fileContent: hooks.getFileContent() });

      expect(config.hooks).toEqual({
        pre_tool_call: [{ command: "native-override.sh", matcher: "terminal" }],
        pre_verify: [{ command: "verify.sh" }],
        pre_api_request: [{ command: "audit-request.sh" }],
        kanban_task_completed: [{ command: "audit-task.sh" }],
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('matcher "ignored" on "pre_verify" hook will be ignored'),
      );
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

      const config = parseSharedConfig({ format: "yaml", fileContent: hooks.getFileContent() });
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

    it("preserves the hooks.outbound webhook registry (#2414)", async () => {
      const hooks = await HermesagentHooks.fromRulesyncHooks({
        outputRoot: ".",
        rulesyncHooks: rulesyncHooksFrom({
          version: 1,
          hooks: { preToolUse: [{ command: "pnpm lint" }] },
        }),
      });

      hooks.setFileContent(`hooks:
  outbound:
    - name: ci-notify
      url: https://ci.example.com/hermes-events
      events: [on_session_end]
      secret_env: HERMES_OUTBOUND_WEBHOOK_SECRET
      timeout: 10
  post_tool_call:
    - command: stale.sh
`);

      const config = parseSharedConfig({ format: "yaml", fileContent: hooks.getFileContent() });
      // `outbound` is a webhook registry, not a hook event: it has no rulesync
      // spelling, so replacing the whole mapping destroyed it silently.
      expect(config.hooks).toEqual({
        outbound: [
          {
            name: "ci-notify",
            url: "https://ci.example.com/hermes-events",
            events: ["on_session_end"],
            secret_env: "HERMES_OUTBOUND_WEBHOOK_SECRET",
            timeout: 10,
          },
        ],
        pre_tool_call: [{ command: "pnpm lint" }],
      });
    });

    it("still retracts a native event key that the rulesync source no longer declares", async () => {
      const hooks = await HermesagentHooks.fromRulesyncHooks({
        outputRoot: ".",
        rulesyncHooks: rulesyncHooksFrom({ version: 1, hooks: {} }),
      });

      hooks.setFileContent(`hooks:
  outbound:
    - url: https://ci.example.com/hermes-events
  pre_tool_call:
    - command: stale.sh
`);

      const config = parseSharedConfig({ format: "yaml", fileContent: hooks.getFileContent() });
      expect(config.hooks).toEqual({
        outbound: [{ url: "https://ci.example.com/hermes-events" }],
      });
    });

    it("retracts an undocumented event key it wrote through the override block", async () => {
      // Written by an earlier generate from `hermesagent.hooks`, which emits
      // event names Hermes does not document yet. Those are rulesync's, so
      // removing them from the source has to remove them from the file — the
      // sibling-preserving merge must not mistake them for a registry.
      const hooks = await HermesagentHooks.fromRulesyncHooks({
        outputRoot: ".",
        rulesyncHooks: rulesyncHooksFrom({ version: 1, hooks: {} }),
      });

      hooks.setFileContent(`hooks:
  on_context_compact:
    - command: stale.sh
`);

      const config = parseSharedConfig({ format: "yaml", fileContent: hooks.getFileContent() });
      expect(config.hooks).toEqual({});
    });
  });

  describe("toRulesyncHooks", () => {
    it("does not import the outbound webhook registry as a hook (#2414)", () => {
      const hooks = new HermesagentHooks({
        outputRoot: ".",
        fileContent: `hooks:
  outbound:
    - name: ci-notify
      url: https://ci.example.com/hermes-events
      events: [on_session_end]
`,
      });

      const imported = JSON.parse(hooks.toRulesyncHooks().getFileContent());
      expect(imported.hooks).toEqual({});
      expect(imported.hermesagent).toBeUndefined();
    });

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

    it("preserves native events with no canonical equivalent under hermesagent override", () => {
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
      expect(Object.keys(json.hooks)).toEqual(["preToolUse"]);
      expect(json.hermesagent?.hooks).toEqual({
        pre_verify: [{ type: "command", command: "verify.sh" }],
        transform_tool_result: [{ type: "command", command: "redact.sh" }],
      });
    });

    it("imports both fail_closed spellings back into canonical failClosed (#2414)", () => {
      const hooks = new HermesagentHooks({
        outputRoot: ".",
        fileContent: `hooks:
  pre_tool_call:
    - command: guard.sh
      fail_closed: true
    - command: audit.sh
      failClosed: true
    - command: plain.sh
  post_tool_call:
    - command: format.sh
      fail_closed: true
`,
      });

      const json = hooks.toRulesyncHooks().getJson();
      expect(json.hooks.preToolUse).toEqual([
        { type: "command", command: "guard.sh", failClosed: true },
        { type: "command", command: "audit.sh", failClosed: true },
        { type: "command", command: "plain.sh" },
      ]);
      // Upstream ignores the key outside pre_tool_call, so importing it there
      // would only produce a value the next generate warns about and drops.
      expect(json.hooks.postToolUse).toEqual([{ type: "command", command: "format.sh" }]);
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

describe("HermesagentHooks global settable paths", () => {
  // Pinned as literals rather than re-calling getHermesagentGlobalDir(), so the
  // platform branch itself is asserted and not merely restated.
  const expectedGlobalDir =
    process.platform === "win32" ? join("AppData", "Local", "hermes") : ".hermes";

  const originalHermesHome = process.env.HERMES_HOME;

  afterEach(() => {
    if (originalHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = originalHermesHome;
  });

  it("anchors global paths on the platform profile directory when HERMES_HOME is unset", () => {
    delete process.env.HERMES_HOME;

    expect(HermesagentHooks.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: expectedGlobalDir,
      relativeFilePath: "config.yaml",
    });
  });

  it("drops the .hermes prefix when HERMES_HOME names the profile root itself", () => {
    process.env.HERMES_HOME = "/custom-hermes";

    expect(HermesagentHooks.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: ".",
      relativeFilePath: "config.yaml",
    });
  });
});

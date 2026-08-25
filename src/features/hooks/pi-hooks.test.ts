import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { tsImport } from "tsx/esm/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { PiHooks } from "./pi-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

function buildRulesyncHooks({
  testDir,
  config,
}: {
  testDir: string;
  config: Record<string, unknown>;
}): RulesyncHooks {
  return new RulesyncHooks({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
    validate: false,
  });
}

describe("PiHooks", () => {
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
    it("should return .pi/extensions and rulesync-hooks.ts", () => {
      const paths = PiHooks.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: join(".pi", "extensions"),
        relativeFilePath: "rulesync-hooks.ts",
      });
    });

    it("should return .pi/agent/extensions for global mode", () => {
      const paths = PiHooks.getSettablePaths({ global: true });
      expect(paths).toEqual({
        relativeDirPath: join(".pi", "agent", "extensions"),
        relativeFilePath: "rulesync-hooks.ts",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should filter shared hooks to Pi-supported events and map to snake_case", () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
          sessionEnd: [{ command: "teardown.sh" }],
          stop: [{ command: ".rulesync/hooks/audit.sh" }],
          beforeSubmitPrompt: [{ command: "pre-prompt.sh" }],
          preModelInvocation: [{ command: "pre-model.sh" }],
          postModelInvocation: [{ command: "post-model.sh" }],
          preCompact: [{ command: "pre-compact.sh" }],
          postCompact: [{ command: "post-compact.sh" }],
          // notification has no Pi extension event equivalent
          notification: [{ command: "notify.sh" }],
          // afterFileEdit has no Pi extension event equivalent
          afterFileEdit: [{ command: "format.sh" }],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const content = piHooks.getFileContent();
      expect(content).toContain('pi.on("session_start", async () => {');
      expect(content).toContain(".rulesync/hooks/session-start.sh");
      expect(content).toContain('pi.on("session_shutdown", async () => {');
      expect(content).toContain("teardown.sh");
      expect(content).toContain('pi.on("agent_end", async () => {');
      expect(content).toContain(".rulesync/hooks/audit.sh");
      // `input` gates prompt submission, so the handler takes `ctx` for the
      // notify channel and returns an explicit `continue` on success.
      expect(content).toContain('pi.on("input", async (event, ctx) => {');
      expect(content).toContain("pre-prompt.sh");
      expect(content).toContain('return { action: "continue" };');
      expect(content).toContain('pi.on("context", async () => {');
      expect(content).toContain("pre-model.sh");
      // `message_end` fires for every message role, so the generated handler
      // must gate on the assistant role to run once per model response.
      expect(content).toContain('pi.on("message_end", async (event) => {');
      expect(content).toContain('if (event.message.role !== "assistant") return;');
      expect(content).toContain("post-model.sh");
      expect(content).toContain('pi.on("session_before_compact", async () => {');
      expect(content).toContain("pre-compact.sh");
      // Distinct from preCompact: Pi documents both, and an unmapped event is
      // dropped without a warning, so this is the only guard against silently
      // losing the subscription again.
      expect(content).toContain('pi.on("session_compact", async () => {');
      expect(content).toContain("post-compact.sh");

      // Unsupported events should not appear
      expect(content).not.toContain("notify.sh");
      expect(content).not.toContain("format.sh");
    });

    it("should generate tool event handlers honoring matchers against event.toolName", () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "lint.sh", matcher: "Write|Edit" }],
          postToolUse: [{ type: "command", command: "post-tool.sh" }],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const content = piHooks.getFileContent();
      expect(content).toContain('pi.on("tool_call", async (event) => {');
      expect(content).toContain('if (new RegExp("Write|Edit").test(event.toolName)) {');
      expect(content).toContain("lint.sh");
      // postToolUse has no matcher, so the handler ignores the event payload
      expect(content).toContain('pi.on("tool_result", async () => {');
      expect(content).toContain("post-tool.sh");
    });

    it("should block the tool call when a preToolUse hook command fails", () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "guard.sh", matcher: "Bash" }],
          postToolUse: [{ type: "command", command: "post-tool.sh" }],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const content = piHooks.getFileContent();
      // `tool_call` is Pi's only blocking event, so a non-zero exit must deny
      // the call instead of letting it run.
      expect(content).toContain("function toBlockReason(error: unknown): string {");
      expect(content).toContain("      try {");
      expect(content).toContain('        await run("guard.sh");');
      expect(content).toContain("      } catch (error) {");
      expect(content).toContain("        return { block: true, reason: toBlockReason(error) };");
      // A denied call hands control back to the model rather than ending the turn.
      expect(content).not.toContain("terminate");
      // `tool_result` cannot block, so it stays observe-only.
      expect(content).toContain('    await run("post-tool.sh");');
    });

    it("should cancel the prompt when a beforeSubmitPrompt hook command fails", () => {
      const config = {
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ type: "command", command: "gate.sh" }],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const content = piHooks.getFileContent();
      // Pi's `input` event skips the agent entirely when a handler returns
      // `{ action: "handled" }`, matching how the canonical event blocks on
      // every other hook-capable target.
      expect(content).toContain("function toBlockReason(error: unknown): string {");
      expect(content).toContain('pi.on("input", async (event, ctx) => {');
      expect(content).toContain("    try {");
      expect(content).toContain('      await run("gate.sh");');
      expect(content).toContain("    } catch (error) {");
      // `handled` carries no reason field, so the reason goes through the UI.
      expect(content).toContain("      reportPromptGateFailure(ctx, toBlockReason(error));");
      expect(content).toContain(
        "function reportPromptGateFailure(ctx: ExtensionContext, reason: string): void {",
      );
      expect(content).toContain(
        'import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";',
      );
      expect(content).toContain('      return { action: "handled" };');
      expect(content).toContain('    return { action: "continue" };');
    });

    it("should omit both blocking helpers when no gating hook is configured", () => {
      const config = {
        version: 1,
        hooks: {
          postToolUse: [{ type: "command", command: "post-tool.sh" }],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const content = piHooks.getFileContent();
      expect(content).not.toContain("toBlockReason");
      expect(content).not.toContain("block: true");
      expect(content).not.toContain("reportPromptGateFailure");
      // `ExtensionContext` is only needed by the prompt gate.
      expect(content).toContain(
        'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
      );
    });

    it("should emit the block-reason helper for a beforeSubmitPrompt-only config", () => {
      const config = {
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ type: "command", command: "gate.sh" }],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const content = piHooks.getFileContent();
      // The helper is shared by both gates; emitting it only for `tool_call`
      // would leave the prompt gate referencing an undefined function.
      expect(content).toContain("function toBlockReason(error: unknown): string {");
      expect(content).toContain("function reportPromptGateFailure(");
    });

    it("should run beforeSubmitPrompt handlers in order and cancel on the first failure", () => {
      const config = {
        version: 1,
        hooks: {
          beforeSubmitPrompt: [
            { type: "command", command: "gate-one.sh" },
            { type: "command", command: "gate-two.sh" },
          ],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const content = piHooks.getFileContent();
      // Each command gets its own try/catch, so the first failure returns
      // before the next one runs.
      expect(content.indexOf('await run("gate-one.sh")')).toBeLessThan(
        content.indexOf('await run("gate-two.sh")'),
      );
      expect(content.match(/return \{ action: "handled" \};/g)).toHaveLength(2);
    });

    it("should normalize only bare wildcard matcher to regex match-all pattern", () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [
            { type: "command", command: "all-tools.sh", matcher: "*" },
            { type: "command", command: "read-tools.sh", matcher: "Read*" },
          ],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const content = piHooks.getFileContent();
      expect(content).toContain('new RegExp(".*")');
      expect(content).toContain('new RegExp("Read*")');
      expect(content).toContain("all-tools.sh");
      expect(content).toContain("read-tools.sh");
    });

    it("should skip prompt-type hooks", () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [
            { type: "command", command: ".rulesync/hooks/session-start.sh" },
            { type: "prompt", prompt: "Remember to use TypeScript" },
          ],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const content = piHooks.getFileContent();
      expect(content).toContain(".rulesync/hooks/session-start.sh");
      expect(content).not.toContain("Remember to use TypeScript");
    });

    it("should merge config.pi.hooks on top of shared hooks", () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "shared.sh" }],
        },
        pi: {
          hooks: {
            sessionStart: [{ type: "command", command: "pi-override.sh" }],
            stop: [{ command: "pi-only.sh" }],
          },
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const content = piHooks.getFileContent();
      expect(content).toContain("pi-override.sh");
      expect(content).not.toContain("shared.sh");
      expect(content).toContain("pi-only.sh");
    });

    it("should generate an inert extension for an empty hooks config", () => {
      const config = {
        version: 1,
        hooks: {},
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      expect(piHooks.getFileContent()).toBe(
        [
          "// Generated by rulesync. Do not edit manually.",
          "export default function () {}",
          "",
        ].join("\n"),
      );
    });

    it("should embed commands as JS string literals with quotes and backslashes escaped", () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: 'echo "C:\\temp" `date` ${HOME}' }],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const content = piHooks.getFileContent();
      expect(content).toContain(`await run(${JSON.stringify('echo "C:\\temp" `date` ${HOME}')});`);
    });

    it("should throw on invalid regex in matcher", () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "lint.sh", matcher: "[invalid" }],
        },
      };
      expect(() =>
        PiHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks: buildRulesyncHooks({ testDir, config }),
          validate: false,
        }),
      ).toThrow("Invalid regex pattern in hook matcher");
    });

    it("should strip control characters from matcher", () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "lint.sh", matcher: "Write\n|Edit\r\0" }],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      expect(piHooks.getFileContent()).toContain('new RegExp("Write|Edit")');
    });

    it("should generate a loadable TypeScript module that registers the mapped events", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: 'echo "hi" `date` ${HOME}' }],
          preToolUse: [
            { type: "command", command: "lint.sh", matcher: "Write|Edit" },
            { type: "command", command: "audit.sh" },
          ],
          stop: [{ command: "done.sh" }],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const extensionsDir = join(testDir, ".pi", "extensions");
      await ensureDir(extensionsDir);
      const filePath = join(extensionsDir, "rulesync-hooks.ts");
      await writeFileContent(filePath, piHooks.getFileContent());

      const mod = await tsImport(pathToFileURL(filePath).href, import.meta.url);
      const on = vi.fn();
      mod.default({ on });
      expect(on.mock.calls.map(([event]) => event)).toEqual([
        "session_start",
        "tool_call",
        "agent_end",
      ]);
      expect(on).toHaveBeenCalledWith("session_start", expect.any(Function));
    });

    it("should generate an input handler that skips the agent when the command fails", async () => {
      const config = {
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ type: "command", command: "exit 3" }],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const extensionsDir = join(testDir, ".pi", "extensions");
      await ensureDir(extensionsDir);
      const filePath = join(extensionsDir, "rulesync-hooks.ts");
      await writeFileContent(filePath, piHooks.getFileContent());

      const mod = await tsImport(pathToFileURL(filePath).href, import.meta.url);
      const on = vi.fn();
      mod.default({ on });
      const handler = on.mock.calls.find(([event]) => event === "input")?.[1];
      expect(handler).toBeTypeOf("function");

      const notify = vi.fn();
      expect(
        await handler({ text: "hi", source: "interactive" }, { hasUI: true, ui: { notify } }),
      ).toEqual({
        action: "handled",
      });
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("3"), "error");
    });

    it("should still cancel the prompt without a UI channel", async () => {
      const config = {
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ type: "command", command: "exit 3" }],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const extensionsDir = join(testDir, ".pi", "extensions");
      await ensureDir(extensionsDir);
      const filePath = join(extensionsDir, "rulesync-hooks.ts");
      await writeFileContent(filePath, piHooks.getFileContent());

      const mod = await tsImport(pathToFileURL(filePath).href, import.meta.url);
      const on = vi.fn();
      mod.default({ on });
      const handler = on.mock.calls.find(([event]) => event === "input")?.[1];

      // `ctx.ui.notify` is a no-op in print (`-p`) and JSON modes, so the
      // reason falls back to stderr rather than vanishing.
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const notify = vi.fn();
      expect(
        await handler({ text: "hi", source: "interactive" }, { hasUI: false, ui: { notify } }),
      ).toEqual({ action: "handled" });
      expect(notify).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("3"));
    });

    it("should cancel the prompt even when the UI channel throws", async () => {
      const config = {
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ type: "command", command: "exit 3" }],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const extensionsDir = join(testDir, ".pi", "extensions");
      await ensureDir(extensionsDir);
      const filePath = join(extensionsDir, "rulesync-hooks.ts");
      await writeFileContent(filePath, piHooks.getFileContent());

      const mod = await tsImport(pathToFileURL(filePath).href, import.meta.url);
      const on = vi.fn();
      mod.default({ on });
      const handler = on.mock.calls.find(([event]) => event === "input")?.[1];

      // A throwing notify must not turn the gate fail-open.
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const notify = vi.fn(() => {
        throw new Error("rpc channel closed");
      });
      expect(
        await handler({ text: "hi", source: "interactive" }, { hasUI: true, ui: { notify } }),
      ).toEqual({ action: "handled" });
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("3"));
    });

    it("should not cancel prompts injected by another extension", async () => {
      const config = {
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ type: "command", command: "exit 3" }],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const extensionsDir = join(testDir, ".pi", "extensions");
      await ensureDir(extensionsDir);
      const filePath = join(extensionsDir, "rulesync-hooks.ts");
      await writeFileContent(filePath, piHooks.getFileContent());

      const mod = await tsImport(pathToFileURL(filePath).href, import.meta.url);
      const on = vi.fn();
      mod.default({ on });
      const handler = on.mock.calls.find(([event]) => event === "input")?.[1];

      // The canonical event covers prompts the user submits; `sendUserMessage`
      // traffic from another extension is not a user prompt.
      const notify = vi.fn();
      expect(
        await handler({ text: "hi", source: "extension" }, { hasUI: true, ui: { notify } }),
      ).toEqual({ action: "continue" });
      expect(notify).not.toHaveBeenCalled();
    });

    it("should strip terminal escape sequences from the reported reason", async () => {
      const config = {
        version: 1,
        hooks: {
          beforeSubmitPrompt: [
            { type: "command", command: "printf '\\033[31m%s\\033[0m' denied >&2; exit 1" },
          ],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const extensionsDir = join(testDir, ".pi", "extensions");
      await ensureDir(extensionsDir);
      const filePath = join(extensionsDir, "rulesync-hooks.ts");
      await writeFileContent(filePath, piHooks.getFileContent());

      const mod = await tsImport(pathToFileURL(filePath).href, import.meta.url);
      const on = vi.fn();
      mod.default({ on });
      const handler = on.mock.calls.find(([event]) => event === "input")?.[1];

      const notify = vi.fn();
      await handler({ text: "hi", source: "interactive" }, { hasUI: true, ui: { notify } });
      // Hook output can relay third-party text into a terminal or an RPC
      // client, so control sequences are dropped before it is reported.
      expect(notify).toHaveBeenCalledWith("denied", "error");
    });

    it("should generate an input handler that continues when the command succeeds", async () => {
      const config = {
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ type: "command", command: "exit 0" }],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const extensionsDir = join(testDir, ".pi", "extensions");
      await ensureDir(extensionsDir);
      const filePath = join(extensionsDir, "rulesync-hooks.ts");
      await writeFileContent(filePath, piHooks.getFileContent());

      const mod = await tsImport(pathToFileURL(filePath).href, import.meta.url);
      const on = vi.fn();
      mod.default({ on });
      const handler = on.mock.calls.find(([event]) => event === "input")?.[1];
      const notify = vi.fn();
      expect(
        await handler({ text: "hi", source: "interactive" }, { hasUI: true, ui: { notify } }),
      ).toEqual({ action: "continue" });
      expect(notify).not.toHaveBeenCalled();
    });
  });

  describe("toRulesyncHooks", () => {
    it("should throw because Pi hooks cannot be converted back", () => {
      const piHooks = new PiHooks({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "extensions"),
        relativeFilePath: "rulesync-hooks.ts",
        fileContent: "export default function () {}",
        validate: false,
      });

      expect(() => piHooks.toRulesyncHooks()).toThrow(
        "Not implemented because Pi hooks are generated as a TypeScript extension file.",
      );
    });
  });

  describe("fromFile", () => {
    it("should load from .pi/extensions/rulesync-hooks.ts", async () => {
      const extensionsDir = join(testDir, ".pi", "extensions");
      await ensureDir(extensionsDir);
      const content = "export default function () {}";
      await writeFileContent(join(extensionsDir, "rulesync-hooks.ts"), content);

      const piHooks = await PiHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(piHooks).toBeInstanceOf(PiHooks);
      expect(piHooks.getFileContent()).toBe(content);
    });
  });

  describe("forDeletion", () => {
    it("should return PiHooks instance with empty content for deletion", () => {
      const hooks = PiHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "extensions"),
        relativeFilePath: "rulesync-hooks.ts",
      });
      expect(hooks).toBeInstanceOf(PiHooks);
      expect(hooks.getFileContent()).toBe("");
    });
  });

  describe("isDeletable", () => {
    it("should return true (extension file is standalone and deletable)", () => {
      const hooks = new PiHooks({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "extensions"),
        relativeFilePath: "rulesync-hooks.ts",
        fileContent: "",
        validate: false,
      });
      expect(hooks.isDeletable()).toBe(true);
    });
  });
});

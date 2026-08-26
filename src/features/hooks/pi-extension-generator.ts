import { CONTROL_CHARS, HooksConfig } from "../../types/hooks.js";

/**
 * Pi extension events fired per tool invocation; handlers for these receive
 * `event.toolName` and honor the canonical hook `matcher` as a regex on it.
 */
const PI_TOOL_EVENTS = new Set(["tool_call", "tool_result"]);

/**
 * Pi extension events that fire for every message role (user, assistant,
 * toolResult). The generated handler gates these on the assistant role so a
 * `postModelInvocation` hook runs once per finalized model response rather
 * than for every message in the conversation.
 */
const PI_ASSISTANT_MESSAGE_EVENTS = new Set(["message_end"]);

/**
 * `tool_call` is Pi's tool gate. Its return contract is
 * `{ block: true, reason?: string, terminate?: boolean }`.
 *
 * @see https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/docs/extensions.md#tool_call
 */
const PI_BLOCKING_EVENT = "tool_call";

/**
 * `input` is Pi's prompt-submission gate. A handler that returns
 * `{ action: "handled" }` skips the agent entirely for that prompt (the first
 * handler returning it wins), which is how a canonical `beforeSubmitPrompt`
 * hook cancels a prompt on the other hook-capable targets. `handled` carries
 * no reason field, so the failure text is reported through the extension
 * context instead.
 *
 * @see https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/docs/extensions.md#input
 */
const PI_PROMPT_BLOCKING_EVENT = "input";

/** How a generated handler reacts to a hook command that exits non-zero. */
type BlockingMode = "none" | "tool" | "prompt";

const PI_BLOCKING_MODE_BY_EVENT: Record<string, BlockingMode> = {
  [PI_BLOCKING_EVENT]: "tool",
  [PI_PROMPT_BLOCKING_EVENT]: "prompt",
};

/**
 * The body emitted inside a blocking handler's `catch`, per gate. `tool_call`
 * carries the reason in its own return contract; `input` has no reason field,
 * so the reason is reported through the context before the prompt is
 * cancelled.
 */
const FAILURE_LINES_BY_MODE: Record<BlockingMode, readonly string[]> = {
  none: [],
  // `terminate` is deliberately left unset: a denied tool call should hand
  // control back to the model (as Claude Code's `PreToolUse` deny does)
  // rather than end the agent turn.
  tool: ["return { block: true, reason: toBlockReason(error) };"],
  prompt: ["reportPromptGateFailure(ctx, toBlockReason(error));", 'return { action: "handled" };'],
};

/**
 * Helper emitted alongside blocking handlers. `promisify(exec)` rejects on a
 * non-zero exit with an error carrying `stdout` / `stderr` / `code`, so the
 * reason is derived from the rejection rather than from a resolved exit code.
 * A command that could not be run at all (spawn failure, `maxBuffer` overflow)
 * also rejects, and is deliberately treated as a block: a gate that cannot run
 * must not silently pass.
 *
 * The chosen text is sanitized because a hook command's output can relay
 * third-party content (linter output, matched file lines) into a terminal or,
 * in RPC mode, into an external client. Escape sequences, C1 and other control
 * characters, and format characters such as bidirectional overrides and
 * zero-width joiners are stripped so the reason cannot repaint or reorder what
 * the user is shown, and carriage returns are folded into newlines so it cannot
 * overwrite an already printed line. The format-character pass is a superset of
 * the bidi controls listed in `CONTROL_CHARACTERS_PATTERN`
 * (`src/utils/control-characters.ts`): a blocked-hook reason is short
 * diagnostic text, so dropping every `Cf` character is safer than enumerating
 * the harmful ones and missing `U+061C`, `U+FEFF`, or a future addition.
 *
 * Sanitization runs before truncation so a reason that begins with a progress
 * banner is still reported by its content. The raw text is only sliced to a
 * generous backstop first: a hook command may emit up to `exec`'s full
 * `maxBuffer`, and the slice bounds the work even if a later edit reintroduces
 * a pattern that is not linear. A slice that actually fired is reported as
 * truncated, so the text is never silently cut.
 *
 * Both slices cut on UTF-16 code units, so each drops a trailing lone high
 * surrogate: the reason travels to an RPC client as JSON, and half a surrogate
 * pair is not text a strict consumer has to accept.
 */
const BLOCK_REASON_HELPER_LINES = [
  "const MAX_BLOCK_REASON_LENGTH = 2000;",
  "const MAX_SCANNED_REASON_LENGTH = 128_000;",
  "",
  "function dropTrailingLoneSurrogate(text: string): string {",
  '  return text.replace(/[\\ud800-\\udbff]$/, "");',
  "}",
  "",
  "function toBlockReason(error: unknown): string {",
  "  const result = error as { stdout?: unknown; stderr?: unknown; code?: unknown } | null;",
  '  const stderr = String(result?.stderr ?? "").trim();',
  '  const stdout = String(result?.stdout ?? "").trim();',
  "  const raw =",
  "    stderr ||",
  "    stdout ||",
  "    (result?.code !== undefined",
  "      ? `Hook command failed with exit code ${result.code}.`",
  "      : error instanceof Error",
  "        ? error.message",
  "        : String(error));",
  "  const scannedTruncated = raw.length > MAX_SCANNED_REASON_LENGTH;",
  "  const scanned = scannedTruncated",
  "    ? dropTrailingLoneSurrogate(raw.slice(0, MAX_SCANNED_REASON_LENGTH))",
  "    : raw;",
  "  const sanitized = scanned",
  '    .replace(/\\r\\n?/g, "\\n")',
  '    .replace(/\\u001b\\[[0-9;?]*[\\u0020-\\u002f]*[\\u0040-\\u007e]/g, "")',
  '    .replace(/\\u001b\\][^\\u0007\\u001b]{0,256}(?:\\u0007|\\u001b\\\\)/g, "")',
  '    .replace(/[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f]/g, "")',
  '    .replace(/[\\p{Cf}\\p{Zl}\\p{Zp}]/gu, "")',
  "    .trim();",
  '  if (!sanitized) return "Hook command failed.";',
  "  if (sanitized.length <= MAX_BLOCK_REASON_LENGTH && !scannedTruncated) return sanitized;",
  "  return `${dropTrailingLoneSurrogate(sanitized.slice(0, MAX_BLOCK_REASON_LENGTH))}...`;",
  "}",
];

/**
 * Helper emitted alongside prompt-gate handlers. `{ action: "handled" }` has
 * no reason field, so the reason reaches the user through `ctx.ui.notify` —
 * which is a no-op in print (`-p`) and JSON modes, and can itself throw when
 * the RPC channel is gone. Both cases fall back to stderr so a cancelled
 * prompt is never silent, and neither can stop the caller from cancelling it.
 */
const PROMPT_GATE_HELPER_LINES = [
  "function reportPromptGateFailure(ctx: ExtensionContext, reason: string): void {",
  "  try {",
  "    if (ctx.hasUI) {",
  '      ctx.ui.notify(reason, "error");',
  "      return;",
  "    }",
  "  } catch {",
  "    // The UI channel is best-effort; fall through to stderr.",
  "  }",
  "  console.error(reason);",
  "}",
];

/**
 * Validate a hook matcher as a regular expression and return it as a JS
 * string-literal (JSON.stringify quoting) safe to embed in generated code.
 */
function matcherToEmbeddedLiteral(matcher: string): string {
  let sanitized = matcher;
  for (const char of CONTROL_CHARS) {
    sanitized = sanitized.replaceAll(char, "");
  }
  if (sanitized === "*") {
    sanitized = ".*";
  }
  try {
    new RegExp(sanitized);
  } catch {
    throw new Error(`Invalid regex pattern in hook matcher: ${sanitized}`);
  }
  return JSON.stringify(sanitized);
}

type Handler = { command: string; matcher?: string };
type HandlerGroup = Record<string, Handler[]>;

function collectPiHandlers({
  effectiveHooks,
  eventMap,
}: {
  effectiveHooks: HooksConfig["hooks"];
  eventMap: Record<string, string>;
}): HandlerGroup {
  const handlerGroups: HandlerGroup = {};
  for (const [canonicalEvent, definitions] of Object.entries(effectiveHooks)) {
    const piEvent = eventMap[canonicalEvent];
    if (!piEvent) continue;

    const handlers: Handler[] = [];
    for (const def of definitions) {
      if ((def.type ?? "command") !== "command") continue;
      if (!def.command) continue;
      handlers.push({
        command: def.command,
        matcher: def.matcher ? def.matcher : undefined,
      });
    }

    if (handlers.length > 0) {
      const existing = handlerGroups[piEvent];
      if (existing) {
        existing.push(...handlers);
      } else {
        handlerGroups[piEvent] = handlers;
      }
    }
  }
  return handlerGroups;
}

function buildCommandLines({
  handler,
  usesToolName,
  blocking,
}: {
  handler: Handler;
  usesToolName: boolean;
  blocking: BlockingMode;
}): string[] {
  const lines: string[] = [];
  const gated = usesToolName && Boolean(handler.matcher);
  const indent = gated ? "      " : "    ";
  const embeddedCommand = JSON.stringify(handler.command);
  if (gated && handler.matcher) {
    lines.push(
      `    if (new RegExp(${matcherToEmbeddedLiteral(handler.matcher)}).test(event.toolName)) {`,
    );
  }

  const onFailure = FAILURE_LINES_BY_MODE[blocking];
  if (onFailure.length > 0) {
    lines.push(`${indent}try {`);
    lines.push(`${indent}  await run(${embeddedCommand});`);
    lines.push(`${indent}} catch (error) {`);
    for (const line of onFailure) {
      lines.push(`${indent}  ${line}`);
    }
    lines.push(`${indent}}`);
  } else {
    lines.push(`${indent}await run(${embeddedCommand});`);
  }

  if (gated) {
    lines.push("    }");
  }
  return lines;
}

function buildSubscriptionLines(handlerGroups: HandlerGroup): string[] {
  const lines: string[] = [];
  for (const [piEvent, handlers] of Object.entries(handlerGroups)) {
    const blocking = PI_BLOCKING_MODE_BY_EVENT[piEvent] ?? "none";
    const isPromptGate = blocking === "prompt";
    const usesToolName = PI_TOOL_EVENTS.has(piEvent) && handlers.some((h) => h.matcher);
    const gatesOnAssistant = PI_ASSISTANT_MESSAGE_EVENTS.has(piEvent);
    const usesEvent = usesToolName || gatesOnAssistant || isPromptGate;
    // `ctx` is the second handler argument, so the prompt gate names both.
    const params = isPromptGate ? "event, ctx" : usesEvent ? "event" : "";
    lines.push(`  pi.on(${JSON.stringify(piEvent)}, async (${params}) => {`);
    if (gatesOnAssistant) {
      lines.push(`    if (event.message.role !== "assistant") return;`);
    }
    if (isPromptGate) {
      // The canonical event covers prompts the user submits; Pi also fires
      // `input` for messages another extension injects via `sendUserMessage`,
      // which a user's prompt gate should not cancel.
      lines.push(`    if (event.source === "extension") return { action: "continue" };`);
    }
    for (const handler of handlers) {
      lines.push(
        ...buildCommandLines({
          handler,
          usesToolName,
          blocking,
        }),
      );
    }
    if (isPromptGate) {
      lines.push(`    return { action: "continue" };`);
    }
    lines.push("  });");
  }
  return lines;
}

/**
 * Generate the rulesync-owned Pi extension (a TypeScript module with a
 * default-export factory receiving Pi's ExtensionAPI) that subscribes to the
 * mapped lifecycle events and executes the configured hook commands via the
 * platform shell. Handlers observe events, except on `tool_call` — Pi's tool
 * gate — where a hook command that exits non-zero denies the call with
 * `{ block: true, reason }`, and on `input` — Pi's prompt-submission gate —
 * where a non-zero exit cancels the prompt with `{ action: "handled" }`.
 *
 * @see https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md
 */
export function generatePiExtensionCode({
  config,
  supportedEvents,
  eventMap,
}: {
  config: HooksConfig;
  supportedEvents: readonly string[];
  eventMap: Record<string, string>;
}): string {
  const supported: Set<string> = new Set(supportedEvents);
  const configHooks = { ...config.hooks, ...config.pi?.hooks };
  const effectiveHooks: HooksConfig["hooks"] = {};

  for (const [event, defs] of Object.entries(configHooks)) {
    if (supported.has(event)) effectiveHooks[event] = defs;
  }

  const handlerGroups = collectPiHandlers({ effectiveHooks, eventMap });
  const subscriptionLines = buildSubscriptionLines(handlerGroups);
  const hasPromptGate = Boolean(handlerGroups[PI_PROMPT_BLOCKING_EVENT]);
  const needsBlockReasonHelper = Boolean(handlerGroups[PI_BLOCKING_EVENT]) || hasPromptGate;

  const lines: string[] = ["// Generated by rulesync. Do not edit manually."];
  if (subscriptionLines.length === 0) {
    lines.push("export default function () {}");
    lines.push("");
    return lines.join("\n");
  }

  const importedTypes = hasPromptGate ? "ExtensionAPI, ExtensionContext" : "ExtensionAPI";
  lines.push('import { exec } from "node:child_process";');
  lines.push('import { promisify } from "node:util";');
  lines.push("");
  lines.push(`import type { ${importedTypes} } from "@earendil-works/pi-coding-agent";`);
  lines.push("");
  lines.push("const run = promisify(exec);");
  lines.push("");
  if (needsBlockReasonHelper) {
    lines.push(...BLOCK_REASON_HELPER_LINES);
    lines.push("");
  }
  if (hasPromptGate) {
    lines.push(...PROMPT_GATE_HELPER_LINES);
    lines.push("");
  }
  lines.push("export default function (pi: ExtensionAPI) {");
  lines.push(...subscriptionLines);
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

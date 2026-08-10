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
 * `tool_call` is the only Pi extension event that can block, and it is Pi's
 * only tool gate. Its return contract is
 * `{ block: true, reason?: string, terminate?: boolean }`.
 *
 * @see https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/docs/extensions.md#tool_call
 */
const PI_BLOCKING_EVENT = "tool_call";

/**
 * Helper emitted alongside blocking handlers. `promisify(exec)` rejects on a
 * non-zero exit with an error carrying `stdout` / `stderr` / `code`, so the
 * reason is derived from the rejection rather than from a resolved exit code.
 */
const BLOCK_REASON_HELPER_LINES = [
  "function toBlockReason(error: unknown): string {",
  "  const result = error as { stdout?: unknown; stderr?: unknown; code?: unknown } | null;",
  '  const stderr = String(result?.stderr ?? "").trim();',
  "  if (stderr) return stderr;",
  '  const stdout = String(result?.stdout ?? "").trim();',
  "  if (stdout) return stdout;",
  "  if (result?.code !== undefined) return `Hook command failed with exit code ${result.code}.`;",
  "  return error instanceof Error ? error.message : String(error);",
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
  blocksToolCall,
}: {
  handler: Handler;
  usesToolName: boolean;
  blocksToolCall: boolean;
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

  if (blocksToolCall) {
    lines.push(`${indent}try {`);
    lines.push(`${indent}  await run(${embeddedCommand});`);
    lines.push(`${indent}} catch (error) {`);
    // `terminate` is deliberately left unset: a denied tool call should hand
    // control back to the model (as Claude Code's `PreToolUse` deny does)
    // rather than end the agent turn.
    lines.push(`${indent}  return { block: true, reason: toBlockReason(error) };`);
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
    const usesToolName = PI_TOOL_EVENTS.has(piEvent) && handlers.some((h) => h.matcher);
    const gatesOnAssistant = PI_ASSISTANT_MESSAGE_EVENTS.has(piEvent);
    const usesEvent = usesToolName || gatesOnAssistant;
    lines.push(`  pi.on(${JSON.stringify(piEvent)}, async (${usesEvent ? "event" : ""}) => {`);
    if (gatesOnAssistant) {
      lines.push(`    if (event.message.role !== "assistant") return;`);
    }
    for (const handler of handlers) {
      lines.push(
        ...buildCommandLines({
          handler,
          usesToolName,
          blocksToolCall: piEvent === PI_BLOCKING_EVENT,
        }),
      );
    }
    lines.push("  });");
  }
  return lines;
}

/**
 * Generate the rulesync-owned Pi extension (a TypeScript module with a
 * default-export factory receiving Pi's ExtensionAPI) that subscribes to the
 * mapped lifecycle events and executes the configured hook commands via the
 * platform shell. Handlers observe events, except on `tool_call` — Pi's only
 * blocking event and its only tool gate — where a hook command that exits
 * non-zero denies the call with `{ block: true, reason }`.
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
  const needsBlockReasonHelper = Boolean(handlerGroups[PI_BLOCKING_EVENT]);

  const lines: string[] = ["// Generated by rulesync. Do not edit manually."];
  if (subscriptionLines.length === 0) {
    lines.push("export default function () {}");
    lines.push("");
    return lines.join("\n");
  }

  lines.push('import { exec } from "node:child_process";');
  lines.push('import { promisify } from "node:util";');
  lines.push("");
  lines.push('import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";');
  lines.push("");
  lines.push("const run = promisify(exec);");
  lines.push("");
  if (needsBlockReasonHelper) {
    lines.push(...BLOCK_REASON_HELPER_LINES);
    lines.push("");
  }
  lines.push("export default function (pi: ExtensionAPI) {");
  lines.push(...subscriptionLines);
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

import { HooksConfig, CONTROL_CHARS } from "../../types/hooks.js";

const NAMED_HOOKS = new Set(["tool.execute.before", "tool.execute.after"]);

function escapeForTemplateLiteral(command: string): string {
  return command.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function validateAndSanitizeMatcher(matcher: string): string {
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
  return sanitized.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

type Handler = { command: string; matcher?: string };
type HandlerGroup = Record<string, Handler[]>;

/**
 * Group the effective hooks into named (tool.execute.*) and generic event
 * handler groups, keyed by tool event name. Mutates the supplied groups.
 */
function collectOpencodeStyleHandlers({
  effectiveHooks,
  eventMap,
  namedEventHandlers,
  genericEventHandlers,
}: {
  effectiveHooks: HooksConfig["hooks"];
  eventMap: Record<string, string>;
  namedEventHandlers: HandlerGroup;
  genericEventHandlers: HandlerGroup;
}): void {
  for (const [canonicalEvent, definitions] of Object.entries(effectiveHooks)) {
    const toolEvent = eventMap[canonicalEvent];
    if (!toolEvent) continue;

    const handlers: Handler[] = [];
    for (const def of definitions) {
      if (def.type === "prompt") continue;
      if (!def.command) continue;
      handlers.push({
        command: def.command,
        matcher: def.matcher ? def.matcher : undefined,
      });
    }

    if (handlers.length > 0) {
      const grouped = NAMED_HOOKS.has(toolEvent) ? namedEventHandlers : genericEventHandlers;
      const existing = grouped[toolEvent];
      if (existing) {
        existing.push(...handlers);
      } else {
        grouped[toolEvent] = handlers;
      }
    }
  }
}

/** Emit the `event: async ({ event }) => {...}` block for generic handlers. */
function buildGenericEventBodyLines(genericEventHandlers: HandlerGroup): string[] {
  const bodyLines: string[] = [];
  if (Object.keys(genericEventHandlers).length === 0) {
    return bodyLines;
  }
  bodyLines.push("    event: async ({ event }) => {");
  let isFirst = true;
  for (const [eventName, handlers] of Object.entries(genericEventHandlers)) {
    bodyLines.push(`      ${isFirst ? "if" : "else if"} (event.type === "${eventName}") {`);
    isFirst = false;
    for (const handler of handlers) {
      const escapedCommand = escapeForTemplateLiteral(handler.command);
      bodyLines.push(`        await $\`${escapedCommand}\`;`);
    }
    bodyLines.push("      }");
  }
  bodyLines.push("    },");
  return bodyLines;
}

/** Emit the named (`tool.execute.*`) handler blocks. */
function buildNamedEventBodyLines(namedEventHandlers: HandlerGroup): string[] {
  const bodyLines: string[] = [];
  for (const [eventName, handlers] of Object.entries(namedEventHandlers)) {
    bodyLines.push(`    "${eventName}": async (input) => {`);
    for (const handler of handlers) {
      const escapedCommand = escapeForTemplateLiteral(handler.command);
      if (handler.matcher) {
        const safeMatcher = validateAndSanitizeMatcher(handler.matcher);
        bodyLines.push("      {");
        bodyLines.push(`        const __re = new RegExp("${safeMatcher}");`);
        bodyLines.push(`        if (__re.test(input.tool)) {`);
        bodyLines.push(`          await $\`${escapedCommand}\`;`);
        bodyLines.push("        }");
        bodyLines.push("      }");
      } else {
        bodyLines.push(`      await $\`${escapedCommand}\`;`);
      }
    }
    bodyLines.push("    },");
  }
  return bodyLines;
}

/** Wrap the handler body lines in the requested export shape. */
function wrapInExportShape({
  bodyLines,
  exportStyle,
}: {
  bodyLines: string[];
  exportStyle: "named" | "default";
}): string[] {
  const lines: string[] = [];
  if (exportStyle === "default") {
    lines.push("export default {");
    lines.push('  id: "rulesync-hooks",');
    lines.push("  server: async ({ $ }) => {");
    lines.push("    return {");
    // Indent the handler entries by an extra two spaces to account for the
    // additional `server` function nesting level. Blank lines stay empty.
    for (const line of bodyLines) {
      lines.push(line === "" ? "" : `  ${line}`);
    }
    lines.push("    };");
    lines.push("  },");
    lines.push("};");
  } else {
    lines.push("export const RulesyncHooksPlugin = async ({ $ }) => {");
    lines.push("  return {");
    lines.push(...bodyLines);
    lines.push("  };");
    lines.push("};");
  }
  lines.push("");
  return lines;
}

export function generateOpencodeStylePluginCode(
  config: HooksConfig,
  supportedEvents: readonly string[],
  toolConfigKey: "kilo" | "opencode",
  eventMap: Record<string, string>,
  // Export shape of the generated plugin module:
  // - "named" (default): `export const RulesyncHooksPlugin = async ({ $ }) => {...}`
  //   — the OpenCode convention.
  // - "default": `export default { id: "rulesync-hooks", server: async ({ $ }) => {...} }`
  //   — Kilo's canonical `{ id, server }` module descriptor. Kilo marks named
  //   exports as legacy, so the Kilo target emits this form.
  //   https://kilo.ai/docs/automate/extending/plugins
  exportStyle: "named" | "default" = "named",
): string {
  const supported: Set<string> = new Set(supportedEvents);
  const configHooks = { ...config.hooks, ...config[toolConfigKey]?.hooks };
  const effectiveHooks: HooksConfig["hooks"] = {};

  for (const [event, defs] of Object.entries(configHooks)) {
    if (supported.has(event)) effectiveHooks[event] = defs;
  }

  const namedEventHandlers: HandlerGroup = {};
  const genericEventHandlers: HandlerGroup = {};

  collectOpencodeStyleHandlers({
    effectiveHooks,
    eventMap,
    namedEventHandlers,
    genericEventHandlers,
  });

  // Build the handler entries (the contents of the returned object) once with a
  // base indentation, then wrap them in the requested export shape. The default
  // (Kilo) export nests the function one level deeper, so its body is re-indented
  // by an extra two spaces relative to the named (OpenCode) export.
  const bodyLines: string[] = [
    ...buildGenericEventBodyLines(genericEventHandlers),
    ...buildNamedEventBodyLines(namedEventHandlers),
  ];

  const lines = wrapInExportShape({ bodyLines, exportStyle });

  return lines.join("\n");
}

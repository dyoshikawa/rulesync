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
  try {
    new RegExp(sanitized);
  } catch {
    throw new Error(`Invalid regex pattern in hook matcher: ${sanitized}`);
  }
  return sanitized.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

type Handler = { command: string; matcher?: string };
type HandlerGroup = Record<string, Handler[]>;

export function generateOpencodeStylePluginCode(
  config: HooksConfig,
  supportedEvents: readonly string[],
  toolConfigKey: "kilo" | "opencode",
  eventMap: Record<string, string>,
): string {
  const supported: Set<string> = new Set(supportedEvents);
  const configHooks = { ...config.hooks, ...config[toolConfigKey]?.hooks };
  const effectiveHooks: HooksConfig["hooks"] = {};

  for (const [event, defs] of Object.entries(configHooks)) {
    if (supported.has(event)) effectiveHooks[event] = defs;
  }

  const namedEventHandlers: HandlerGroup = {};
  const genericEventHandlers: HandlerGroup = {};

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

  const lines: string[] = [];
  lines.push("export const RulesyncHooksPlugin = async ({ $ }) => {");
  lines.push("  return {");

  if (Object.keys(genericEventHandlers).length > 0) {
    lines.push("    event: async ({ event }) => {");
    let isFirst = true;
    for (const [eventName, handlers] of Object.entries(genericEventHandlers)) {
      lines.push(`      ${isFirst ? "if" : "else if"} (event.type === "${eventName}") {`);
      isFirst = false;
      for (const handler of handlers) {
        const escapedCommand = escapeForTemplateLiteral(handler.command);
        lines.push(`        await $\`${escapedCommand}\`;`);
      }
      lines.push("      }");
    }
    lines.push("    },");
  }

  for (const [eventName, handlers] of Object.entries(namedEventHandlers)) {
    lines.push(`    "${eventName}": async (input) => {`);
    for (const handler of handlers) {
      const escapedCommand = escapeForTemplateLiteral(handler.command);
      if (handler.matcher) {
        const safeMatcher = validateAndSanitizeMatcher(handler.matcher);
        lines.push(`      const __re = new RegExp("${safeMatcher}");`);
        lines.push(`      if (__re.test(input.tool)) {`);
        lines.push(`        await $\`${escapedCommand}\`;`);
        lines.push("      }");
      } else {
        lines.push(`      await $\`${escapedCommand}\`;`);
      }
    }
    lines.push("    },");
  }

  lines.push("  };");
  lines.push("};");
  lines.push("");

  return lines.join("\n");
}

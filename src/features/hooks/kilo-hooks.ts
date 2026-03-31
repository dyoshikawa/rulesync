import { join } from "node:path";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { HooksConfig } from "../../types/hooks.js";
import {
  CANONICAL_TO_KILO_EVENT_NAMES,
  CONTROL_CHARS,
  KILO_HOOK_EVENTS,
} from "../../types/hooks.js";
import { readFileContent } from "../../utils/file.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * Kilo event names that are top-level named hooks on the Hooks interface.
 * These receive `(input, output)` parameters with `input.tool` for matcher support.
 * All other events must be routed through the generic `event` handler.
 */
const NAMED_HOOKS = new Set(["tool.execute.before", "tool.execute.after"]);

/**
 * Escape a command string for embedding inside a JS tagged template literal (backticks).
 * Escapes backslashes, backticks, and `${` sequences.
 */
function escapeForTemplateLiteral(command: string): string {
  return command.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

/**
 * Validate and sanitize a matcher string for use in generated JS code.
 * - Strips newline, carriage-return, and NUL bytes (defense-in-depth:
 *   the Zod `safeString` schema rejects these at input validation time,
 *   but this function provides a runtime safety net for `validate: false` paths)
 * - Validates the result is a legal RegExp
 * - Escapes for embedding inside a JS double-quoted string (`new RegExp("...")`)
 */
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

type KiloHandler = {
  command: string;
  matcher?: string;
};

type KiloHandlerGroup = Record<string, KiloHandler[]>;

/**
 * Group canonical hook definitions by their Kilo event name.
 * Filters to command-type hooks and maps canonical events to Kilo events.
 */
function groupByKiloEvent(config: HooksConfig): {
  namedEventHandlers: KiloHandlerGroup;
  genericEventHandlers: KiloHandlerGroup;
} {
  const kiloSupported: Set<string> = new Set(KILO_HOOK_EVENTS);
  const configHooks = { ...config.hooks, ...config.kilo?.hooks };
  const effectiveHooks: HooksConfig["hooks"] = {};

  for (const [event, defs] of Object.entries(configHooks)) {
    if (kiloSupported.has(event)) {
      effectiveHooks[event] = defs;
    }
  }

  const namedEventHandlers: Record<string, KiloHandler[]> = {};
  const genericEventHandlers: Record<string, KiloHandler[]> = {};
  for (const [canonicalEvent, definitions] of Object.entries(effectiveHooks)) {
    const kiloEvent = CANONICAL_TO_KILO_EVENT_NAMES[canonicalEvent];
    if (!kiloEvent) continue;

    const handlers: KiloHandler[] = [];
    for (const def of definitions) {
      // Skip prompt-type hooks — unsupported
      if (def.type === "prompt") continue;
      if (!def.command) continue;
      handlers.push({
        command: def.command,
        matcher: def.matcher ? def.matcher : undefined,
      });
    }

    if (handlers.length > 0) {
      const grouped = NAMED_HOOKS.has(kiloEvent) ? namedEventHandlers : genericEventHandlers;
      const existing = grouped[kiloEvent];
      if (existing) {
        existing.push(...handlers);
      } else {
        grouped[kiloEvent] = handlers;
      }
    }
  }

  return { namedEventHandlers, genericEventHandlers };
}

/**
 * Generate the JavaScript plugin file content from canonical hooks config.
 *
 * Kilo plugins support two patterns:
 * 1. Named typed hooks (top-level keys like "tool.execute.before") — receive (input, output)
 * 2. Generic event handler — receives { event } and filters by event.type
 *
 * Named hooks are placed directly on the return object.
 * Generic events are consolidated into a single `event` handler.
 */
function generatePluginCode(config: HooksConfig): string {
  const { namedEventHandlers, genericEventHandlers } = groupByKiloEvent(config);

  const lines: string[] = [];
  lines.push("export const RulesyncHooksPlugin = async ({ $ }) => {");
  lines.push("  return {");

  // Generate the generic `event` handler if there are any generic events
  if (Object.keys(genericEventHandlers).length > 0) {
    lines.push("    event: async ({ event }) => {");
    for (const [eventName, handlers] of Object.entries(genericEventHandlers)) {
      lines.push(`      if (event.type === "${eventName}") {`);
      for (const handler of handlers) {
        const escapedCommand = escapeForTemplateLiteral(handler.command);
        lines.push(`        await $\`${escapedCommand}\``);
      }
      lines.push("      }");
    }
    lines.push("    },");
  }

  // Generate named typed hooks (tool hooks with matcher support)
  for (const [eventName, handlers] of Object.entries(namedEventHandlers)) {
    lines.push(`    "${eventName}": async (input) => {`);
    for (const handler of handlers) {
      const escapedCommand = escapeForTemplateLiteral(handler.command);
      if (handler.matcher) {
        const safeMatcher = validateAndSanitizeMatcher(handler.matcher);
        lines.push(`      if (new RegExp("${safeMatcher}").test(input.tool)) {`);
        lines.push(`        await $\`${escapedCommand}\``);
        lines.push("      }");
      } else {
        lines.push(`      await $\`${escapedCommand}\``);
      }
    }
    lines.push("    },");
  }

  lines.push("  }");
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}

export class KiloHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
    });
  }

  static getSettablePaths(options?: { global?: boolean }): ToolHooksSettablePaths {
    return {
      relativeDirPath: options?.global
        ? join(".config", "kilo", "plugins")
        : join(".kilo", "plugins"),
      relativeFilePath: "rulesync-hooks.js",
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<KiloHooks> {
    const paths = KiloHooks.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(baseDir, paths.relativeDirPath, paths.relativeFilePath),
    );
    return new KiloHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static fromRulesyncHooks({
    baseDir = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false,
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): KiloHooks {
    const config = rulesyncHooks.getJson();
    const fileContent = generatePluginCode(config);
    const paths = KiloHooks.getSettablePaths({ global });
    return new KiloHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    throw new Error("Not implemented because Kilo hooks are generated as a plugin file.");
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): KiloHooks {
    return new KiloHooks({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}

import { join } from "node:path";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { HooksConfig } from "../../types/hooks.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";

import { CURSOR_TO_OPENCODE_EVENT_NAMES, OPENCODE_HOOK_EVENTS } from "../../types/hooks.js";
import { readFileContent } from "../../utils/file.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * OpenCode event names that are top-level named hooks on the Hooks interface.
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
 * Validate and sanitize a matcher string for use in a generated JS regex literal.
 * - Strips newline, carriage-return, and NUL bytes
 * - Validates the result is a legal RegExp
 * - Escapes forward slashes for embedding in `/.../`
 */
function validateAndSanitizeMatcher(matcher: string): string {
  const sanitized = matcher
    .split("")
    .filter((c) => c !== "\n" && c !== "\r" && c !== "\0")
    .join("");
  try {
    new RegExp(sanitized);
  } catch {
    throw new Error(`Invalid regex pattern in hook matcher: ${sanitized}`);
  }
  return sanitized.replace(/\//g, "\\/");
}

type OpencodeHandler = {
  command: string;
  matcher?: string;
};

type OpencodeHandlerGroup = Record<string, OpencodeHandler[]>;

/**
 * Group canonical hook definitions by their OpenCode event name.
 * Filters to command-type hooks and maps canonical events to OpenCode events.
 */
function groupByOpencodeEvent(config: HooksConfig): {
  namedEventHandlers: OpencodeHandlerGroup;
  genericEventHandlers: OpencodeHandlerGroup;
} {
  const opencodeSupported: Set<string> = new Set(OPENCODE_HOOK_EVENTS);
  const configHooks = { ...config.hooks, ...config.opencode?.hooks };
  const effectiveHooks: HooksConfig["hooks"] = {};

  for (const [event, defs] of Object.entries(configHooks)) {
    if (opencodeSupported.has(event)) {
      effectiveHooks[event] = defs;
    }
  }

  const namedEventHandlers: Record<string, OpencodeHandler[]> = {};
  const genericEventHandlers: Record<string, OpencodeHandler[]> = {};
  for (const [canonicalEvent, definitions] of Object.entries(effectiveHooks)) {
    const opencodeEvent = CURSOR_TO_OPENCODE_EVENT_NAMES[canonicalEvent];
    if (!opencodeEvent) continue;

    const handlers: OpencodeHandler[] = [];
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
      const grouped = NAMED_HOOKS.has(opencodeEvent) ? namedEventHandlers : genericEventHandlers;
      const existing = grouped[opencodeEvent];
      if (existing) {
        existing.push(...handlers);
      } else {
        grouped[opencodeEvent] = handlers;
      }
    }
  }

  return { namedEventHandlers, genericEventHandlers };
}

/**
 * Generate the JavaScript plugin file content from canonical hooks config.
 *
 * OpenCode plugins support two patterns:
 * 1. Named typed hooks (top-level keys like "tool.execute.before") — receive (input, output)
 * 2. Generic event handler — receives { event } and filters by event.type
 *
 * Named hooks are placed directly on the return object.
 * Generic events are consolidated into a single `event` handler.
 */
function generatePluginCode(config: HooksConfig): string {
  const { namedEventHandlers, genericEventHandlers } = groupByOpencodeEvent(config);

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
        lines.push(`      if (/${safeMatcher}/.test(input.tool)) {`);
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

export class OpencodeHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
    });
  }

  static getSettablePaths(options?: { global?: boolean }): ToolHooksSettablePaths {
    return {
      relativeDirPath: options?.global
        ? join(".config", "opencode", "plugins")
        : join(".opencode", "plugins"),
      relativeFilePath: "rulesync-hooks.js",
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<OpencodeHooks> {
    const paths = OpencodeHooks.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(baseDir, paths.relativeDirPath, paths.relativeFilePath),
    );
    return new OpencodeHooks({
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
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): OpencodeHooks {
    const config = rulesyncHooks.getJson();
    const fileContent = generatePluginCode(config);
    const paths = OpencodeHooks.getSettablePaths({ global });
    return new OpencodeHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    throw new Error("Not implemented because OpenCode hooks are generated as a plugin file.");
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): OpencodeHooks {
    return new OpencodeHooks({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}

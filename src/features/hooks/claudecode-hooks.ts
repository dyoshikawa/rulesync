import { join } from "node:path";

import type { AiFileParams } from "../../types/ai-file.js";
import type { ValidationResult } from "../../types/ai-file.js";
import type { HooksConfig } from "../../types/hooks.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";

import {
  CLAUDE_HOOK_EVENTS,
  CLAUDE_TO_CURSOR_EVENT_NAMES,
  CURSOR_TO_CLAUDE_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readOrInitializeFileContent } from "../../utils/file.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * Convert canonical (Cursor-style) hooks config to Claude format.
 * Filters shared hooks to CLAUDE_HOOK_EVENTS, merges config.claudecode?.hooks,
 * then converts to PascalCase and Claude matcher/hooks structure.
 */
function canonicalToClaudeHooks(config: HooksConfig): Record<string, unknown[]> {
  const claudeSupported: Set<string> = new Set(CLAUDE_HOOK_EVENTS);
  const sharedHooks: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (claudeSupported.has(event)) {
      sharedHooks[event] = defs;
    }
  }
  const effectiveHooks: HooksConfig["hooks"] = {
    ...sharedHooks,
    ...config.claudecode?.hooks,
  };
  const claude: Record<string, unknown[]> = {};
  for (const [eventName, definitions] of Object.entries(effectiveHooks)) {
    const claudeEventName = CURSOR_TO_CLAUDE_EVENT_NAMES[eventName] ?? eventName;
    const byMatcher = new Map<string, HooksConfig["hooks"][string]>();
    for (const def of definitions) {
      const key = def.matcher ?? "";
      const list = byMatcher.get(key);
      if (list) list.push(def);
      else byMatcher.set(key, [def]);
    }
    const entries: unknown[] = [];
    for (const [matcherKey, defs] of byMatcher) {
      const hooks = defs.map((def) => {
        const command =
          def.command !== undefined && def.command !== null && !def.command.startsWith("$")
            ? `$CLAUDE_PROJECT_DIR/${def.command.replace(/^\.\//, "")}`
            : def.command;
        return {
          type: def.type ?? "command",
          ...(command !== undefined && command !== null && { command }),
          ...(def.timeout !== undefined && def.timeout !== null && { timeout: def.timeout }),
          ...(def.prompt !== undefined && def.prompt !== null && { prompt: def.prompt }),
        };
      });
      entries.push(matcherKey ? { matcher: matcherKey, hooks } : { hooks });
    }
    claude[claudeEventName] = entries;
  }
  return claude;
}

/**
 * Extract hooks from Claude settings.json into canonical format.
 */
type ClaudeMatcherEntry = {
  matcher?: string;
  hooks?: Array<Record<string, unknown>>;
};

function isClaudeMatcherEntry(x: unknown): x is ClaudeMatcherEntry {
  if (x === null || typeof x !== "object") {
    return false;
  }
  // Validate optional 'matcher' property: must be string if present
  if ("matcher" in x && typeof x.matcher !== "string") {
    return false;
  }
  // Validate optional 'hooks' property: must be array if present
  if ("hooks" in x && !Array.isArray(x.hooks)) {
    return false;
  }
  return true;
}

function claudeHooksToCanonical(claudeHooks: unknown): HooksConfig["hooks"] {
  if (claudeHooks === null || claudeHooks === undefined || typeof claudeHooks !== "object") {
    return {};
  }
  const canonical: HooksConfig["hooks"] = {};
  for (const [claudeEventName, matcherEntries] of Object.entries(claudeHooks)) {
    const eventName = CLAUDE_TO_CURSOR_EVENT_NAMES[claudeEventName] ?? claudeEventName;
    if (!Array.isArray(matcherEntries)) continue;
    const defs: HooksConfig["hooks"][string] = [];
    for (const rawEntry of matcherEntries) {
      if (!isClaudeMatcherEntry(rawEntry)) continue;
      const entry = rawEntry;
      const hooks = entry.hooks ?? [];
      for (const h of hooks) {
        const cmd = typeof h.command === "string" ? h.command : undefined;
        const command =
          typeof cmd === "string" && cmd.includes("$CLAUDE_PROJECT_DIR/")
            ? cmd.replace(/^\$CLAUDE_PROJECT_DIR\/?/, "./")
            : cmd;
        const hookType = h.type === "command" || h.type === "prompt" ? h.type : "command";
        const timeout = typeof h.timeout === "number" ? h.timeout : undefined;
        const prompt = typeof h.prompt === "string" ? h.prompt : undefined;
        defs.push({
          type: hookType,
          ...(command !== undefined && command !== null && { command }),
          ...(timeout !== undefined && timeout !== null && { timeout }),
          ...(prompt !== undefined && prompt !== null && { prompt }),
          ...(entry.matcher !== undefined &&
            entry.matcher !== null &&
            entry.matcher !== "" && { matcher: entry.matcher }),
        });
      }
    }
    if (defs.length > 0) {
      canonical[eventName] = defs;
    }
  }
  return canonical;
}

export class ClaudecodeHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    // Currently, both global and project mode use the same paths.
    // The parameter is kept for consistency with other ToolHooks implementations.
    return { relativeDirPath: ".claude", relativeFilePath: "settings.json" };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<ClaudecodeHooks> {
    const paths = ClaudecodeHooks.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = await readOrInitializeFileContent(
      filePath,
      JSON.stringify({ hooks: {} }, null, 2),
    );
    return new ClaudecodeHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static async fromRulesyncHooks({
    baseDir = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false,
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): Promise<ClaudecodeHooks> {
    const paths = ClaudecodeHooks.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = await readOrInitializeFileContent(
      filePath,
      JSON.stringify({}, null, 2),
    );
    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Claude settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const config = rulesyncHooks.getJson();
    const claudeHooks = canonicalToClaudeHooks(config);
    const merged = { ...settings, hooks: claudeHooks };
    const fileContent = JSON.stringify(merged, null, 2);
    return new ClaudecodeHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    let settings: { hooks?: unknown };
    try {
      settings = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(`Failed to parse Claude hooks content: ${formatError(error)}`, {
        cause: error,
      });
    }
    const hooks = claudeHooksToCanonical(settings.hooks);
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify({ version: 1, hooks }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): ClaudecodeHooks {
    return new ClaudecodeHooks({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}

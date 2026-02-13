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
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * Convert canonical (Cursor-style) hooks config to Factory Droid format.
 * Factory Droid uses the same PascalCase event names and matcher/hooks
 * structure as Claude Code, but with $FACTORY_PROJECT_DIR instead of
 * $CLAUDE_PROJECT_DIR.
 */
function canonicalToFactorydroidHooks(config: HooksConfig): Record<string, unknown[]> {
  const supported: Set<string> = new Set(CLAUDE_HOOK_EVENTS);
  const sharedHooks: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (supported.has(event)) {
      sharedHooks[event] = defs;
    }
  }
  const effectiveHooks: HooksConfig["hooks"] = {
    ...sharedHooks,
    ...config.claudecode?.hooks,
  };
  const result: Record<string, unknown[]> = {};
  for (const [eventName, definitions] of Object.entries(effectiveHooks)) {
    const pascalEventName = CURSOR_TO_CLAUDE_EVENT_NAMES[eventName] ?? eventName;
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
            ? `$FACTORY_PROJECT_DIR/${def.command.replace(/^\.\//, "")}`
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
    result[pascalEventName] = entries;
  }
  return result;
}

type FactorydroidMatcherEntry = {
  matcher?: string;
  hooks?: Array<Record<string, unknown>>;
};

function isFactorydroidMatcherEntry(x: unknown): x is FactorydroidMatcherEntry {
  if (x === null || typeof x !== "object") {
    return false;
  }
  if ("matcher" in x && typeof x.matcher !== "string") {
    return false;
  }
  if ("hooks" in x && !Array.isArray(x.hooks)) {
    return false;
  }
  return true;
}

function factorydroidHooksToCanonical(hooks: unknown): HooksConfig["hooks"] {
  if (hooks === null || hooks === undefined || typeof hooks !== "object") {
    return {};
  }
  const canonical: HooksConfig["hooks"] = {};
  for (const [pascalEventName, matcherEntries] of Object.entries(hooks)) {
    const eventName = CLAUDE_TO_CURSOR_EVENT_NAMES[pascalEventName] ?? pascalEventName;
    if (!Array.isArray(matcherEntries)) continue;
    const defs: HooksConfig["hooks"][string] = [];
    for (const rawEntry of matcherEntries) {
      if (!isFactorydroidMatcherEntry(rawEntry)) continue;
      const entry = rawEntry;
      const hookDefs = entry.hooks ?? [];
      for (const h of hookDefs) {
        const cmd = typeof h.command === "string" ? h.command : undefined;
        const command =
          typeof cmd === "string" && cmd.includes("$FACTORY_PROJECT_DIR/")
            ? cmd.replace(/^\$FACTORY_PROJECT_DIR\/?/, "./")
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

export class FactorydroidHooks extends ToolHooks {
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
    return { relativeDirPath: ".factory", relativeFilePath: "settings.json" };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<FactorydroidHooks> {
    const paths = FactorydroidHooks.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new FactorydroidHooks({
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
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): Promise<FactorydroidHooks> {
    const paths = FactorydroidHooks.getSettablePaths({ global });
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
        `Failed to parse existing Factory Droid settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const config = rulesyncHooks.getJson();
    const factorydroidHooks = canonicalToFactorydroidHooks(config);
    const merged = { ...settings, hooks: factorydroidHooks };
    const fileContent = JSON.stringify(merged, null, 2);
    return new FactorydroidHooks({
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
      throw new Error(
        `Failed to parse Factory Droid hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    const hooks = factorydroidHooksToCanonical(settings.hooks);
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
  }: ToolHooksForDeletionParams): FactorydroidHooks {
    return new FactorydroidHooks({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}

import { join } from "node:path";

import { z } from "zod/mini";

import type { AiFileParams } from "../../types/ai-file.js";
import type { ValidationResult } from "../../types/ai-file.js";
import type { HooksConfig } from "../../types/hooks.js";
import {
  GEMINICLI_HOOK_EVENTS,
  GEMINICLI_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_GEMINICLI_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * Convert canonical hooks config to Gemini CLI format.
 * Filters shared hooks to GEMINICLI_HOOK_EVENTS, merges config.geminicli?.hooks,
 * then converts to PascalCase and Gemini CLI matcher/hooks structure.
 */
function canonicalToGeminicliHooks(config: HooksConfig): Record<string, unknown[]> {
  const geminiSupported: Set<string> = new Set(GEMINICLI_HOOK_EVENTS);
  const sharedHooks: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (geminiSupported.has(event)) {
      sharedHooks[event] = defs;
    }
  }
  const effectiveHooks: HooksConfig["hooks"] = {
    ...sharedHooks,
    ...config.geminicli?.hooks,
  };
  const gemini: Record<string, unknown[]> = {};
  for (const [eventName, definitions] of Object.entries(effectiveHooks)) {
    const geminiEventName = CANONICAL_TO_GEMINICLI_EVENT_NAMES[eventName] ?? eventName;
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
        const commandText = def.command;
        const trimmedCommand =
          typeof commandText === "string" ? commandText.trimStart() : undefined;
        const shouldPrefix =
          typeof trimmedCommand === "string" &&
          !trimmedCommand.startsWith("$") &&
          trimmedCommand.startsWith(".");

        const command =
          shouldPrefix && typeof trimmedCommand === "string"
            ? `$GEMINI_PROJECT_DIR/${trimmedCommand.replace(/^\.\//, "")}`
            : def.command;
        return {
          type: def.type ?? "command",
          ...(command !== undefined && command !== null && { command }),
          ...(def.timeout !== undefined && def.timeout !== null && { timeout: def.timeout }),
          ...(def.name !== undefined && def.name !== null && { name: def.name }),
          ...(def.description !== undefined &&
            def.description !== null && { description: def.description }),
        };
      });
      entries.push(matcherKey ? { matcher: matcherKey, hooks } : { hooks });
    }
    gemini[geminiEventName] = entries;
  }
  return gemini;
}

/**
 * Gemini CLI hook entry as stored in each matcher group's `hooks` array.
 * Uses `z.looseObject` so that unknown fields added by future Gemini CLI
 * versions are accepted and silently ignored during import.
 */
const GeminiHookEntrySchema = z.looseObject({
  type: z.optional(z.string()),
  command: z.optional(z.string()),
  timeout: z.optional(z.number()),
  name: z.optional(z.string()),
  description: z.optional(z.string()),
});

/**
 * A matcher group entry in a Gemini CLI event array.
 * Each event maps to an array of these groups.
 */
const GeminiMatcherEntrySchema = z.looseObject({
  matcher: z.optional(z.string()),
  hooks: z.optional(z.array(GeminiHookEntrySchema)),
});

/**
 * Extract hooks from Gemini CLI settings.json into canonical format.
 */
function geminiHooksToCanonical(geminiHooks: unknown): HooksConfig["hooks"] {
  if (geminiHooks === null || geminiHooks === undefined || typeof geminiHooks !== "object") {
    return {};
  }
  const canonical: HooksConfig["hooks"] = {};
  for (const [geminiEventName, matcherEntries] of Object.entries(geminiHooks)) {
    const eventName = GEMINICLI_TO_CANONICAL_EVENT_NAMES[geminiEventName] ?? geminiEventName;
    if (!Array.isArray(matcherEntries)) continue;
    const defs: HooksConfig["hooks"][string] = [];
    for (const rawEntry of matcherEntries) {
      const parseResult = GeminiMatcherEntrySchema.safeParse(rawEntry);
      if (!parseResult.success) continue;
      const entry = parseResult.data;
      const hooks = entry.hooks ?? [];
      for (const h of hooks) {
        const cmd = h.command;
        const command =
          typeof cmd === "string" && cmd.startsWith("$GEMINI_PROJECT_DIR/")
            ? cmd.replace(/^\$GEMINI_PROJECT_DIR\/?/, "./")
            : cmd;
        const hookType = h.type === "command" || h.type === "prompt" ? h.type : "command";
        defs.push({
          type: hookType,
          ...(command !== undefined && command !== null && { command }),
          ...(h.timeout !== undefined && h.timeout !== null && { timeout: h.timeout }),
          ...(h.name !== undefined && h.name !== null && { name: h.name }),
          ...(h.description !== undefined &&
            h.description !== null && { description: h.description }),
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

export class GeminicliHooks extends ToolHooks {
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
    return { relativeDirPath: ".gemini", relativeFilePath: "settings.json" };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<GeminicliHooks> {
    const paths = GeminicliHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new GeminicliHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static async fromRulesyncHooks({
    outputRoot = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false,
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): Promise<GeminicliHooks> {
    const paths = GeminicliHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = await readOrInitializeFileContent(
      filePath,
      JSON.stringify({}, null, 2),
    );
    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Gemini CLI settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const config = rulesyncHooks.getJson();
    const geminiHooks = canonicalToGeminicliHooks(config);
    const merged = { ...settings, hooks: geminiHooks };
    const fileContent = JSON.stringify(merged, null, 2);
    return new GeminicliHooks({
      outputRoot,
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
        `Failed to parse Gemini CLI hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    const hooks = geminiHooksToCanonical(settings.hooks);
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify({ version: 1, hooks }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): GeminicliHooks {
    return new GeminicliHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}

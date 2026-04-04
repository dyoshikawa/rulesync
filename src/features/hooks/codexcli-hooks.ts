import { join } from "node:path";

import * as smolToml from "smol-toml";
import { z } from "zod/mini";

import type { AiFileParams } from "../../types/ai-file.js";
import type { ValidationResult } from "../../types/ai-file.js";
import type { HooksConfig } from "../../types/hooks.js";
import {
  CODEXCLI_HOOK_EVENTS,
  CODEXCLI_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_CODEXCLI_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import {
  readFileContentOrNull,
  readOrInitializeFileContent,
  writeFileContent,
  ensureDir,
} from "../../utils/file.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * Convert canonical hooks config to Codex CLI format.
 * Filters shared hooks to CODEXCLI_HOOK_EVENTS, merges config.codexcli?.hooks,
 * then converts to PascalCase and Codex CLI matcher/hooks structure.
 * Unlike Claude Code or Gemini CLI, Codex CLI has no project directory variable,
 * so commands are passed through as-is.
 */
function canonicalToCodexcliHooks(config: HooksConfig): Record<string, unknown[]> {
  const codexSupported: Set<string> = new Set(CODEXCLI_HOOK_EVENTS);
  const sharedHooks: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (codexSupported.has(event)) {
      sharedHooks[event] = defs;
    }
  }
  const effectiveHooks: HooksConfig["hooks"] = {
    ...sharedHooks,
    ...config.codexcli?.hooks,
  };
  const codex: Record<string, unknown[]> = {};
  for (const [eventName, definitions] of Object.entries(effectiveHooks)) {
    const codexEventName = CANONICAL_TO_CODEXCLI_EVENT_NAMES[eventName] ?? eventName;
    const byMatcher = new Map<string, HooksConfig["hooks"][string]>();
    for (const def of definitions) {
      const key = def.matcher ?? "";
      const list = byMatcher.get(key);
      if (list) list.push(def);
      else byMatcher.set(key, [def]);
    }
    const entries: unknown[] = [];
    for (const [matcherKey, defs] of byMatcher) {
      const hooks = defs.map((def) => ({
        type: def.type ?? "command",
        ...(def.command !== undefined && def.command !== null && { command: def.command }),
        ...(def.timeout !== undefined && def.timeout !== null && { timeout: def.timeout }),
      }));
      entries.push(matcherKey ? { matcher: matcherKey, hooks } : { hooks });
    }
    codex[codexEventName] = entries;
  }
  return codex;
}

/**
 * Codex CLI hook entry as stored in each matcher group's `hooks` array.
 * Uses `z.looseObject` so that unknown fields added by future Codex CLI
 * versions are accepted and silently ignored during import.
 */
const CodexHookEntrySchema = z.looseObject({
  type: z.optional(z.string()),
  command: z.optional(z.string()),
  timeout: z.optional(z.number()),
});

/**
 * A matcher group entry in a Codex CLI event array.
 * Each event maps to an array of these groups.
 */
const CodexMatcherEntrySchema = z.looseObject({
  matcher: z.optional(z.string()),
  hooks: z.optional(z.array(CodexHookEntrySchema)),
});

/**
 * Extract hooks from Codex CLI hooks.json into canonical format.
 */
function codexcliHooksToCanonical(codexHooks: unknown): HooksConfig["hooks"] {
  if (codexHooks === null || codexHooks === undefined || typeof codexHooks !== "object") {
    return {};
  }
  const canonical: HooksConfig["hooks"] = {};
  for (const [codexEventName, matcherEntries] of Object.entries(codexHooks)) {
    const eventName = CODEXCLI_TO_CANONICAL_EVENT_NAMES[codexEventName] ?? codexEventName;
    if (!Array.isArray(matcherEntries)) continue;
    const defs: HooksConfig["hooks"][string] = [];
    for (const rawEntry of matcherEntries) {
      const parseResult = CodexMatcherEntrySchema.safeParse(rawEntry);
      if (!parseResult.success) continue;
      const entry = parseResult.data;
      const hooks = entry.hooks ?? [];
      for (const h of hooks) {
        const hookType = h.type === "command" || h.type === "prompt" ? h.type : "command";
        defs.push({
          type: hookType,
          ...(h.command !== undefined && h.command !== null && { command: h.command }),
          ...(h.timeout !== undefined && h.timeout !== null && { timeout: h.timeout }),
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

/**
 * Ensure the `[features] codex_hooks = true` flag is set in .codex/config.toml.
 * Reads the existing file (or creates it), parses TOML, sets the flag, and writes back.
 * Preserves all other config sections (e.g. mcp_servers).
 */
async function ensureCodexHooksFeatureFlag({ baseDir }: { baseDir: string }): Promise<void> {
  const configDir = join(baseDir, ".codex");
  const configPath = join(configDir, "config.toml");
  await ensureDir(configDir);
  const existingContent = await readOrInitializeFileContent(configPath, smolToml.stringify({}));
  const configToml = smolToml.parse(existingContent);

  if (typeof configToml.features !== "object" || configToml.features === null) {
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    configToml.features = {} as smolToml.TomlTable;
  }
  // eslint-disable-next-line no-type-assertion/no-type-assertion
  (configToml.features as smolToml.TomlTable).codex_hooks = true;

  await writeFileContent(configPath, smolToml.stringify(configToml));
}

export class CodexcliHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    return { relativeDirPath: ".codex", relativeFilePath: "hooks.json" };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<CodexcliHooks> {
    const paths = CodexcliHooks.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new CodexcliHooks({
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
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): Promise<CodexcliHooks> {
    const paths = CodexcliHooks.getSettablePaths({ global });
    const config = rulesyncHooks.getJson();
    const codexHooks = canonicalToCodexcliHooks(config);
    const fileContent = JSON.stringify({ hooks: codexHooks }, null, 2);

    // Side effect: ensure feature flag in config.toml
    await ensureCodexHooksFeatureFlag({ baseDir });

    return new CodexcliHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    let parsed: { hooks?: unknown };
    try {
      parsed = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Codex CLI hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    const hooks = codexcliHooksToCanonical(parsed.hooks);
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
  }: ToolHooksForDeletionParams): CodexcliHooks {
    return new CodexcliHooks({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}

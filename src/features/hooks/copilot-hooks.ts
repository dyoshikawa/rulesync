import { join } from "node:path";

import { z } from "zod/mini";

import type { AiFileParams } from "../../types/ai-file.js";
import type { ValidationResult } from "../../types/ai-file.js";
import type { HooksConfig } from "../../types/hooks.js";
import {
  COPILOT_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_COPILOT_EVENT_NAMES,
  COPILOT_HOOK_EVENTS,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * Copilot hook entry as stored in .github/hooks/copilot-hooks.json.
 *
 * On Windows, commands are emitted under `powershell`; on other platforms, under `bash`.
 */
const CopilotHookEntrySchema = z.looseObject({
  type: z.string(),
  bash: z.optional(z.string()),
  powershell: z.optional(z.string()),
  timeoutSec: z.optional(z.number()),
});

type CopilotHookEntry = z.infer<typeof CopilotHookEntrySchema>;

/**
 * Convert canonical hooks config to Copilot format.
 * Filters shared hooks to COPILOT_HOOK_EVENTS, merges config.copilot?.hooks,
 * then converts to Copilot event names and field format.
 *
 * On Windows the command is emitted under the `powershell` key;
 * on all other platforms it is emitted under `bash`.
 */
function canonicalToCopilotHooks(config: HooksConfig): Record<string, CopilotHookEntry[]> {
  const isWindows = process.platform === "win32";
  const commandField = isWindows ? "powershell" : "bash";
  const supported: Set<string> = new Set(COPILOT_HOOK_EVENTS);
  const sharedConfigHooks: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (supported.has(event)) {
      sharedConfigHooks[event] = defs;
    }
  }
  const effectiveHooks: HooksConfig["hooks"] = {
    ...sharedConfigHooks,
    ...config.copilot?.hooks,
  };
  const copilot: Record<string, CopilotHookEntry[]> = {};
  for (const [eventName, definitions] of Object.entries(effectiveHooks)) {
    const copilotEventName = CANONICAL_TO_COPILOT_EVENT_NAMES[eventName] ?? eventName;
    const entries: CopilotHookEntry[] = [];
    for (const def of definitions) {
      const hookType = def.type ?? "command";

      // Not supported
      if (def.matcher) continue;
      if (hookType !== "command") continue;

      const command = def.command;
      const timeout = def.timeout;

      const rest = Object.fromEntries(
        Object.entries(def).filter(
          ([k]) => !["type", "matcher", "command", "prompt", "timeout"].includes(k),
        ),
      );

      entries.push({
        type: hookType,
        ...(command !== undefined && command !== null && { [commandField]: command }),
        ...(timeout !== undefined && timeout !== null && { timeoutSec: timeout }),
        ...rest,
      });
    }

    if (entries.length > 0) {
      copilot[copilotEventName] = entries;
    }
  }
  return copilot;
}

/**
 * Resolve the command string from a Copilot hook entry.
 *
 * - If only `bash` is present, use it.
 * - If only `powershell` is present, use it.
 * - If both are present, use `powershell` on Windows, `bash` otherwise,
 *   and log a warning that the other value was ignored.
 */
function resolveImportCommand(entry: CopilotHookEntry): string | undefined {
  const hasBash = typeof entry.bash === "string";
  const hasPowershell = typeof entry.powershell === "string";
  if (hasBash && hasPowershell) {
    const isWindows = process.platform === "win32";
    const chosen = isWindows ? "powershell" : "bash";
    const ignored = isWindows ? "bash" : "powershell";
    logger.warn(
      `Copilot hook has both bash and powershell commands; using ${chosen} and ignoring ${ignored} on this platform.`,
    );
    return isWindows ? entry.powershell : entry.bash;
  } else if (hasBash) {
    return entry.bash;
  } else if (hasPowershell) {
    return entry.powershell;
  }
  return undefined;
}

/**
 * Extract hooks from Copilot hooks JSON into canonical format.
 * Copilot format: { version: 1, hooks: { eventName: [...hookEntries] } }
 */
function copilotHooksToCanonical(copilotHooks: unknown): HooksConfig["hooks"] {
  if (copilotHooks === null || copilotHooks === undefined || typeof copilotHooks !== "object") {
    return {};
  }

  const canonical: HooksConfig["hooks"] = {};
  for (const [copilotEventName, hookEntries] of Object.entries(copilotHooks)) {
    const eventName = COPILOT_TO_CANONICAL_EVENT_NAMES[copilotEventName] ?? copilotEventName;
    if (!Array.isArray(hookEntries)) continue;
    const defs: HooksConfig["hooks"][string] = [];
    for (const rawEntry of hookEntries) {
      const parseResult = CopilotHookEntrySchema.safeParse(rawEntry);
      if (!parseResult.success) continue;
      const entry = parseResult.data;
      const command = resolveImportCommand(entry);
      const timeout = entry.timeoutSec;
      defs.push({
        type: "command",
        ...(command !== undefined && { command }),
        ...(timeout !== undefined && { timeout }),
      });
    }
    if (defs.length > 0) {
      canonical[eventName] = defs;
    }
  }
  return canonical;
}

export class CopilotHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    return {
      relativeDirPath: join(".github", "hooks"),
      relativeFilePath: "copilot-hooks.json",
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<CopilotHooks> {
    const paths = CopilotHooks.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new CopilotHooks({
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
  }: ToolHooksFromRulesyncHooksParams & {
    global?: boolean;
  }): Promise<CopilotHooks> {
    const paths = CopilotHooks.getSettablePaths();
    const config = rulesyncHooks.getJson();
    const copilotHooks = canonicalToCopilotHooks(config);
    const fileContent = JSON.stringify({ version: 1, hooks: copilotHooks }, null, 2);
    return new CopilotHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    let parsed: { version?: number; hooks?: unknown };
    try {
      parsed = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Copilot hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    const hooks = copilotHooksToCanonical(parsed.hooks);
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
  }: ToolHooksForDeletionParams): CopilotHooks {
    return new CopilotHooks({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}

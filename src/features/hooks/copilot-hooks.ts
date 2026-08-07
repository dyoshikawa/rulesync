import { join } from "node:path";

import { z } from "zod/mini";

import {
  COPILOT_GLOBAL_HOOKS_DIR_PATH,
  COPILOT_GLOBAL_HOOKS_FILE_NAME,
  COPILOT_HOOKS_DIR_PATH,
  COPILOT_HOOKS_FILE_NAME,
} from "../../constants/copilot-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
import type { ValidationResult } from "../../types/ai-file.js";
import type { HooksConfig } from "../../types/hooks.js";
import {
  COPILOT_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_COPILOT_EVENT_NAMES,
  COPILOT_HOOK_EVENTS,
  HookDefinitionSchema,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import { buildImportedHooksConfig } from "./tool-hooks-converter.js";
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
 * The canonical `shell` selector chooses `bash` or `powershell`; without it the
 * portable `command` field is written, which upstream copies to both when
 * neither is present. Note the cloud agent runs hooks in a Linux sandbox and
 * honors only `bash` and `command` — a `powershell` entry is ignored there.
 *
 * @see https://docs.github.com/en/copilot/reference/hooks-reference
 */
const CopilotHookEntrySchema = z.looseObject({
  type: z.string(),
  bash: z.optional(z.string()),
  powershell: z.optional(z.string()),
  command: z.optional(z.string()),
  env: z.optional(z.record(z.string(), z.string())),
  timeoutSec: z.optional(z.number()),
});

type CopilotHookEntry = z.infer<typeof CopilotHookEntrySchema>;

/**
 * Convert canonical hooks config to Copilot format.
 * Filters shared hooks to COPILOT_HOOK_EVENTS, merges config.copilot?.hooks,
 * then converts to Copilot event names and field format.
 *
 * The command field is chosen by the canonical `shell` selector, falling back to
 * the portable `command` field — never by the platform Rulesync happens to run
 * on. `.github/hooks/copilot-hooks.json` is committed to the repository, so
 * keying it off `process.platform` made the artifact differ per generating
 * machine, and a file generated on Windows carried only `powershell`, which the
 * Linux-sandboxed cloud agent ignores outright.
 */
function canonicalToCopilotHooks(config: HooksConfig): Record<string, CopilotHookEntry[]> {
  const canonicalSchemaKeys = Object.keys(HookDefinitionSchema.shape);
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
      const commandField = def.shell ?? "command";

      const rest = Object.fromEntries(
        Object.entries(def).filter(([k]) => !canonicalSchemaKeys.includes(k)),
      );

      entries.push({
        type: hookType,
        ...(command !== undefined && command !== null && { [commandField]: command }),
        // `env` is a canonical field Copilot supports natively on command
        // hooks. It is filtered out of `rest` as a canonical key, so without
        // this an authored `env` never reached the generated file.
        ...(def.env !== undefined && { env: def.env }),
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
 * Resolve the command and its shell selector from a Copilot hook entry.
 *
 * - If only one shell-specific field is present, use it and record the shell,
 *   so a re-export writes the same field back.
 * - If both are present, take `bash` and warn. The choice is deliberately not
 *   platform-dependent: the cloud agent runs hooks in a Linux sandbox and
 *   ignores `powershell` entirely, and importing on Windows must not produce a
 *   different canonical config than importing the same file on Linux.
 * - Otherwise fall back to the portable `command` field, leaving `shell` unset
 *   so a re-export renders the portable field again.
 */
function resolveImportCommand(
  entry: CopilotHookEntry,
  logger?: Logger,
): { command?: string; shell?: "bash" | "powershell" } {
  const hasBash = typeof entry.bash === "string";
  const hasPowershell = typeof entry.powershell === "string";
  if (hasBash && hasPowershell) {
    logger?.warn(
      "Copilot hook has both bash and powershell commands; using bash and ignoring powershell, which the Linux-sandboxed cloud agent does not run.",
    );
    return { command: entry.bash, shell: "bash" };
  } else if (hasBash) {
    return { command: entry.bash, shell: "bash" };
  } else if (hasPowershell) {
    return { command: entry.powershell, shell: "powershell" };
  }
  return typeof entry.command === "string" ? { command: entry.command } : {};
}

/**
 * Extract hooks from Copilot hooks JSON into canonical format.
 * Copilot format: { version: 1, hooks: { eventName: [...hookEntries] } }
 */
function copilotHooksToCanonical(copilotHooks: unknown, logger?: Logger): HooksConfig["hooks"] {
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
      const { command, shell } = resolveImportCommand(entry, logger);
      const timeout = entry.timeoutSec;

      defs.push({
        type: "command",
        ...(command !== undefined && { command }),
        ...(shell !== undefined && { shell }),
        ...(entry.env !== undefined && { env: entry.env }),
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

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolHooksSettablePaths {
    if (global) {
      return {
        relativeDirPath: COPILOT_GLOBAL_HOOKS_DIR_PATH,
        relativeFilePath: COPILOT_GLOBAL_HOOKS_FILE_NAME,
      };
    }
    return {
      relativeDirPath: COPILOT_HOOKS_DIR_PATH,
      relativeFilePath: COPILOT_HOOKS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<CopilotHooks> {
    const paths = CopilotHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new CopilotHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  static async fromRulesyncHooks({
    outputRoot = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false,
  }: ToolHooksFromRulesyncHooksParams & {
    global?: boolean;
  }): Promise<CopilotHooks> {
    const paths = CopilotHooks.getSettablePaths({ global });
    const config = rulesyncHooks.getJson();
    const copilotHooks = canonicalToCopilotHooks(config);
    const fileContent = JSON.stringify({ version: 1, hooks: copilotHooks }, null, 2);
    return new CopilotHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  toRulesyncHooks(options?: { logger?: Logger }): RulesyncHooks {
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
    const hooks = copilotHooksToCanonical(parsed.hooks, options?.logger);
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "copilot" }),
        null,
        2,
      ),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): CopilotHooks {
    return new CopilotHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}

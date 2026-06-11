import { join } from "node:path";

import { z } from "zod/mini";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { HooksConfig } from "../../types/hooks.js";
import {
  CANONICAL_TO_COPILOTCLI_EVENT_NAMES,
  COPILOTCLI_HOOK_EVENTS,
  COPILOTCLI_TO_CANONICAL_EVENT_NAMES,
  HookDefinitionSchema,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * GitHub Copilot CLI hooks.
 *
 * Reference: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks
 *
 * The Copilot CLI documents a wider event surface than the shared cloud-agent
 * format, so `copilotcli` uses its own {@link COPILOTCLI_HOOK_EVENTS} set
 * (`sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`,
 * `postToolUse`, `postToolUseFailure`, `agentStop`, `subagentStart`,
 * `subagentStop`, `errorOccurred`, `preCompact`, `permissionRequest`,
 * `notification`). Each entry supports three hook types:
 *
 * - `command` — the `bash` / `powershell` command-field shape with optional
 *   `timeoutSec`, plus optional `cwd` / `env`.
 * - `prompt` — a `prompt` string (Copilot CLI only honors prompt hooks on
 *   `sessionStart`, so prompt hooks on other events are skipped).
 * - `http` — `url` / `headers` / `allowedEnvVars` with optional `timeoutSec`.
 *
 * Path conventions used by rulesync:
 *
 * - **Project scope**: `<project>/.github/hooks/copilotcli-hooks.json` — the
 *   Copilot CLI doc explicitly states the filename inside `.github/hooks/` is
 *   user-chosen ("Create a new hooks.json file with the name of your choice
 *   in the `.github/hooks/` folder"), so rulesync uses a CLI-specific name to
 *   avoid colliding with the cloud-agent generator (`copilot-hooks.json`)
 *   when both `copilot` and `copilotcli` targets are enabled. The Copilot
 *   CLI doc also notes that "for GitHub Copilot CLI, hooks are loaded from
 *   your current working directory", which means a project-scoped file
 *   under `.github/hooks/` is picked up automatically when the CLI is
 *   invoked from the project root.
 *
 * - **Global scope**: `~/.copilot/hooks/copilot-hooks.json` — chosen for
 *   consistency with the existing global Copilot CLI config layout (e.g.
 *   `~/.copilot/mcp-config.json` produced by `copilotcli-mcp.ts`). The
 *   official docs do not currently document a global hooks location, so
 *   this is a rulesync convention pending official documentation; we keep
 *   all rulesync-managed Copilot CLI files under the single `~/.copilot/`
 *   root and will revisit if the spec later mandates an alternate layout.
 *
 * The output JSON schema and platform-specific `bash` / `powershell` command
 * field selection match `copilot-hooks.ts`, but the event surface diverges (the
 * cloud agent uses the narrower `COPILOT_HOOK_EVENTS` set).
 */
const CopilotCliHookEntrySchema = z.looseObject({
  // `type` defaults to "command" so hand-edited entries omitting the field
  // import successfully — this matches the most common case and avoids
  // silently dropping otherwise-valid entries.
  type: z._default(z.string(), "command"),
  bash: z.optional(z.string()),
  powershell: z.optional(z.string()),
  prompt: z.optional(z.string()),
  url: z.optional(z.string()),
  headers: z.optional(z.record(z.string(), z.string())),
  allowedEnvVars: z.optional(z.array(z.string())),
  cwd: z.optional(z.string()),
  env: z.optional(z.record(z.string(), z.string())),
  timeoutSec: z.optional(z.number()),
});

type CopilotCliHookEntry = z.infer<typeof CopilotCliHookEntrySchema>;

function canonicalToCopilotCliHooks(
  config: HooksConfig,
  logger?: Logger,
): Record<string, CopilotCliHookEntry[]> {
  const canonicalSchemaKeys = Object.keys(HookDefinitionSchema.shape);
  const isWindows = process.platform === "win32";
  const commandField = isWindows ? "powershell" : "bash";
  const supported: Set<string> = new Set(COPILOTCLI_HOOK_EVENTS);
  const sharedConfigHooks: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (supported.has(event)) {
      sharedConfigHooks[event] = defs;
    }
  }
  // `copilotcli` falls back to the shared `copilot.hooks` override key when no
  // `copilotcli.hooks` block is present, then lets `copilotcli.hooks` win on
  // conflicts.
  const effectiveHooks: HooksConfig["hooks"] = {
    ...sharedConfigHooks,
    ...config.copilot?.hooks,
    ...config.copilotcli?.hooks,
  };
  const out: Record<string, CopilotCliHookEntry[]> = {};
  for (const [eventName, definitions] of Object.entries(effectiveHooks)) {
    const copilotEventName = CANONICAL_TO_COPILOTCLI_EVENT_NAMES[eventName] ?? eventName;
    const entries: CopilotCliHookEntry[] = [];
    for (const def of definitions) {
      // Copilot CLI does not accept matchers.
      if (def.matcher) continue;
      const hookType = def.type ?? "command";
      const timeout = def.timeout;
      const timeoutPart = timeout !== undefined && timeout !== null ? { timeoutSec: timeout } : {};
      // Non-canonical fields (cwd, env, url, headers, allowedEnvVars, ...) pass
      // through verbatim.
      const rest = Object.fromEntries(
        Object.entries(def).filter(([k]) => !canonicalSchemaKeys.includes(k)),
      );

      if (hookType === "prompt") {
        // Copilot CLI only honors prompt hooks on sessionStart.
        if (eventName !== "sessionStart") {
          logger?.warn(
            `Copilot CLI prompt hooks are only supported on sessionStart; skipping a prompt hook on '${eventName}'.`,
          );
          continue;
        }
        if (def.prompt === undefined || def.prompt === null) continue;
        entries.push({ type: "prompt", prompt: def.prompt, ...rest });
      } else if (hookType === "http") {
        entries.push({ type: "http", ...timeoutPart, ...rest });
      } else {
        const command = def.command;
        entries.push({
          type: "command",
          ...(command !== undefined && command !== null && { [commandField]: command }),
          ...timeoutPart,
          ...rest,
        });
      }
    }
    if (entries.length > 0) {
      out[copilotEventName] = entries;
    }
  }
  return out;
}

/** Extract the non-command passthrough fields preserved across import. */
function importPassthrough(entry: CopilotCliHookEntry): Record<string, unknown> {
  const passthrough: Record<string, unknown> = {};
  if (entry.url !== undefined) passthrough.url = entry.url;
  if (entry.headers !== undefined) passthrough.headers = entry.headers;
  if (entry.allowedEnvVars !== undefined) passthrough.allowedEnvVars = entry.allowedEnvVars;
  if (entry.cwd !== undefined) passthrough.cwd = entry.cwd;
  if (entry.env !== undefined) passthrough.env = entry.env;
  return passthrough;
}

function resolveImportCommand(entry: CopilotCliHookEntry, logger?: Logger): string | undefined {
  const hasBash = typeof entry.bash === "string";
  const hasPowershell = typeof entry.powershell === "string";
  if (hasBash && hasPowershell) {
    const isWindows = process.platform === "win32";
    const chosen = isWindows ? "powershell" : "bash";
    const ignored = isWindows ? "bash" : "powershell";
    logger?.warn(
      `Copilot CLI hook has both bash and powershell commands; using ${chosen} and ignoring ${ignored} on this platform.`,
    );
    return isWindows ? entry.powershell : entry.bash;
  } else if (hasBash) {
    return entry.bash;
  } else if (hasPowershell) {
    return entry.powershell;
  }
  return undefined;
}

function copilotCliHooksToCanonical(rawHooks: unknown, logger?: Logger): HooksConfig["hooks"] {
  if (rawHooks === null || rawHooks === undefined || typeof rawHooks !== "object") {
    return {};
  }

  const canonical: HooksConfig["hooks"] = {};
  for (const [copilotEventName, hookEntries] of Object.entries(rawHooks)) {
    const eventName = COPILOTCLI_TO_CANONICAL_EVENT_NAMES[copilotEventName] ?? copilotEventName;
    if (!Array.isArray(hookEntries)) continue;
    const defs: HooksConfig["hooks"][string] = [];
    for (const rawEntry of hookEntries) {
      const parseResult = CopilotCliHookEntrySchema.safeParse(rawEntry);
      if (!parseResult.success) continue;
      const entry = parseResult.data;
      const timeout = entry.timeoutSec;
      const timeoutPart = timeout !== undefined ? { timeout } : {};
      const passthrough = importPassthrough(entry);

      if (entry.type === "prompt") {
        if (entry.prompt === undefined) continue;
        defs.push({ type: "prompt", prompt: entry.prompt, ...passthrough });
      } else if (entry.type === "http") {
        defs.push({ type: "http", ...timeoutPart, ...passthrough });
      } else {
        const command = resolveImportCommand(entry, logger);
        defs.push({
          type: "command",
          ...(command !== undefined && { command }),
          ...timeoutPart,
          ...passthrough,
        });
      }
    }
    if (defs.length > 0) {
      canonical[eventName] = defs;
    }
  }
  return canonical;
}

export class CopilotcliHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolHooksSettablePaths {
    if (global) {
      return {
        relativeDirPath: join(".copilot", "hooks"),
        relativeFilePath: "copilot-hooks.json",
      };
    }
    return {
      relativeDirPath: join(".github", "hooks"),
      relativeFilePath: "copilotcli-hooks.json",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<CopilotcliHooks> {
    const paths = CopilotcliHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new CopilotcliHooks({
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
    logger,
  }: ToolHooksFromRulesyncHooksParams & {
    global?: boolean;
    logger?: Logger;
  }): Promise<CopilotcliHooks> {
    const paths = CopilotcliHooks.getSettablePaths({ global });
    const config = rulesyncHooks.getJson();
    const copilotHooks = canonicalToCopilotCliHooks(config, logger);
    const fileContent = JSON.stringify({ version: 1, hooks: copilotHooks }, null, 2);
    return new CopilotcliHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(options?: { logger?: Logger }): RulesyncHooks {
    let parsed: { version?: number; hooks?: unknown };
    try {
      parsed = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Copilot CLI hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const hooks = copilotCliHooksToCanonical(parsed.hooks, options?.logger);
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
  }: ToolHooksForDeletionParams): CopilotcliHooks {
    return new CopilotcliHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}

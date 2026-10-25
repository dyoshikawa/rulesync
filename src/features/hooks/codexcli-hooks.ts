import { join } from "node:path";

import * as smolToml from "smol-toml";

import {
  CODEXCLI_DIR,
  CODEXCLI_HOOKS_FILE_NAME,
  CODEXCLI_MCP_FILE_NAME,
} from "../../constants/codexcli-paths.js";
import type { SharedWritePath } from "../../lib/shared-file-derive.js";
import type { ValidationResult } from "../../types/ai-file.js";
import {
  CODEXCLI_HOOK_EVENTS,
  CODEXCLI_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_CODEXCLI_EVENT_NAMES,
} from "../../types/hooks.js";
import { ToolFile } from "../../types/tool-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import { readPreviouslyOwnedHooks } from "./hooks-ownership-lock.js";
import { mergeGeneratedHookLists } from "./preserve-unowned-hook-commands.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import {
  buildImportedHooksConfig,
  canonicalToToolHooks,
  toolHooksToCanonical,
} from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

const CODEXCLI_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: CODEXCLI_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_CODEXCLI_EVENT_NAMES,
  toolToCanonicalEventNames: CODEXCLI_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "",
  // `mcp_tool` handlers (`server`, `tool`, `input`, `timeout`, `statusMessage`)
  // call a tool on an already-connected MCP server; shipped in rust-v0.148.0.
  // `prompt` and `agent` handlers are parsed by Codex but skipped.
  // https://learn.chatgpt.com/docs/hooks
  supportedHookTypes: new Set(["command", "mcp_tool"]),
  passthroughFields: ["name", "description"],
  // `commandWindows` overrides `command` on Windows; `statusMessage` is the
  // label the TUI shows while the hook runs. Both are per-handler fields of
  // `.codex/hooks.json` and carry the same name on either side. Only command
  // handlers take `commandWindows`; `statusMessage` is accepted by both.
  // https://learn.chatgpt.com/docs/hooks
  stringPassthroughFields: [
    { canonical: "commandWindows", tool: "commandWindows", commandOnly: true },
    { canonical: "statusMessage", tool: "statusMessage" },
  ],
  // `additionalContextLimit` is the token threshold above which Codex saves the
  // hook's additional context to a file and passes the path instead of the text
  // (default 2500). Per-handler field of `.codex/hooks.json` on command
  // handlers, same name on either side. https://learn.chatgpt.com/docs/hooks
  numberPassthroughFields: [
    { canonical: "additionalContextLimit", tool: "additionalContextLimit", commandOnly: true },
  ],
  // `async` runs a command hook in the background while Codex continues, with
  // the same input, matcher, trust review and timeout handling as a
  // synchronous one (up to eight concurrent per session). Command hooks only.
  // https://learn.chatgpt.com/docs/hooks
  booleanPassthroughFields: [{ canonical: "async", tool: "async", commandOnly: true }],
};

/**
 * Whether a JSON value holds a `null` anywhere. Codex rejects an `mcp_tool`
 * hook `input` that cannot be represented as TOML (it hashes the handler as
 * TOML for trust review), and `null` is the one JSON value TOML lacks.
 */
function containsNull(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(containsNull);
  }
  if (typeof value === "object") {
    return Object.values(value).some(containsNull);
  }
  return false;
}

const WHOLE_FILE_FAILURE = "Codex fails to load the whole hooks file on such a handler";

/**
 * Why this generated handler must not be written, or `undefined` when Codex
 * can load and run it. Codex deserializes `timeout` as `Option<u64>` on every
 * handler type, and `server` / `tool` as required strings plus `input` as a
 * TOML-representable map on `mcp_tool`; a handler that fails that stops the
 * whole hooks file from loading rather than just that one hook. An empty
 * `server` / `tool` string still loads but can never resolve to a tool.
 * https://github.com/openai/codex/blob/main/codex-rs/config/src/hook_config.rs
 */
function describeRejectedHandler(handler: Record<string, unknown>): string | undefined {
  const { timeout } = handler;
  if (
    timeout !== undefined &&
    (typeof timeout !== "number" || !Number.isSafeInteger(timeout) || timeout < 0)
  ) {
    return `its "timeout" ${JSON.stringify(timeout) ?? String(timeout)} is not a non-negative integer, and ${WHOLE_FILE_FAILURE}`;
  }
  if (handler.type !== "mcp_tool") {
    return undefined;
  }
  for (const field of ["server", "tool"] as const) {
    const value = handler[field];
    if (typeof value !== "string") {
      return `it has no "${field}", and ${WHOLE_FILE_FAILURE}`;
    }
    if (value === "") {
      return `its "${field}" is empty, so it can never resolve to an MCP tool`;
    }
  }
  if (containsNull(handler.input)) {
    return `its "input" holds a null, which Codex cannot represent as TOML, and ${WHOLE_FILE_FAILURE}`;
  }
  return undefined;
}

/**
 * Drop the generated handlers Codex would refuse to load (or could never
 * run), and warn about the `mcp_tool` ones Codex loads but skips (`SessionEnd`
 * MCP hooks are skipped with a startup warning). Matcher groups left without
 * handlers are removed. https://learn.chatgpt.com/docs/hooks
 */
function filterCodexHandlers({
  hooks,
  logger,
}: {
  hooks: Record<string, unknown[]>;
  logger?: Logger;
}): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = {};
  const skippedSessionEndTools: string[] = [];
  for (const [eventName, groups] of Object.entries(hooks)) {
    const kept: unknown[] = [];
    for (const group of groups) {
      const entry = group as { hooks?: unknown };
      if (!Array.isArray(entry.hooks)) {
        kept.push(group);
        continue;
      }
      const handlers = entry.hooks.filter((handler: Record<string, unknown>) => {
        const reason = describeRejectedHandler(handler);
        if (reason !== undefined) {
          logger?.warn(
            `Skipping a "${String(handler.type)}" hook on Codex CLI "${eventName}": ${reason}.`,
          );
          return false;
        }
        if (eventName === "SessionEnd" && handler.type === "mcp_tool") {
          skippedSessionEndTools.push(`${String(handler.server)}/${String(handler.tool)}`);
        }
        return true;
      });
      if (handlers.length > 0) {
        kept.push({ ...entry, hooks: handlers });
      }
    }
    if (kept.length > 0) {
      result[eventName] = kept;
    }
  }
  if (skippedSessionEndTools.length > 0) {
    logger?.warn(
      `Codex CLI skips "mcp_tool" hooks on "SessionEnd" with a startup warning, so these are written but will not run: ${skippedSessionEndTools.join(", ")}.`,
    );
  }
  return result;
}

/**
 * Build the content for `.codex/config.toml`, cleaning up the deprecated `codex_hooks` key.
 * Reads the existing file (if any), parses TOML, and returns the content without writing to
 * disk. The caller is responsible for writing via the normal write phase.
 *
 * Hooks are GA and enabled by default in Codex CLI, so `[features] hooks = true` is no longer
 * required and is intentionally NOT force-written here (doing so used to be harmless/idempotent,
 * but is now redundant and could mask a user's own `hooks = false` opt-out on a later edit).
 * See https://developers.openai.com/codex/hooks. Only the legacy `codex_hooks` alias — superseded
 * by `hooks` — is still cleaned up.
 */
async function buildCodexConfigTomlContent({
  outputRoot,
}: {
  outputRoot: string;
}): Promise<string> {
  const configPath = join(outputRoot, CODEXCLI_DIR, CODEXCLI_MCP_FILE_NAME);
  const existingContent = (await readFileContentOrNull(configPath)) ?? "";
  let configToml: smolToml.TomlPrimitive;
  try {
    configToml = smolToml.parse(existingContent || smolToml.stringify({}));
  } catch (error) {
    throw new Error(
      `Failed to parse existing Codex CLI config at ${configPath}: ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }

  let features: smolToml.TomlTable | undefined;
  if (typeof configToml.features === "object" && configToml.features !== null) {
    features = { ...(configToml.features as smolToml.TomlTable) };
    delete features.codex_hooks;
  }

  return applySharedConfigPatch({
    fileKey: sharedConfigFileKey({
      relativeDirPath: CODEXCLI_DIR,
      relativeFilePath: CODEXCLI_MCP_FILE_NAME,
    }),
    feature: "hooks",
    existingContent,
    patch: { features },
    filePath: configPath,
  });
}

/**
 * Represents the `.codex/config.toml` file as a generated ToolFile,
 * so it goes through the normal write phase and respects dry-run mode.
 */
export class CodexcliConfigToml extends ToolFile {
  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static async fromOutputRoot({ outputRoot }: { outputRoot: string }): Promise<CodexcliConfigToml> {
    const fileContent = await buildCodexConfigTomlContent({ outputRoot });
    return new CodexcliConfigToml({
      outputRoot,
      relativeDirPath: CODEXCLI_DIR,
      relativeFilePath: CODEXCLI_MCP_FILE_NAME,
      fileContent,
    });
  }
}

export class CodexcliHooks extends ToolHooks {
  constructor(params: ToolHooksParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    return { relativeDirPath: CODEXCLI_DIR, relativeFilePath: CODEXCLI_HOOKS_FILE_NAME };
  }

  // Codex CLI enables hooks by also writing `.codex/config.toml`, a file the MCP
  // and permissions features share. Declared here because it is not a settable path.
  static getExtraSharedWritePaths(): SharedWritePath[] {
    return [{ relativeDirPath: CODEXCLI_DIR, relativeFilePath: CODEXCLI_MCP_FILE_NAME }];
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<CodexcliHooks> {
    const paths = CodexcliHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new CodexcliHooks({
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
    preserveUnowned = false,
    logger,
  }: ToolHooksFromRulesyncHooksParams & {
    global?: boolean;
    logger?: Logger;
  }): Promise<CodexcliHooks> {
    const paths = CodexcliHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const config = rulesyncHooks.getJson();
    const codexHooks = filterCodexHandlers({
      hooks: canonicalToToolHooks({
        config,
        toolOverrideHooks: config.codexcli?.hooks,
        converterConfig: CODEXCLI_CONVERTER_CONFIG,
        logger,
      }),
      logger,
    });
    const previouslyOwned = preserveUnowned
      ? await readPreviouslyOwnedHooks({ outputRoot, relativeDirPath: paths.relativeDirPath })
      : undefined;
    const merged = mergeGeneratedHookLists({
      existingContent,
      generatedHooks: codexHooks,
      shape: "matcher-groups",
      preserveUnowned,
      previouslyOwned,
      logger,
    });
    const fileContent = JSON.stringify({ hooks: merged.hooks }, null, 2);

    return new CodexcliHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      ownedHookRefs: preserveUnowned ? merged.owned : undefined,
      validate,
    });
  }

  toRulesyncHooks({ logger }: { logger?: Logger } = {}): RulesyncHooks {
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
    const hooks = toolHooksToCanonical({
      hooks: parsed.hooks,
      converterConfig: CODEXCLI_CONVERTER_CONFIG,
      logger,
    });
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "codexcli" }),
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
  }: ToolHooksForDeletionParams): CodexcliHooks {
    return new CodexcliHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }

  static override supportsPreserveUnowned(): boolean {
    return true;
  }

  static override async getAuxiliaryFiles({
    outputRoot = process.cwd(),
    toolHooks,
  }: {
    outputRoot?: string;
    global?: boolean;
    toolHooks?: ToolHooks;
    logger?: Logger;
  } = {}): Promise<ToolFile[]> {
    return [
      await CodexcliConfigToml.fromOutputRoot({ outputRoot }),
      ...(toolHooks instanceof CodexcliHooks ? toolHooks.getOwnershipLockFiles() : []),
    ];
  }
}

import { join } from "node:path";

import {
  DEVIN_CONFIG_FILE_NAME,
  DEVIN_DIR,
  DEVIN_GLOBAL_CONFIG_DIR_PATH,
  DEVIN_HOOKS_V1_FILE_NAME,
} from "../../constants/devin-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  CANONICAL_TO_DEVIN_EVENT_NAMES,
  DEVIN_HOOK_EVENTS,
  DEVIN_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import { canonicalToToolHooks, toolHooksToCanonical } from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * Devin Local hook events that have no `matcher` field.
 *
 * Devin matches `matcher` against the event's `tool_name`, which is only
 * meaningful for the tool/permission lifecycle events
 * (`PreToolUse`/`PostToolUse`/`PermissionRequest`). The session and turn events
 * are matcher-less; any matcher defined on them is dropped with a warning.
 */
const DEVIN_NO_MATCHER_EVENTS: ReadonlySet<string> = new Set([
  "sessionStart",
  "sessionEnd",
  "stop",
  "beforeSubmitPrompt",
]);

const DEVIN_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: DEVIN_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_DEVIN_EVENT_NAMES,
  toolToCanonicalEventNames: DEVIN_TO_CANONICAL_EVENT_NAMES,
  // Devin documents plain `./script.sh` commands with no project-directory
  // variable, so commands are emitted verbatim.
  projectDirVar: "",
  supportedHookTypes: new Set(["command", "prompt"]),
  noMatcherEvents: DEVIN_NO_MATCHER_EVENTS,
};

/**
 * Hooks generator for Devin Local (native `.devin/` hooks).
 *
 * Devin Local adopts a Claude-Code-style lifecycle hooks model: each event maps
 * to an array of `{ matcher?, hooks: [{ type, command|prompt, timeout? }] }`
 * matcher groups.
 *
 * - Project scope: `.devin/hooks.v1.json`. This is a standalone file whose top
 *   level IS the event map (no wrapper key).
 * - Global scope: `~/.config/devin/config.json` under the `"hooks"` key. This
 *   file is shared with the MCP (`mcpServers`) and permissions (`permissions`)
 *   features, so reads and writes merge into the existing JSON and the file is
 *   never deleted in global mode.
 *
 * @see https://docs.devin.ai/cli/extensibility/hooks/overview
 */
export class DevinHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  /**
   * The project standalone `hooks.v1.json` is owned wholesale by rulesync and
   * may be deleted as an orphan. The global `config.json` is shared with the MCP
   * and permissions features, so it must never be deleted.
   */
  override isDeletable(): boolean {
    return this.getRelativeFilePath() !== DEVIN_CONFIG_FILE_NAME;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolHooksSettablePaths {
    if (global) {
      return {
        relativeDirPath: DEVIN_GLOBAL_CONFIG_DIR_PATH,
        relativeFilePath: DEVIN_CONFIG_FILE_NAME,
      };
    }
    return {
      relativeDirPath: DEVIN_DIR,
      relativeFilePath: DEVIN_HOOKS_V1_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<DevinHooks> {
    const paths = DevinHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new DevinHooks({
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
  }): Promise<DevinHooks> {
    const paths = DevinHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);

    const config = rulesyncHooks.getJson();
    const devinHooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.devin?.hooks,
      converterConfig: DEVIN_CONVERTER_CONFIG,
      logger,
    });

    let fileContent: string;
    if (global) {
      // Global hooks live under the `hooks` key of the shared config.json, which
      // also carries `mcpServers` / `permissions` from the other features, so
      // read-modify-write and preserve the sibling keys.
      const existingContent = await readOrInitializeFileContent(
        filePath,
        JSON.stringify({}, null, 2),
      );
      let settings: Record<string, unknown>;
      try {
        settings = JSON.parse(existingContent);
      } catch (error) {
        throw new Error(
          `Failed to parse existing Devin config at ${filePath}: ${formatError(error)}`,
          { cause: error },
        );
      }
      const merged = { ...settings, hooks: devinHooks };
      fileContent = JSON.stringify(merged, null, 2);
    } else {
      // The project hooks.v1.json is dedicated to hooks; reading it first keeps a
      // stable round-trip when unchanged.
      await readOrInitializeFileContent(filePath, JSON.stringify({}, null, 2));
      fileContent = JSON.stringify(devinHooks, null, 2);
    }

    return new DevinHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Devin hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    // In config.json the hooks live under the `hooks` key; in the standalone
    // hooks.v1.json the event map is the entire file.
    const isConfigFile = this.getRelativeFilePath() === DEVIN_CONFIG_FILE_NAME;
    const events = isConfigFile
      ? isRecord(parsed) && isRecord(parsed.hooks)
        ? parsed.hooks
        : {}
      : parsed;

    const hooks = toolHooksToCanonical({
      hooks: events,
      converterConfig: DEVIN_CONVERTER_CONFIG,
    });
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
  }: ToolHooksForDeletionParams): DevinHooks {
    return new DevinHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}

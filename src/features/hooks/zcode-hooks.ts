import { join } from "node:path";

import {
  ZCODE_CONFIG_FILE_NAME,
  ZCODE_DIR,
  ZCODE_GLOBAL_CONFIG_DIR_PATH,
  ZCODE_HOOKS_CONFIG_KEY,
  ZCODE_HOOKS_EVENTS_KEY,
} from "../../constants/zcode-paths.js";
import { type AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  CANONICAL_TO_ZCODE_EVENT_NAMES,
  ZCODE_HOOK_EVENTS,
  ZCODE_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { RulesyncHooks } from "./rulesync-hooks.js";
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
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * Single spelling of the config.json codec/policy, matching the one in
 * ZcodeMcp: fail closed on an unparseable root rather than replacing the
 * user's primary ZCode config with generated output.
 */
function parseZcodeConfig(fileContent: string, filePath?: string): Record<string, unknown> {
  return parseSharedConfig({
    format: "json",
    fileContent,
    filePath,
    invalidRootPolicy: "error",
  });
}

/**
 * Drop ZCode's native `process` hooks from an `events` map before the shared
 * import converter runs. The converter would coerce the unknown type to
 * `command` and import the executable alone — losing the `args` vector that
 * *is* the process hook's command line — so the imported hook would run
 * something else than the file states. Matcher groups left without hooks are
 * dropped with them.
 */
function stripProcessHooks({
  events,
  logger,
}: {
  events: unknown;
  logger: Logger | undefined;
}): unknown {
  if (!isRecord(events)) return events;
  const result: Record<string, unknown> = {};
  for (const [eventName, entries] of Object.entries(events)) {
    if (!Array.isArray(entries)) {
      result[eventName] = entries;
      continue;
    }
    const kept: unknown[] = [];
    for (const entry of entries) {
      if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
        kept.push(entry);
        continue;
      }
      const hooks = entry.hooks.filter((hook) => {
        if (isRecord(hook) && hook.type === "process") {
          logger?.warn(
            `Skipping a ZCode "process" hook on "${eventName}" while importing: it has no ` +
              `canonical equivalent, and importing its executable alone would change what it runs.`,
          );
          return false;
        }
        return true;
      });
      if (hooks.length > 0) kept.push({ ...entry, hooks });
    }
    result[eventName] = kept;
  }
  return result;
}

const ZCODE_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: ZCODE_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_ZCODE_EVENT_NAMES,
  toolToCanonicalEventNames: ZCODE_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "$ZCODE_PROJECT_DIR",
  prefixDotRelativeCommandsOnly: true,
  // Only canonical `command` hooks are emitted. ZCode's native `process` type
  // (an argv run without a shell) has no canonical equivalent: its `args` *is*
  // the command line, whereas the canonical `args` field means extra argv
  // appended by the runner, so mapping between them would change what runs.
  // Process hooks are skipped with a warning on import instead.
  supportedHookTypes: new Set(["command"]),
  stringPassthroughFields: [
    { canonical: "statusMessage", tool: "statusMessage" },
    { canonical: "shell", tool: "shell" },
  ],
  // ZCode compiles `matcher` as a regular expression, where a bare `*` is a
  // syntax error that silently never matches; an omitted matcher matches all.
  wildcardMatcherMeansAll: true,
};

/**
 * ZCode hooks.
 *
 * ZCode reads configuration-file hooks from the `hooks` block of its own config
 * file — `<project>/.zcode/config.json` at workspace scope and
 * `~/.zcode/cli/config.json` at user scope. The event map is nested under
 * `hooks.events` beside the user-tunable `enabled` and `timeoutMs` siblings,
 * which are carried over while `events` is replaced. Configuration-file hooks
 * are disabled by default, so the writer states `enabled: true` unless the
 * existing file deliberately holds `false`.
 *
 * @see https://zcode.z.ai/en/docs
 */
export class ZcodeHooks extends ToolHooks {
  private readonly json: Record<string, unknown>;

  constructor(params: AiFileParams) {
    super(params);
    this.json = parseZcodeConfig(
      this.fileContent ?? "{}",
      join(this.relativeDirPath, this.relativeFilePath),
    );
  }

  override isDeletable(): boolean {
    // config.json is ZCode's primary config file, so it must never be removed
    // wholesale; clearing hooks happens via an in-place merge instead.
    return false;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolHooksSettablePaths {
    return {
      relativeDirPath: global ? ZCODE_GLOBAL_CONFIG_DIR_PATH : ZCODE_DIR,
      relativeFilePath: ZCODE_CONFIG_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<ZcodeHooks> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";

    return new ZcodeHooks({
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
    logger,
  }: ToolHooksFromRulesyncHooksParams & {
    global?: boolean;
    logger?: Logger;
  }): Promise<ZcodeHooks> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";
    const existing = parseZcodeConfig(existingContent, filePath);

    const config = rulesyncHooks.getJson();
    const events = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.zcode?.hooks,
      converterConfig: ZCODE_CONVERTER_CONFIG,
      logger,
    });

    // `hooks` is owned as a whole key, so its non-`events` siblings (the
    // `enabled` switch and a user-tuned `timeoutMs`) are carried over from the
    // existing file before the events snapshot replaces `events`. An explicit
    // `enabled: false` is the user's off switch and survives regeneration;
    // anything else states `true`, without which ZCode runs no config hooks.
    const existingHooks = isRecord(existing[ZCODE_HOOKS_CONFIG_KEY])
      ? existing[ZCODE_HOOKS_CONFIG_KEY]
      : {};

    return new ZcodeHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "hooks",
        existingContent,
        patch: {
          [ZCODE_HOOKS_CONFIG_KEY]: {
            ...existingHooks,
            enabled: existingHooks.enabled !== false,
            [ZCODE_HOOKS_EVENTS_KEY]: events,
          },
        },
        filePath,
      }),
      validate,
      global,
    });
  }

  toRulesyncHooks({ logger }: { logger?: Logger } = {}): RulesyncHooks {
    const hooksBlock = isRecord(this.json[ZCODE_HOOKS_CONFIG_KEY])
      ? this.json[ZCODE_HOOKS_CONFIG_KEY]
      : {};
    const hooks = toolHooksToCanonical({
      hooks: stripProcessHooks({
        events: hooksBlock[ZCODE_HOOKS_EVENTS_KEY],
        logger,
      }),
      converterConfig: ZCODE_CONVERTER_CONFIG,
      logger,
    });
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "zcode" }),
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
    global = false,
  }: ToolHooksForDeletionParams): ZcodeHooks {
    // The shared config file is never deleted (isDeletable() === false), but
    // forDeletion must still return a well-formed instance.
    return new ZcodeHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(
        { [ZCODE_HOOKS_CONFIG_KEY]: { [ZCODE_HOOKS_EVENTS_KEY]: {} } },
        null,
        2,
      ),
      validate: false,
      global,
    });
  }
}

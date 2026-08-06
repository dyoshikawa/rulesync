import { join } from "node:path";

import { DEEPAGENTS_DIR, DEEPAGENTS_HOOKS_FILE_NAME } from "../../constants/deepagents-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { HookDefinition, HooksConfig } from "../../types/hooks.js";
import {
  CANONICAL_TO_DEEPAGENTS_EVENT_NAMES,
  DEEPAGENTS_HOOK_EVENTS,
  DEEPAGENTS_LEGACY_TO_CANONICAL_EVENT_NAMES,
  DEEPAGENTS_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import { buildImportedHooksConfig } from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/** One `command` handler inside a Hooks v2 matcher group. */
type DeepagentsHandler = {
  type: "command";
  command: string;
  timeout?: number;
  statusMessage?: string;
};

/** A matcher and its ordered handlers, upstream's `MatcherGroup`. */
type DeepagentsMatcherGroup = {
  matcher?: string;
  hooks: DeepagentsHandler[];
};

/** The Hooks v2 document: `{ "hooks": { "<Event>": [MatcherGroup] } }`. */
type DeepagentsHooksFile = {
  hooks: Record<string, DeepagentsMatcherGroup[]>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Convert the canonical hooks config to the deepagents Hooks v2 document.
 *
 * ```json
 * { "hooks": { "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "…" }] }] } }
 * ```
 *
 * Definitions sharing an event and matcher land in one group, preserving their
 * authored order — upstream runs a group's handlers in sequence.
 */
function canonicalToDeepagentsHooks(config: HooksConfig): DeepagentsHooksFile["hooks"] {
  const supported: Set<string> = new Set(DEEPAGENTS_HOOK_EVENTS);
  // Merge shared hooks + deepagents-specific overrides.
  // Note: this class handles the deepagents.hooks merge internally rather than
  // relying on the processor's pre-merged effectiveHooks, because the processor
  // passes the raw RulesyncHooks config. The processor's warning path also
  // computes its own effective merge for logging purposes, which is consistent.
  const effectiveHooks: HooksConfig["hooks"] = {
    ...config.hooks,
    ...config.deepagents?.hooks,
  };

  const hooks: DeepagentsHooksFile["hooks"] = {};

  for (const [canonicalEvent, definitions] of Object.entries(effectiveHooks)) {
    if (!supported.has(canonicalEvent)) continue;

    const deepagentsEvent = CANONICAL_TO_DEEPAGENTS_EVENT_NAMES[canonicalEvent];
    if (!deepagentsEvent) continue;

    for (const def of definitions) {
      if ((def.type ?? "command") !== "command") continue;
      if (!def.command) continue;

      const handler: DeepagentsHandler = { type: "command", command: def.command };
      // Upstream validates `timeout` as `> 0`, so a zero or negative value
      // would make the whole document fail to load.
      if (def.timeout !== undefined && def.timeout !== null && def.timeout > 0) {
        handler.timeout = def.timeout;
      }
      if (def.statusMessage !== undefined && def.statusMessage !== null) {
        handler.statusMessage = def.statusMessage;
      }

      const matcher =
        def.matcher !== undefined && def.matcher !== null && def.matcher !== ""
          ? def.matcher
          : undefined;
      const groups = (hooks[deepagentsEvent] ??= []);
      const group = groups.find((candidate) => candidate.matcher === matcher);
      if (group) {
        group.hooks.push(handler);
      } else {
        groups.push({ ...(matcher !== undefined && { matcher }), hooks: [handler] });
      }
    }
  }

  return hooks;
}

/**
 * Convert the Hooks v2 document back to the canonical hooks record.
 */
function deepagentsToCanonicalHooks(hooks: DeepagentsHooksFile["hooks"]): HooksConfig["hooks"] {
  const canonical: HooksConfig["hooks"] = {};

  for (const [deepagentsEvent, groups] of Object.entries(hooks)) {
    const canonicalEvent = DEEPAGENTS_TO_CANONICAL_EVENT_NAMES[deepagentsEvent];
    if (!canonicalEvent || !Array.isArray(groups)) continue;

    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group.hooks)) continue;

      for (const handler of group.hooks) {
        if (!isRecord(handler) || typeof handler.command !== "string") continue;

        const def: HookDefinition = { type: "command", command: handler.command };
        if (typeof group.matcher === "string" && group.matcher !== "") {
          def.matcher = group.matcher;
        }
        if (typeof handler.timeout === "number") def.timeout = handler.timeout;
        if (typeof handler.statusMessage === "string") def.statusMessage = handler.statusMessage;

        (canonical[canonicalEvent] ??= []).push(def);
      }
    }
  }

  return canonical;
}

/**
 * Read the pre-v2 flat list. deepagents still loads it until 2026-09-01, so a
 * `hooks.json` a user has not migrated yet is imported rather than discarded —
 * but rulesync only ever writes the v2 shape, so regenerating migrates it.
 */
function deepagentsLegacyToCanonicalHooks(entries: unknown[]): HooksConfig["hooks"] {
  const canonical: HooksConfig["hooks"] = {};

  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const argv = entry.command;
    if (!Array.isArray(argv) || argv.length === 0) continue;

    // The legacy writer wrapped the script as `["bash", "-c", <script>]`.
    const command =
      argv.length === 3 && argv[0] === "bash" && argv[1] === "-c"
        ? String(argv[2] ?? "")
        : argv.join(" ");

    const events = Array.isArray(entry.events) ? entry.events : [];
    for (const legacyEvent of events) {
      const canonicalEvent =
        typeof legacyEvent === "string"
          ? DEEPAGENTS_LEGACY_TO_CANONICAL_EVENT_NAMES[legacyEvent]
          : undefined;
      if (!canonicalEvent) continue;

      (canonical[canonicalEvent] ??= []).push({ type: "command", command });
    }
  }

  return canonical;
}

export class DeepagentsHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? JSON.stringify({ hooks: {} }, null, 2),
    });
  }

  override isDeletable(): boolean {
    return true;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    return {
      relativeDirPath: DEEPAGENTS_DIR,
      relativeFilePath: DEEPAGENTS_HOOKS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<DeepagentsHooks> {
    const paths = DeepagentsHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent =
      (await readFileContentOrNull(filePath)) ?? JSON.stringify({ hooks: {} }, null, 2);
    return new DeepagentsHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static fromRulesyncHooks({
    outputRoot = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false,
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): DeepagentsHooks {
    const config = rulesyncHooks.getJson();
    const hooks = canonicalToDeepagentsHooks(config);
    const fileContent = JSON.stringify({ hooks }, null, 2);
    const paths = DeepagentsHooks.getSettablePaths({ global });

    return new DeepagentsHooks({
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
        `Failed to parse deepagents hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const rawHooks = isRecord(parsed) ? parsed.hooks : undefined;
    // The v2 document keys hooks by event name; the pre-v2 one held a flat
    // list. Both are still loadable upstream, so both are imported.
    const hooks = Array.isArray(rawHooks)
      ? deepagentsLegacyToCanonicalHooks(rawHooks)
      : isRecord(rawHooks)
        ? deepagentsToCanonicalHooks(rawHooks as DeepagentsHooksFile["hooks"])
        : {};

    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "deepagents" }),
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
  }: ToolHooksForDeletionParams): DeepagentsHooks {
    return new DeepagentsHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}

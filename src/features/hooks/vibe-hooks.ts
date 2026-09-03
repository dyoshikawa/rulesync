import { join } from "node:path";

import * as smolToml from "smol-toml";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  CANONICAL_TO_VIBE_EVENT_NAMES,
  type HookDefinition,
  type HooksConfig,
  VIBE_HOOK_EVENTS,
  VIBE_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { lookupOwn } from "../../utils/own-lookup.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import { buildImportedHooksConfig } from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

const VIBE_DIR = ".vibe";
const VIBE_HOOKS_FILE_NAME = "hooks.toml";

/**
 * One serialized `[[hooks]]` entry in `.vibe/hooks.toml`.
 * @see https://github.com/mistralai/mistral-vibe/blob/main/README.md
 */
type VibeHookEntry = {
  name: string;
  type: string;
  match?: string;
  command: string;
  timeout?: number;
  strict?: boolean;
  description?: string;
};

/**
 * Vibe scopes the tool-name `match` glob and the `strict` flag to tool hooks
 * (`pre_tool` / `post_tool`) only; `post_agent` fires after every
 * assistant turn and carries no matcher.
 * @see https://github.com/mistralai/mistral-vibe/blob/main/README.md
 */
const VIBE_TOOL_EVENTS: ReadonlySet<string> = new Set(["pre_tool", "post_tool"]);

const SUPPORTED_VIBE_EVENTS: ReadonlySet<string> = new Set(VIBE_HOOK_EVENTS);

/**
 * Build the flat `[[hooks]]` array for `.vibe/hooks.toml` from a canonical
 * hooks config. Vibe uses a flat array where each entry carries its own event
 * `type`, tool-name `match` glob/regex, and `command`. Only `type: "command"`
 * canonical hooks are emitted (Vibe hooks are always shell commands).
 */
function canonicalToVibeHooks(
  config: HooksConfig,
  toolOverride: HooksConfig["hooks"] | undefined,
): {
  hooks: VibeHookEntry[];
} {
  const shared: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (SUPPORTED_VIBE_EVENTS.has(event)) {
      shared[event] = defs;
    }
  }
  const effective: HooksConfig["hooks"] = { ...shared, ...toolOverride };

  const hooks: VibeHookEntry[] = [];
  for (const [event, defs] of Object.entries(effective)) {
    if (!SUPPORTED_VIBE_EVENTS.has(event)) {
      continue;
    }
    const vibeEvent = lookupOwn({ record: CANONICAL_TO_VIBE_EVENT_NAMES, key: event }) ?? event;
    let index = 0;
    for (const def of defs) {
      const hookType = def.type ?? "command";
      if (hookType !== "command") {
        continue;
      }
      if (typeof def.command !== "string") {
        continue;
      }
      const name = typeof def.name === "string" ? def.name : `${vibeEvent}-${index}`;
      const isToolEvent = VIBE_TOOL_EVENTS.has(vibeEvent);
      const entry: VibeHookEntry = {
        name,
        type: vibeEvent,
        command: def.command,
      };
      // The tool-name `match` glob applies to tool hooks only; `post_agent`
      // carries no matcher, so omit it there.
      if (isToolEvent) {
        entry.match = typeof def.matcher === "string" && def.matcher !== "" ? def.matcher : "*";
      }
      if (typeof def.timeout === "number") {
        entry.timeout = def.timeout;
      }
      // Vibe's `strict` flag applies to tool hooks only. We carry it through when
      // present on the canonical definition (passed via the loose `strict` key).
      const strict = (def as Record<string, unknown>).strict;
      if (isToolEvent && typeof strict === "boolean") {
        entry.strict = strict;
      }
      if (typeof def.description === "string") {
        entry.description = def.description;
      }
      hooks.push(entry);
      index += 1;
    }
  }

  return { hooks };
}

/** Convert one raw `[[hooks]]` entry to a canonical definition, or null to skip. */
function vibeEntryToCanonicalDef(
  raw: unknown,
): { canonicalEvent: string; def: HookDefinition } | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const entry = raw as Record<string, unknown>;
  const vibeEvent = typeof entry.type === "string" ? entry.type : undefined;
  if (vibeEvent === undefined) {
    return null;
  }
  // The lookup below is own-property-only, so a crafted `type` such as
  // "toString" falls back to the raw name instead of a prototype member. The
  // raw name is still written as a key of the canonical record, so a
  // prototype-pollution key is skipped outright, as `kiroIdeHooksToCanonical`
  // does.
  if (isPrototypePollutionKey(vibeEvent)) {
    return null;
  }
  const canonicalEvent =
    lookupOwn({ record: VIBE_TO_CANONICAL_EVENT_NAMES, key: vibeEvent }) ?? vibeEvent;
  const def: HookDefinition = { type: "command" };
  if (typeof entry.command === "string") {
    def.command = entry.command;
  }
  if (typeof entry.match === "string" && entry.match !== "" && entry.match !== "*") {
    def.matcher = entry.match;
  }
  if (typeof entry.timeout === "number") {
    def.timeout = entry.timeout;
  }
  if (typeof entry.name === "string") {
    def.name = entry.name;
  }
  if (typeof entry.description === "string") {
    def.description = entry.description;
  }
  if (typeof entry.strict === "boolean") {
    (def as Record<string, unknown>).strict = entry.strict;
  }
  return { canonicalEvent, def };
}

/**
 * Reverse {@link canonicalToVibeHooks}: parse the flat `[[hooks]]` array back
 * into a canonical event → definition[] record.
 */
function vibeHooksToCanonical(parsed: unknown): HooksConfig["hooks"] {
  const canonical: HooksConfig["hooks"] = {};
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return canonical;
  }
  const rawHooks = (parsed as Record<string, unknown>).hooks;
  if (!Array.isArray(rawHooks)) {
    return canonical;
  }
  for (const raw of rawHooks) {
    const result = vibeEntryToCanonicalDef(raw);
    if (result === null) {
      continue;
    }
    const list = lookupOwn({ record: canonical, key: result.canonicalEvent }) ?? [];
    list.push(result.def);
    canonical[result.canonicalEvent] = list;
  }
  return canonical;
}

function parseVibeToml(fileContent: string): Record<string, unknown> {
  const parsed = smolToml.parse(fileContent || smolToml.stringify({}));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return { ...(parsed as Record<string, unknown>) };
}

/**
 * Mistral Vibe hooks adapter.
 *
 * Emits the flat `[[hooks]]` array to `.vibe/hooks.toml` (project) or
 * `~/.vibe/hooks.toml` (global; the processor sets outputRoot to HOME).
 * v2.21.0 graduated hooks from experimental and removed the
 * `enable_experimental_hooks` flag, so declaring a hook is all that is needed
 * and no auxiliary `.vibe/config.toml` write happens.
 * @see https://github.com/mistralai/mistral-vibe/blob/main/README.md
 */
export class VibeHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? smolToml.stringify({}),
    });
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    return { relativeDirPath: VIBE_DIR, relativeFilePath: VIBE_HOOKS_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<VibeHooks> {
    const paths = VibeHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? smolToml.stringify({});
    return new VibeHooks({
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
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): Promise<VibeHooks> {
    const paths = VibeHooks.getSettablePaths({ global });
    const config = rulesyncHooks.getJson();
    const vibeHooks = canonicalToVibeHooks(config, config.vibe?.hooks);
    const fileContent = smolToml.stringify(vibeHooks);

    return new VibeHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    let parsed: Record<string, unknown>;
    try {
      parsed = parseVibeToml(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Vibe hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const hooks = vibeHooksToCanonical(parsed);
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "vibe" }),
        null,
        2,
      ),
    });
  }

  validate(): ValidationResult {
    try {
      parseVibeToml(this.fileContent);
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: new Error(`Failed to parse Vibe hooks TOML: ${formatError(error)}`),
      };
    }
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): VibeHooks {
    return new VibeHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: smolToml.stringify({}),
      validate: false,
    });
  }
}

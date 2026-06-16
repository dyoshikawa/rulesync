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
import { ToolFile } from "../../types/tool-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

const VIBE_DIR = ".vibe";
const VIBE_HOOKS_FILE_NAME = "hooks.toml";
const VIBE_CONFIG_FILE_NAME = "config.toml";

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
 * (`before_tool` / `after_tool`) only; `post_agent_turn` fires after every
 * assistant turn and carries no matcher.
 * @see https://github.com/mistralai/mistral-vibe/blob/main/README.md
 */
const VIBE_TOOL_EVENTS: ReadonlySet<string> = new Set(["before_tool", "after_tool"]);

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
    const vibeEvent = CANONICAL_TO_VIBE_EVENT_NAMES[event] ?? event;
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
      // The tool-name `match` glob applies to tool hooks only; `post_agent_turn`
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
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const vibeEvent = typeof entry.type === "string" ? entry.type : undefined;
    if (vibeEvent === undefined) {
      continue;
    }
    const canonicalEvent = VIBE_TO_CANONICAL_EVENT_NAMES[vibeEvent] ?? vibeEvent;
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
    const list = canonical[canonicalEvent] ?? [];
    list.push(def);
    canonical[canonicalEvent] = list;
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
 * Build the content for `.vibe/config.toml` with
 * `enable_experimental_hooks = true`. Reads the existing config (if any),
 * parses TOML, sets the flag while preserving every other key, and returns the
 * serialized content without writing to disk. The caller writes it through the
 * normal write phase (respecting dry-run mode).
 */
async function buildVibeConfigTomlContent({ outputRoot }: { outputRoot: string }): Promise<string> {
  const configPath = join(outputRoot, VIBE_DIR, VIBE_CONFIG_FILE_NAME);
  const existingContent = (await readFileContentOrNull(configPath)) ?? smolToml.stringify({});
  let config: Record<string, unknown>;
  try {
    config = parseVibeToml(existingContent);
  } catch (error) {
    throw new Error(
      `Failed to parse existing Vibe config at ${configPath}: ${formatError(error)}`,
      { cause: error },
    );
  }
  config.enable_experimental_hooks = true;
  return smolToml.stringify(config);
}

/**
 * Represents the `.vibe/config.toml` file as a generated ToolFile so it goes
 * through the normal write phase and respects dry-run mode. The flag merge
 * preserves any existing config keys (MCP servers, permissions, etc.).
 */
export class VibeConfigToml extends ToolFile {
  override isDeletable(): boolean {
    // The config file holds other Vibe settings (MCP, permissions), so never
    // delete it when hooks are removed — only the flag is rulesync-managed.
    return false;
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static async fromOutputRoot({ outputRoot }: { outputRoot: string }): Promise<VibeConfigToml> {
    const fileContent = await buildVibeConfigTomlContent({ outputRoot });
    return new VibeConfigToml({
      outputRoot,
      relativeDirPath: VIBE_DIR,
      relativeFilePath: VIBE_CONFIG_FILE_NAME,
      fileContent,
    });
  }
}

/**
 * Mistral Vibe experimental hooks adapter.
 *
 * Emits the flat `[[hooks]]` array to `.vibe/hooks.toml` (project) or
 * `~/.vibe/hooks.toml` (global; the processor sets outputRoot to HOME), and an
 * auxiliary `.vibe/config.toml` setting `enable_experimental_hooks = true` to
 * unlock the experimental hooks runtime.
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
      fileContent: JSON.stringify({ version: 1, hooks }, null, 2),
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

  static async getAuxiliaryFiles({
    outputRoot = process.cwd(),
  }: {
    outputRoot?: string;
    global?: boolean;
  } = {}): Promise<ToolFile[]> {
    return [await VibeConfigToml.fromOutputRoot({ outputRoot })];
  }
}

import { join } from "node:path";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { HooksConfig } from "../../types/hooks.js";
import {
  CANONICAL_TO_DEEPAGENTS_EVENT_NAMES,
  DEEPAGENTS_HOOK_EVENTS,
  DEEPAGENTS_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
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

type DeepagentsHookEntry = {
  command: string[];
  events?: string[];
};

type DeepagentsHooksFile = {
  hooks: DeepagentsHookEntry[];
};

function isDeepagentsHooksFile(val: unknown): val is DeepagentsHooksFile {
  return (
    typeof val === "object" &&
    val !== null &&
    "hooks" in val &&
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    Array.isArray((val as { hooks: unknown }).hooks)
  );
}

/**
 * Convert canonical hooks config to deepagents flat array format.
 *
 * deepagents format:
 * { "hooks": [{ "command": ["bash", "-c", "..."], "events": ["session.start"] }] }
 *
 * Each canonical hook definition becomes one deepagents hook entry.
 */
function canonicalToDeepagentsHooks(config: HooksConfig): DeepagentsHookEntry[] {
  const supported: Set<string> = new Set(DEEPAGENTS_HOOK_EVENTS);
  // Merge shared hooks + deepagents-specific overrides
  const effectiveHooks: HooksConfig["hooks"] = {
    ...config.hooks,
    ...config.deepagents?.hooks,
  };

  const entries: DeepagentsHookEntry[] = [];

  for (const [canonicalEvent, definitions] of Object.entries(effectiveHooks)) {
    if (!supported.has(canonicalEvent)) continue;

    const deepagentsEvent = CANONICAL_TO_DEEPAGENTS_EVENT_NAMES[canonicalEvent];
    if (!deepagentsEvent) continue;

    for (const def of definitions) {
      if (def.type === "prompt") continue;
      if (!def.command) continue;

      entries.push({
        command: ["bash", "-c", def.command],
        events: [deepagentsEvent],
      });
    }
  }

  return entries;
}

/**
 * Convert deepagents flat array format back to canonical hooks record.
 */
function deepagentsToCanonicalHooks(hooksEntries: DeepagentsHookEntry[]): HooksConfig["hooks"] {
  const canonical: HooksConfig["hooks"] = {};

  for (const entry of hooksEntries) {
    if (!Array.isArray(entry.command) || entry.command.length === 0) continue;

    // Reconstruct command string: if it's ["bash", "-c", "..."], extract the script
    let command: string;
    if (entry.command.length === 3 && entry.command[0] === "bash" && entry.command[1] === "-c") {
      command = entry.command[2] ?? "";
    } else {
      // Fallback: join all parts
      command = entry.command.join(" ");
    }

    const events = entry.events ?? [];
    for (const deepagentsEvent of events) {
      const canonicalEvent = DEEPAGENTS_TO_CANONICAL_EVENT_NAMES[deepagentsEvent];
      if (!canonicalEvent) continue;

      const existing = canonical[canonicalEvent];
      if (existing) {
        existing.push({ type: "command", command });
      } else {
        canonical[canonicalEvent] = [{ type: "command", command }];
      }
    }
  }

  return canonical;
}

export class DeepagentsHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? JSON.stringify({ hooks: [] }, null, 2),
    });
  }

  override isDeletable(): boolean {
    return true;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    return {
      relativeDirPath: ".deepagents",
      relativeFilePath: "hooks.json",
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<DeepagentsHooks> {
    const paths = DeepagentsHooks.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent =
      (await readFileContentOrNull(filePath)) ?? JSON.stringify({ hooks: [] }, null, 2);
    return new DeepagentsHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static fromRulesyncHooks({
    baseDir = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false,
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): DeepagentsHooks {
    const config = rulesyncHooks.getJson();
    const hooks = canonicalToDeepagentsHooks(config);
    const fileContent = JSON.stringify({ hooks }, null, 2);
    const paths = DeepagentsHooks.getSettablePaths({ global });

    return new DeepagentsHooks({
      baseDir,
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

    const hooksEntries = isDeepagentsHooksFile(parsed) ? parsed.hooks : [];
    const hooks = deepagentsToCanonicalHooks(hooksEntries);

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
  }: ToolHooksForDeletionParams): DeepagentsHooks {
    return new DeepagentsHooks({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: [] }, null, 2),
      validate: false,
    });
  }
}

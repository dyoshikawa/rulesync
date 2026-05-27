import { join } from "node:path";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  ANTIGRAVITY_HOOK_EVENTS,
  ANTIGRAVITY_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_ANTIGRAVITY_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
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
 * Antigravity uses a Claude-Code-like `hooks.json` (matcher shape), but the
 * file itself is dedicated to hooks, so the hook map is written at the top
 * level (no `hooks` wrapper object). `projectDirVar` is empty because
 * Antigravity does not document a project-directory variable for commands.
 */
const ANTIGRAVITY_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: ANTIGRAVITY_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_ANTIGRAVITY_EVENT_NAMES,
  toolToCanonicalEventNames: ANTIGRAVITY_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "",
};

type AntigravityOverrideKey = "antigravity-ide" | "antigravity-cli";

/**
 * Hooks generator for Google Antigravity (both the IDE and the CLI).
 *
 * Antigravity writes a dedicated `hooks.json` whose content is the
 * Claude-Code-style event → matcher-entry map, written directly at the top
 * level. Project and global modes share the same shape; only the location
 * differs (`.agents/hooks.json` vs `~/.gemini/config/hooks.json`).
 *
 * The IDE and CLI targets share identical paths, so all logic lives on this
 * base class; the two concrete subclasses differ only in which per-target
 * override key (`antigravity-ide` / `antigravity-cli`) they read from the
 * rulesync hooks config.
 */
export class AntigravityHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  /** Per-target override key in the rulesync hooks config. */
  protected static getOverrideKey(): AntigravityOverrideKey {
    throw new Error("Please implement this method in the subclass.");
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolHooksSettablePaths {
    if (global) {
      // Shared global hooks location for both the IDE and the CLI.
      return { relativeDirPath: join(".gemini", "config"), relativeFilePath: "hooks.json" };
    }
    return { relativeDirPath: ".agents", relativeFilePath: "hooks.json" };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<AntigravityHooks> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new this({
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
  }): Promise<AntigravityHooks> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // hooks.json is dedicated to hooks, so any existing content is fully
    // replaced; reading it first keeps a stable round-trip when unchanged.
    await readOrInitializeFileContent(filePath, JSON.stringify({}, null, 2));

    const config = rulesyncHooks.getJson();
    const antigravityHooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config[this.getOverrideKey()]?.hooks,
      converterConfig: ANTIGRAVITY_CONVERTER_CONFIG,
      logger,
    });
    const fileContent = JSON.stringify(antigravityHooks, null, 2);

    return new this({
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
        `Failed to parse Antigravity hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const hooks = toolHooksToCanonical({
      hooks: parsed,
      converterConfig: ANTIGRAVITY_CONVERTER_CONFIG,
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
  }: ToolHooksForDeletionParams): AntigravityHooks {
    return new this({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({}, null, 2),
      validate: false,
    });
  }
}

/** Antigravity IDE hooks (`antigravity-ide` target). */
export class AntigravityIdeHooks extends AntigravityHooks {
  protected static override getOverrideKey(): AntigravityOverrideKey {
    return "antigravity-ide";
  }
}

/** Antigravity CLI hooks (`antigravity-cli` target). */
export class AntigravityCliHooks extends AntigravityHooks {
  protected static override getOverrideKey(): AntigravityOverrideKey {
    return "antigravity-cli";
  }
}

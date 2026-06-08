import { join } from "node:path";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  CANONICAL_TO_GOOSE_EVENT_NAMES,
  GOOSE_HOOK_EVENTS,
  GOOSE_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
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
 * Plugin directory (under `.agents/plugins/`) that rulesync writes Goose hooks into.
 * Goose auto-discovers any plugin directory containing `hooks/hooks.json`, so the
 * exact name is arbitrary; rulesync uses a fixed, recognizable name.
 */
const GOOSE_PLUGIN_NAME = "rulesync";

const GOOSE_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: GOOSE_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_GOOSE_EVENT_NAMES,
  toolToCanonicalEventNames: GOOSE_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "",
  supportedHookTypes: new Set(["command"]),
};

/**
 * Represents a Goose lifecycle hooks file.
 *
 * Goose adopts the Open Plugins hooks spec: a plugin directory containing
 * `hooks/hooks.json` is auto-discovered at startup. rulesync emits to
 * `.agents/plugins/rulesync/hooks/hooks.json` (project) or the same path under the
 * user home (`~/.agents/plugins/rulesync/hooks/hooks.json`) in global mode.
 *
 * The JSON shape matches Claude Code's: each PascalCase event maps to an array of
 * `{ matcher, hooks: [{ type: "command", command }] }` entries.
 * @see https://goose-docs.ai/blog/2026/05/14/goose-hooks/
 */
export class GooseHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    return {
      relativeDirPath: join(".agents", "plugins", GOOSE_PLUGIN_NAME, "hooks"),
      relativeFilePath: "hooks.json",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<GooseHooks> {
    const paths = GooseHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new GooseHooks({
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
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): Promise<GooseHooks> {
    const paths = GooseHooks.getSettablePaths({ global });
    const config = rulesyncHooks.getJson();
    const gooseHooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.goose?.hooks,
      converterConfig: GOOSE_CONVERTER_CONFIG,
    });
    const fileContent = JSON.stringify({ hooks: gooseHooks }, null, 2);

    return new GooseHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    let parsed: { hooks?: unknown };
    try {
      parsed = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Goose hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    const hooks = toolHooksToCanonical({
      hooks: parsed.hooks,
      converterConfig: GOOSE_CONVERTER_CONFIG,
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
  }: ToolHooksForDeletionParams): GooseHooks {
    return new GooseHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}

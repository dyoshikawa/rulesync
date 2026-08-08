import { join } from "node:path";

import { GOOSE_HOOKS_DIR_PATH, GOOSE_HOOKS_FILE_NAME } from "../../constants/goose-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  CANONICAL_TO_GOOSE_EVENT_NAMES,
  GOOSE_HOOK_EVENTS,
  GOOSE_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
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
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

const GOOSE_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: GOOSE_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_GOOSE_EVENT_NAMES,
  toolToCanonicalEventNames: GOOSE_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "",
  supportedHookTypes: new Set(["command"]),
  // Goose compiles `matcher` with `Regex::new` and drops the whole rule when
  // compilation fails ("Invalid hook matcher regex; skipping rule"). A bare
  // `"*"` is not a valid regex, so emitting the canonical catch-all verbatim
  // produces a hook that never runs; an absent matcher means match-all.
  // https://github.com/aaif-goose/goose/pull/10467
  wildcardMatcherMeansAll: true,
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
 * @see https://goose-docs.ai/docs/guides/context-engineering/hooks/
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
      relativeDirPath: GOOSE_HOOKS_DIR_PATH,
      relativeFilePath: GOOSE_HOOKS_FILE_NAME,
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
    logger,
  }: ToolHooksFromRulesyncHooksParams & {
    global?: boolean;
    logger?: Logger;
  }): Promise<GooseHooks> {
    const paths = GooseHooks.getSettablePaths({ global });
    const config = rulesyncHooks.getJson();
    const gooseHooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.goose?.hooks,
      converterConfig: GOOSE_CONVERTER_CONFIG,
      logger,
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

  toRulesyncHooks({ logger }: { logger?: Logger } = {}): RulesyncHooks {
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
    // Drop any event key Goose does not define (e.g. `SubagentStart`/
    // `SubagentStop` left in an old rulesync-generated file). Every real Goose
    // event maps 1:1 to a canonical event, so a key absent from
    // GOOSE_TO_CANONICAL_EVENT_NAMES is cruft rather than a tool-specific event
    // worth passing through; keeping it would inject an invalid PascalCase key
    // into the canonical `.rulesync/hooks.jsonc`.
    const recognizedHooks =
      parsed.hooks && typeof parsed.hooks === "object" && !Array.isArray(parsed.hooks)
        ? Object.fromEntries(
            Object.entries(parsed.hooks as Record<string, unknown>).filter(([eventName]) =>
              Object.hasOwn(GOOSE_TO_CANONICAL_EVENT_NAMES, eventName),
            ),
          )
        : parsed.hooks;
    const hooks = toolHooksToCanonical({
      hooks: recognizedHooks,
      converterConfig: GOOSE_CONVERTER_CONFIG,
      logger,
    });
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "goose" }),
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

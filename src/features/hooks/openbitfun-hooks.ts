import {
  OPENBITFUN_CONFIG_DIR_PATH,
  OPENBITFUN_HOOKS_FILE_NAME,
  openbitfunGlobalConfigDir,
} from "../../constants/openbitfun-paths.js";
import {
  CANONICAL_TO_OPENBITFUN_EVENT_NAMES,
  OPENBITFUN_HOOK_EVENTS,
  OPENBITFUN_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import type { Logger } from "../../utils/logger.js";
import {
  buildCodexStyleHooksFile,
  CODEXCLI_CONVERTER_CONFIG,
  codexStyleHooksToRulesyncContent,
} from "./codexcli-hooks.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * OpenBitFun implements the Codex hook contract: the same `hooks.json`
 * document, handler fields and matcher semantics. It differs in the events it
 * dispatches and in running only `type: "command"` handlers (`prompt` and
 * `agent` handlers are parsed but skipped). `commandWindows` and
 * `statusMessage` carry over; Codex's `async` and `additionalContextLimit` are
 * not documented for OpenBitFun (which truncates hook context on its own), so
 * they are not forwarded.
 * @see https://github.com/openBitFun/OpenBitFun/blob/main/docs/features/agent-hooks.md
 */
export const OPENBITFUN_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  ...CODEXCLI_CONVERTER_CONFIG,
  supportedEvents: OPENBITFUN_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_OPENBITFUN_EVENT_NAMES,
  toolToCanonicalEventNames: OPENBITFUN_TO_CANONICAL_EVENT_NAMES,
  supportedHookTypes: new Set(["command"]),
  numberPassthroughFields: [],
  booleanPassthroughFields: [],
};

/**
 * Hooks generator for OpenBitFun: a Codex-shaped `hooks.json` at
 * `.openbitfun/config/hooks.json` (project) and `<user root>/config/hooks.json`
 * (global; see {@link openbitfunGlobalConfigDir}). Both layers are additive.
 *
 * Project hooks are off by default in OpenBitFun: they only run once the
 * `app.hooks.project_hooks_enabled` setting is turned on.
 *
 * @see https://github.com/openBitFun/OpenBitFun/blob/main/docs/features/agent-hooks.md
 */
export class OpenbitfunHooks extends ToolHooks {
  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolHooksSettablePaths {
    return {
      relativeDirPath: global ? openbitfunGlobalConfigDir() : OPENBITFUN_CONFIG_DIR_PATH,
      relativeFilePath: OPENBITFUN_HOOKS_FILE_NAME,
    };
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
  }): Promise<OpenbitfunHooks> {
    const paths = OpenbitfunHooks.getSettablePaths({ global });
    const { fileContent, owned } = await buildCodexStyleHooksFile({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      rulesyncHooks,
      toolOverrideHooks: rulesyncHooks.getJson().openbitfun?.hooks,
      converterConfig: OPENBITFUN_CONVERTER_CONFIG,
      toolLabel: "OpenBitFun",
      preserveUnowned,
      logger,
    });

    return new OpenbitfunHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      ownedHookRefs: preserveUnowned ? owned : undefined,
      validate,
    });
  }

  toRulesyncHooks({ logger }: { logger?: Logger } = {}): RulesyncHooks {
    const parsed: { hooks?: unknown } = this.parseFileContentOrThrow({
      displayName: "OpenBitFun",
      parse: (fileContent) => JSON.parse(fileContent),
    });
    return this.toRulesyncHooksDefault({
      fileContent: codexStyleHooksToRulesyncContent({
        parsed,
        converterConfig: OPENBITFUN_CONVERTER_CONFIG,
        overrideKey: "openbitfun",
        logger,
      }),
    });
  }

  static override supportsPreserveUnowned(): boolean {
    return true;
  }
}

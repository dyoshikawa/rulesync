import { z } from "zod/mini";

import { RULESYNC_HOOKS_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { FeatureProcessor } from "../../types/feature-processor.js";
import {
  CLAUDE_HOOK_EVENTS,
  COPILOT_HOOK_EVENTS,
  CURSOR_HOOK_EVENTS,
  FACTORYDROID_HOOK_EVENTS,
  OPENCODE_HOOK_EVENTS,
  type HookEvent,
  type HookType,
} from "../../types/hooks.js";
import type { RulesyncFile } from "../../types/rulesync-file.js";
import type { ToolFile } from "../../types/tool-file.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { logger } from "../../utils/logger.js";
import { ClaudecodeHooks } from "./claudecode-hooks.js";
import { CopilotHooks } from "./copilot-hooks.js";
import { CursorHooks } from "./cursor-hooks.js";
import { FactorydroidHooks } from "./factorydroid-hooks.js";
import { OpencodeHooks } from "./opencode-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";
import type {
  ToolHooksForDeletionParams,
  ToolHooksFromFileParams,
  ToolHooksFromRulesyncHooksParams,
} from "./tool-hooks.js";
import { ToolHooks } from "./tool-hooks.js";

const hooksProcessorToolTargetTuple = [
  "cursor",
  "claudecode",
  "copilot",
  "opencode",
  "factorydroid",
] as const;

export type HooksProcessorToolTarget = (typeof hooksProcessorToolTargetTuple)[number];

export const HooksProcessorToolTargetSchema = z.enum(hooksProcessorToolTargetTuple);

type ToolHooksFactory = {
  class: {
    fromRulesyncHooks(
      params: ToolHooksFromRulesyncHooksParams & { global?: boolean },
    ): ToolHooks | Promise<ToolHooks>;
    fromFile(params: ToolHooksFromFileParams): Promise<ToolHooks>;
    forDeletion(params: ToolHooksForDeletionParams): ToolHooks;
    getSettablePaths(options?: { global?: boolean }): {
      relativeDirPath: string;
      relativeFilePath: string;
    };
    isDeletable?: (instance: ToolHooks) => boolean;
  };
  meta: {
    supportsProject: boolean;
    supportsGlobal: boolean;
    supportsImport: boolean;
  };
  supportedEvents: readonly HookEvent[];
  supportedHookTypes: readonly HookType[];
  supportsMatcher: boolean;
};

const toolHooksFactories = new Map<HooksProcessorToolTarget, ToolHooksFactory>([
  [
    "cursor",
    {
      class: CursorHooks,
      meta: {
        supportsProject: true,
        supportsGlobal: false,
        supportsImport: true,
      },
      supportedEvents: CURSOR_HOOK_EVENTS,
      supportedHookTypes: ["command", "prompt"],
      supportsMatcher: true,
    },
  ],
  [
    "claudecode",
    {
      class: ClaudecodeHooks,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
      supportedEvents: CLAUDE_HOOK_EVENTS,
      supportedHookTypes: ["command", "prompt"],
      supportsMatcher: true,
    },
  ],
  [
    "copilot",
    {
      class: CopilotHooks,
      meta: {
        supportsProject: true,
        supportsGlobal: false,
        supportsImport: true,
      },
      supportedEvents: COPILOT_HOOK_EVENTS,
      supportedHookTypes: ["command"],
      supportsMatcher: false,
    },
  ],
  [
    "opencode",
    {
      class: OpencodeHooks,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: false,
      },
      supportedEvents: OPENCODE_HOOK_EVENTS,
      supportedHookTypes: ["command"],
      supportsMatcher: true,
    },
  ],
  [
    "factorydroid",
    {
      class: FactorydroidHooks,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
      supportedEvents: FACTORYDROID_HOOK_EVENTS,
      supportedHookTypes: ["command", "prompt"],
      supportsMatcher: true,
    },
  ],
]);

const hooksProcessorToolTargets: ToolTarget[] = [...toolHooksFactories.keys()];
const hooksProcessorToolTargetsGlobal: ToolTarget[] = [...toolHooksFactories.entries()]
  .filter(([, f]) => f.meta.supportsGlobal)
  .map(([t]) => t);
const hooksProcessorToolTargetsImportable: ToolTarget[] = [...toolHooksFactories.entries()]
  .filter(([, f]) => f.meta.supportsImport)
  .map(([t]) => t);
const hooksProcessorToolTargetsGlobalImportable: ToolTarget[] = [...toolHooksFactories.entries()]
  .filter(([, f]) => f.meta.supportsGlobal && f.meta.supportsImport)
  .map(([t]) => t);

export class HooksProcessor extends FeatureProcessor {
  private readonly toolTarget: HooksProcessorToolTarget;
  private readonly global: boolean;

  constructor({
    baseDir = process.cwd(),
    toolTarget,
    global = false,
    dryRun = false,
  }: {
    baseDir?: string;
    toolTarget: ToolTarget;
    global?: boolean;
    dryRun?: boolean;
  }) {
    super({ baseDir, dryRun });
    const result = HooksProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for HooksProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
  }

  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    try {
      return [
        await RulesyncHooks.fromFile({
          baseDir: process.cwd(),
          validate: true,
        }),
      ];
    } catch (error) {
      logger.error(
        `Failed to load Rulesync hooks file (${RULESYNC_HOOKS_RELATIVE_FILE_PATH}): ${formatError(error)}`,
      );
      return [];
    }
  }

  async loadToolFiles({ forDeletion = false }: { forDeletion?: boolean } = {}): Promise<
    ToolFile[]
  > {
    try {
      const factory = toolHooksFactories.get(this.toolTarget);
      if (!factory) throw new Error(`Unsupported tool target: ${this.toolTarget}`);
      const paths = factory.class.getSettablePaths({ global: this.global });

      if (forDeletion) {
        const toolHooks = factory.class.forDeletion({
          baseDir: this.baseDir,
          relativeDirPath: paths.relativeDirPath,
          relativeFilePath: paths.relativeFilePath,
          global: this.global,
        });
        const list = toolHooks.isDeletable?.() !== false ? [toolHooks] : [];
        logger.debug(
          `Successfully loaded ${list.length} ${this.toolTarget} hooks files for deletion`,
        );
        return list;
      }

      const toolHooks = await factory.class.fromFile({
        baseDir: this.baseDir,
        validate: true,
        global: this.global,
      });
      logger.debug(`Successfully loaded 1 ${this.toolTarget} hooks file`);
      return [toolHooks];
    } catch (error) {
      const msg = `Failed to load hooks files for tool target: ${this.toolTarget}: ${formatError(error)}`;
      if (error instanceof Error && error.message.includes("no such file or directory")) {
        logger.debug(msg);
      } else {
        logger.error(msg);
      }
      return [];
    }
  }

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncHooks = rulesyncFiles.find((f): f is RulesyncHooks => f instanceof RulesyncHooks);
    if (!rulesyncHooks) {
      throw new Error(`No ${RULESYNC_HOOKS_RELATIVE_FILE_PATH} found.`);
    }

    const factory = toolHooksFactories.get(this.toolTarget);
    if (!factory) throw new Error(`Unsupported tool target: ${this.toolTarget}`);

    const config = rulesyncHooks.getJson();
    const sharedHooks = config.hooks;
    const overrideHooks = config[this.toolTarget]?.hooks ?? {};
    const effectiveHooks = { ...sharedHooks, ...overrideHooks };

    // Warn about unsupported events
    {
      const supportedEvents: Set<string> = new Set(factory.supportedEvents);
      const configEventNames = new Set<string>(Object.keys(effectiveHooks));
      const skipped = [...configEventNames].filter((e) => !supportedEvents.has(e));
      if (skipped.length > 0) {
        logger.warn(
          `Skipped hook event(s) for ${this.toolTarget} (not supported): ${skipped.join(", ")}`,
        );
      }
    }

    // Warn about unsupported hook types
    {
      const supportedHookTypes: Set<string> = new Set(factory.supportedHookTypes);
      const unsupportedTypeToEvents = new Map<string, Set<string>>();
      for (const [event, defs] of Object.entries(effectiveHooks)) {
        for (const def of defs) {
          const hookType = def.type ?? "command";
          if (!supportedHookTypes.has(hookType)) {
            const events = unsupportedTypeToEvents.get(hookType) ?? new Set<string>();
            events.add(event);
            unsupportedTypeToEvents.set(hookType, events);
          }
        }
      }

      for (const [hookType, events] of unsupportedTypeToEvents) {
        logger.warn(
          `Skipped ${hookType}-type hook(s) for ${this.toolTarget} (not supported): ${Array.from(events).join(", ")}`,
        );
      }
    }

    // Warn about unsupported matcher
    if (!factory.supportsMatcher) {
      const eventsWithMatcher = new Set<string>();
      for (const [event, defs] of Object.entries(effectiveHooks)) {
        for (const def of defs) {
          if (def.matcher) {
            eventsWithMatcher.add(event);
          }
        }
      }

      if (eventsWithMatcher.size > 0) {
        logger.warn(
          `Skipped matcher hook(s) for ${this.toolTarget} (not supported): ${Array.from(eventsWithMatcher).join(", ")}`,
        );
      }
    }

    const toolHooks = await factory.class.fromRulesyncHooks({
      baseDir: this.baseDir,
      rulesyncHooks,
      validate: true,
      global: this.global,
    });
    return [toolHooks];
  }

  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const hooks = toolFiles.filter((f): f is ToolHooks => f instanceof ToolHooks);
    return hooks.map((h) => h.toRulesyncHooks());
  }

  static getToolTargets({
    global = false,
    importOnly = false,
  }: { global?: boolean; importOnly?: boolean } = {}): ToolTarget[] {
    if (global) {
      return importOnly
        ? hooksProcessorToolTargetsGlobalImportable
        : hooksProcessorToolTargetsGlobal;
    }
    return importOnly ? hooksProcessorToolTargetsImportable : hooksProcessorToolTargets;
  }
}
